package main

import (
	"encoding/json"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

type API struct {
	store   *Store
	arena   *Arena
	online  *Online
	limiter *rateLimiter
	origins []string // empty means "reflect any origin"
}

func NewAPI(store *Store, arena *Arena, online *Online) *API {
	var origins []string
	for _, o := range strings.Split(os.Getenv("ALLOWED_ORIGINS"), ",") {
		if o = strings.TrimSpace(o); o != "" {
			origins = append(origins, o)
		}
	}
	if len(origins) == 0 {
		log.Println("api: ALLOWED_ORIGINS is not set, accepting any origin")
	}
	// 30/min still makes brute force pointless against bcrypt, while leaving
	// room for several real players sharing one NAT address.
	return &API{store: store, arena: arena, online: online, limiter: newRateLimiter(30, time.Minute), origins: origins}
}

func (a *API) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/register", a.register)
	mux.HandleFunc("POST /api/login", a.login)
	mux.HandleFunc("POST /api/auth/telegram", a.telegramLogin)
	mux.HandleFunc("GET /api/me", a.me)
	mux.HandleFunc("POST /api/me/skin", a.setSkin)
	mux.HandleFunc("POST /api/me/mine-skin", a.setMineSkin)
	mux.HandleFunc("POST /api/me/hat", a.setHat)
	mux.HandleFunc("POST /api/me/avatar", a.setAvatar)
	mux.HandleFunc("GET /api/skins", a.skins)
	mux.HandleFunc("GET /api/mine-skins", a.mineSkins)
	mux.HandleFunc("GET /api/hats", a.hats)
	mux.HandleFunc("GET /api/rating", a.rating)
	mux.HandleFunc("POST /api/match/queue", a.matchQueue)
	mux.HandleFunc("DELETE /api/match/queue", a.matchCancel)
	mux.HandleFunc("GET /api/match/status", a.matchStatus)
	mux.HandleFunc("POST /api/online/heartbeat", a.onlineHeartbeat)
	mux.HandleFunc("GET /api/online", a.onlineList)
	a.registerFriendRoutes(mux)
	a.registerQuestRoutes(mux)
	a.registerAdminRoutes(mux)
	return a.withCORS(mux)
}

// --- plumbing ---------------------------------------------------------------

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func readJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(dst) != nil {
		writeErr(w, http.StatusBadRequest, "некорректный запрос")
		return false
	}
	return true
}

// The frontend lives on another origin (Vercel), so preflight must pass.
func (a *API) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && a.originAllowed(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Max-Age", "86400")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (a *API) originAllowed(origin string) bool {
	if len(a.origins) == 0 {
		return true
	}
	for _, o := range a.origins {
		if o == origin {
			return true
		}
	}
	return false
}

// authUser resolves the bearer token; it writes the 401 itself when missing.
func (a *API) authUser(w http.ResponseWriter, r *http.Request) *User {
	raw := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	id, err := userIDFromToken(strings.TrimSpace(raw))
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "нужен вход")
		return nil
	}
	u, err := a.store.UserByID(id)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "нужен вход")
		return nil
	}
	if a.store.IsBanned(u) {
		writeErr(w, http.StatusForbidden, "аккаунт заблокирован")
		return nil
	}
	return u
}

func clientIP(r *http.Request) string {
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		return strings.TrimSpace(strings.Split(fwd, ",")[0])
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// --- handlers ---------------------------------------------------------------

type credentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (a *API) authOK(w http.ResponseWriter, u *User) {
	if a.store.IsBanned(u) {
		writeErr(w, http.StatusForbidden, "аккаунт заблокирован")
		return
	}
	token, err := issueToken(u)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "не удалось выдать токен")
		return
	}
	a.store.EnsureMineSkins(u.ID)
	a.store.EnsureHats(u.ID)
	if refreshed, err := a.store.UserByID(u.ID); err == nil {
		u = refreshed
	}
	owned, err := a.store.OwnedSkins(u.ID)
	if err != nil {
		log.Println("api auth owned:", err)
		owned = []string{u.SkinID}
	}
	mineOwned, err := a.store.OwnedMineSkins(u.ID)
	if err != nil {
		log.Println("api auth mine owned:", err)
		mineOwned = []string{u.MineSkinID}
	}
	hatOwned, err := a.store.OwnedHats(u.ID)
	if err != nil {
		log.Println("api auth hat owned:", err)
		hatOwned = []string{u.HatID}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"token": token, "user": u, "ownedSkins": owned, "ownedMineSkins": mineOwned, "ownedHats": hatOwned,
	})
}

func (a *API) register(w http.ResponseWriter, r *http.Request) {
	if !a.limiter.allow(clientIP(r)) {
		writeErr(w, http.StatusTooManyRequests, "слишком много попыток, подожди минуту")
		return
	}
	var c credentials
	if !readJSON(w, r, &c) {
		return
	}
	name, err := validateNickname(c.Username)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := validatePassword(c.Password); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	hash, err := hashPassword(c.Password)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "ошибка сервера")
		return
	}
	u, err := a.store.CreateUser(name, hash)
	if errors.Is(err, ErrUsernameTaken) {
		writeErr(w, http.StatusConflict, "ник уже занят")
		return
	}
	if err != nil {
		log.Println("api register:", err)
		writeErr(w, http.StatusInternalServerError, "ошибка сервера")
		return
	}
	a.authOK(w, u)
}

func (a *API) login(w http.ResponseWriter, r *http.Request) {
	if !a.limiter.allow(clientIP(r)) {
		writeErr(w, http.StatusTooManyRequests, "слишком много попыток, подожди минуту")
		return
	}
	var c credentials
	if !readJSON(w, r, &c) {
		return
	}
	u, err := a.store.UserByUsername(strings.TrimSpace(c.Username))
	if err == nil {
		err = checkPassword(u.passwordHash, c.Password)
	}
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "неверный ник или пароль")
		return
	}
	a.authOK(w, u)
}

func (a *API) telegramLogin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		InitData string `json:"initData"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	tu, err := verifyTelegramInitData(body.InitData)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "Telegram: подпись не прошла проверку")
		return
	}
	u, err := a.store.UserByTelegram(tu.ID, telegramNickname(tu), tu.PhotoURL)
	if err != nil {
		log.Println("api telegram:", err)
		writeErr(w, http.StatusInternalServerError, "ошибка сервера")
		return
	}
	a.authOK(w, u)
}

func (a *API) me(w http.ResponseWriter, r *http.Request) {
	u := a.authUser(w, r)
	if u == nil {
		return
	}
	a.store.EnsureMineSkins(u.ID)
	a.store.EnsureHats(u.ID)
	if refreshed, err := a.store.UserByID(u.ID); err == nil {
		u = refreshed
	}
	owned, err := a.store.OwnedSkins(u.ID)
	if err != nil {
		log.Println("api me:", err)
		owned = []string{u.SkinID}
	}
	mineOwned, err := a.store.OwnedMineSkins(u.ID)
	if err != nil {
		log.Println("api me mine:", err)
		mineOwned = []string{u.MineSkinID}
	}
	hatOwned, err := a.store.OwnedHats(u.ID)
	if err != nil {
		log.Println("api me hat:", err)
		hatOwned = []string{u.HatID}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user": u, "ownedSkins": owned, "ownedMineSkins": mineOwned, "ownedHats": hatOwned,
	})
}

func (a *API) setSkin(w http.ResponseWriter, r *http.Request) {
	u := a.authUser(w, r)
	if u == nil {
		return
	}
	var body struct {
		SkinID string `json:"skinId"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	if !skinExists(body.SkinID) {
		writeErr(w, http.StatusBadRequest, "неизвестный скин")
		return
	}
	if err := a.store.SetSkin(u.ID, body.SkinID); err != nil {
		writeErr(w, http.StatusBadRequest, "скин недоступен")
		return
	}
	u.SkinID = body.SkinID
	writeJSON(w, http.StatusOK, map[string]any{"user": u})
}

func (a *API) setMineSkin(w http.ResponseWriter, r *http.Request) {
	u := a.authUser(w, r)
	if u == nil {
		return
	}
	a.store.EnsureMineSkins(u.ID)
	var body struct {
		MineSkinID string `json:"mineSkinId"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	if !mineSkinExists(body.MineSkinID) {
		writeErr(w, http.StatusBadRequest, "неизвестный скин мины")
		return
	}
	if err := a.store.SetMineSkin(u.ID, body.MineSkinID); err != nil {
		writeErr(w, http.StatusBadRequest, "скин недоступен")
		return
	}
	u.MineSkinID = body.MineSkinID
	writeJSON(w, http.StatusOK, map[string]any{"user": u})
}

func (a *API) setHat(w http.ResponseWriter, r *http.Request) {
	u := a.authUser(w, r)
	if u == nil {
		return
	}
	a.store.EnsureHats(u.ID)
	var body struct {
		HatID string `json:"hatId"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	if !hatExists(body.HatID) {
		writeErr(w, http.StatusBadRequest, "неизвестная шапка")
		return
	}
	if err := a.store.SetHat(u.ID, body.HatID); err != nil {
		writeErr(w, http.StatusBadRequest, "шапка недоступна")
		return
	}
	u.HatID = body.HatID
	writeJSON(w, http.StatusOK, map[string]any{"user": u})
}

func (a *API) setAvatar(w http.ResponseWriter, r *http.Request) {
	u := a.authUser(w, r)
	if u == nil {
		return
	}
	url, err := saveAvatarUpload(r, u.ID)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	updated, err := a.store.SetAvatar(u.ID, url)
	if err != nil {
		log.Println("api avatar:", err)
		writeErr(w, http.StatusInternalServerError, "ошибка сервера")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": updated})
}

func (a *API) skins(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"skins": Skins, "default": DefaultSkin})
}

func (a *API) mineSkins(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"skins": MineSkins, "default": DefaultMineSkin})
}

func (a *API) hats(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"hats": Hats, "default": DefaultHat})
}

func (a *API) rating(w http.ResponseWriter, r *http.Request) {
	u := a.authUser(w, r)
	if u == nil {
		return
	}
	list, err := a.store.TopByCubes(50)
	if err != nil {
		log.Println("api rating:", err)
		writeErr(w, http.StatusInternalServerError, "ошибка сервера")
		return
	}
	if list == nil {
		list = []RatingEntry{}
	}
	me, err := a.store.RatingOf(u.ID)
	if err != nil {
		log.Println("api rating me:", err)
		writeErr(w, http.StatusInternalServerError, "ошибка сервера")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"players": list, "me": me})
}

func (a *API) matchQueue(w http.ResponseWriter, r *http.Request) {
	u := a.authUser(w, r)
	if u == nil {
		return
	}
	var body struct {
		Maps []string `json:"maps"`
		Size int      `json:"size"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	match, err := a.arena.Enqueue(u.ID, body.Maps, body.Size)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if match != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"state": "matched", "matchId": match.ID, "mapId": match.MapID,
			"mode": match.Mode, "size": match.Size,
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"state": "searching", "size": body.Size})
}

func (a *API) matchCancel(w http.ResponseWriter, r *http.Request) {
	u := a.authUser(w, r)
	if u == nil {
		return
	}
	a.arena.Dequeue(u.ID)
	writeJSON(w, http.StatusOK, map[string]any{"state": "idle"})
}

func (a *API) matchStatus(w http.ResponseWriter, r *http.Request) {
	u := a.authUser(w, r)
	if u == nil {
		return
	}
	s := a.arena.Status(u.ID)
	out := map[string]any{"state": s.State}
	if s.Maps != nil {
		out["maps"] = s.Maps
	}
	if s.Size > 0 {
		out["size"] = s.Size
	}
	if s.Match != nil {
		out["matchId"] = s.Match.ID
		out["mapId"] = s.Match.MapID
		out["mode"] = s.Match.Mode
	}
	writeJSON(w, http.StatusOK, out)
}

func (a *API) onlineHeartbeat(w http.ResponseWriter, r *http.Request) {
	u := a.authUser(w, r)
	if u == nil {
		return
	}
	a.online.Touch(u.ID)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *API) onlineList(w http.ResponseWriter, r *http.Request) {
	u := a.authUser(w, r)
	if u == nil {
		return
	}
	// Keep the viewer themselves visible even if this is their first poll.
	a.online.Touch(u.ID)

	ids := a.online.IDs()
	users, err := a.store.UsersPublicByIDs(ids)
	if err != nil {
		log.Println("api online:", err)
		writeErr(w, http.StatusInternalServerError, "ошибка сервера")
		return
	}
	byID := make(map[int64]OnlineUser, len(users))
	for _, p := range users {
		byID[p.ID] = p
	}
	out := make([]OnlineUser, 0, len(ids))
	for _, id := range ids {
		p, ok := byID[id]
		if !ok {
			continue
		}
		switch {
		case a.arena.presence != nil && a.arena.presence.InGame(id):
			p.Status = "game"
		case a.arena.IsSearching(id):
			p.Status = "search"
		default:
			p.Status = "app"
		}
		out = append(out, p)
	}
	writeJSON(w, http.StatusOK, map[string]any{"players": out})
}

// --- rate limiting ----------------------------------------------------------

// Fixed-window counter per IP: enough to blunt credential stuffing on the
// auth endpoints without pulling in a dependency.
type rateLimiter struct {
	mu     sync.Mutex
	limit  int
	window time.Duration
	hits   map[string]*window
}

type window struct {
	count int
	until time.Time
}

func newRateLimiter(limit int, w time.Duration) *rateLimiter {
	return &rateLimiter{limit: limit, window: w, hits: make(map[string]*window)}
}

func (rl *rateLimiter) allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	now := time.Now()

	if len(rl.hits) > 10000 { // cheap eviction of stale windows
		for k, v := range rl.hits {
			if now.After(v.until) {
				delete(rl.hits, k)
			}
		}
	}

	w, ok := rl.hits[key]
	if !ok || now.After(w.until) {
		rl.hits[key] = &window{count: 1, until: now.Add(rl.window)}
		return true
	}
	w.count++
	return w.count <= rl.limit
}
