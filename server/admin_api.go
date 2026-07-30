package main

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
)

func (a *API) registerAdminRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/admin/users", a.adminListUsers)
	mux.HandleFunc("GET /api/admin/users/{id}", a.adminGetUser)
	mux.HandleFunc("PATCH /api/admin/users/{id}", a.adminPatchUser)
	mux.HandleFunc("POST /api/admin/users/{id}/ban", a.adminBanUser)
	mux.HandleFunc("POST /api/admin/users/{id}/unban", a.adminUnbanUser)

	mux.HandleFunc("GET /api/admin/quests", a.adminListQuests)
	mux.HandleFunc("POST /api/admin/quests", a.adminCreateQuest)
	mux.HandleFunc("PATCH /api/admin/quests/{id}", a.adminPatchQuest)
	mux.HandleFunc("DELETE /api/admin/quests/{id}", a.adminDeleteQuest)

	mux.HandleFunc("GET /api/admin/posts", a.adminListPosts)
	mux.HandleFunc("POST /api/admin/posts", a.adminCreatePost)
	mux.HandleFunc("POST /api/admin/posts/{id}/publish", a.adminPublishPost)
}

func (a *API) authAdmin(w http.ResponseWriter, r *http.Request) *User {
	u := a.authUser(w, r)
	if u == nil {
		return nil
	}
	if a.store.IsBanned(u) {
		writeErr(w, http.StatusForbidden, "аккаунт заблокирован")
		return nil
	}
	if !u.IsAdmin {
		writeErr(w, http.StatusForbidden, "нужны права админа")
		return nil
	}
	return u
}

func (a *API) adminListUsers(w http.ResponseWriter, r *http.Request) {
	if a.authAdmin(w, r) == nil {
		return
	}
	q := r.URL.Query().Get("q")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	users, total, err := a.store.AdminListUsers(q, limit, offset)
	if err != nil {
		log.Println("admin users:", err)
		writeErr(w, http.StatusInternalServerError, "ошибка сервера")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": users, "total": total})
}

func (a *API) adminGetUser(w http.ResponseWriter, r *http.Request) {
	if a.authAdmin(w, r) == nil {
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "некорректный id")
		return
	}
	u, err := a.store.UserByID(id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "игрок не найден")
		return
	}
	stats, err := a.store.UserStats(id)
	if err != nil {
		log.Println("admin user stats:", err)
		writeErr(w, http.StatusInternalServerError, "ошибка сервера")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": u, "stats": stats})
}

func (a *API) adminPatchUser(w http.ResponseWriter, r *http.Request) {
	admin := a.authAdmin(w, r)
	if admin == nil {
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "некорректный id")
		return
	}
	var patch AdminUserPatch
	if !readJSON(w, r, &patch) {
		return
	}
	u, err := a.store.AdminPatchUser(id, patch)
	if err != nil {
		if errors.Is(err, ErrNoUser) {
			writeErr(w, http.StatusNotFound, "игрок не найден")
			return
		}
		if errors.Is(err, ErrUsernameTaken) {
			writeErr(w, http.StatusConflict, "ник занят")
			return
		}
		if msg := err.Error(); strings.Contains(msg, "ник") || strings.Contains(msg, "nickname") || strings.Contains(msg, "3") {
			writeErr(w, http.StatusBadRequest, msg)
			return
		}
		log.Println("admin patch user:", err)
		writeErr(w, http.StatusBadRequest, "не удалось сохранить")
		return
	}
	_ = admin
	writeJSON(w, http.StatusOK, map[string]any{"user": u})
}

func (a *API) adminBanUser(w http.ResponseWriter, r *http.Request) {
	admin := a.authAdmin(w, r)
	if admin == nil {
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "некорректный id")
		return
	}
	if id == admin.ID {
		writeErr(w, http.StatusBadRequest, "нельзя забанить себя")
		return
	}
	var body struct {
		Reason string `json:"reason"`
	}
	if r.Body != nil && r.ContentLength != 0 {
		_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body)
	}
	u, err := a.store.BanUser(id, body.Reason)
	if err != nil {
		if errors.Is(err, ErrNoUser) {
			writeErr(w, http.StatusNotFound, "игрок не найден")
			return
		}
		log.Println("admin ban:", err)
		writeErr(w, http.StatusInternalServerError, "ошибка сервера")
		return
	}
	a.arena.KickUser(id, "banned")
	writeJSON(w, http.StatusOK, map[string]any{"user": u})
}

func (a *API) adminUnbanUser(w http.ResponseWriter, r *http.Request) {
	if a.authAdmin(w, r) == nil {
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "некорректный id")
		return
	}
	u, err := a.store.UnbanUser(id)
	if err != nil {
		if errors.Is(err, ErrNoUser) {
			writeErr(w, http.StatusNotFound, "игрок не найден")
			return
		}
		log.Println("admin unban:", err)
		writeErr(w, http.StatusInternalServerError, "ошибка сервера")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": u})
}

func (a *API) adminListQuests(w http.ResponseWriter, r *http.Request) {
	if a.authAdmin(w, r) == nil {
		return
	}
	list, err := a.store.ListAllQuestsAdmin()
	if err != nil {
		log.Println("admin quests:", err)
		writeErr(w, http.StatusInternalServerError, "ошибка сервера")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"quests": list})
}

func (a *API) adminCreateQuest(w http.ResponseWriter, r *http.Request) {
	if a.authAdmin(w, r) == nil {
		return
	}
	var q QuestDef
	if !readJSON(w, r, &q) {
		return
	}
	q.ID = strings.TrimSpace(q.ID)
	created, err := a.store.CreateQuest(q)
	if err != nil {
		if errors.Is(err, ErrQuestIDTaken) {
			writeErr(w, http.StatusConflict, "id квеста занят")
			return
		}
		writeErr(w, http.StatusBadRequest, "некорректный квест")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"quest": created})
}

func (a *API) adminPatchQuest(w http.ResponseWriter, r *http.Request) {
	if a.authAdmin(w, r) == nil {
		return
	}
	id := r.PathValue("id")
	var q QuestDef
	if !readJSON(w, r, &q) {
		return
	}
	updated, err := a.store.UpdateQuest(id, q)
	if err != nil {
		if errors.Is(err, ErrUnknownQuest) {
			writeErr(w, http.StatusNotFound, "квест не найден")
			return
		}
		writeErr(w, http.StatusBadRequest, "не удалось сохранить")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"quest": updated})
}

func (a *API) adminDeleteQuest(w http.ResponseWriter, r *http.Request) {
	if a.authAdmin(w, r) == nil {
		return
	}
	id := r.PathValue("id")
	if err := a.store.DeleteQuest(id); err != nil {
		if errors.Is(err, ErrUnknownQuest) {
			writeErr(w, http.StatusNotFound, "квест не найден")
			return
		}
		log.Println("admin delete quest:", err)
		writeErr(w, http.StatusInternalServerError, "ошибка сервера")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *API) adminListPosts(w http.ResponseWriter, r *http.Request) {
	if a.authAdmin(w, r) == nil {
		return
	}
	list, err := a.store.ListBotPosts(50)
	if err != nil {
		log.Println("admin posts:", err)
		writeErr(w, http.StatusInternalServerError, "ошибка сервера")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"posts": list})
}

func (a *API) adminCreatePost(w http.ResponseWriter, r *http.Request) {
	admin := a.authAdmin(w, r)
	if admin == nil {
		return
	}
	imgPath, err := saveBotPostImage(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	text := strings.TrimSpace(r.FormValue("text"))
	if text == "" && imgPath == "" {
		writeErr(w, http.StatusBadRequest, "нужен текст или картинка")
		return
	}
	post, err := a.store.CreateBotPost(admin.ID, text, imgPath)
	if err != nil {
		log.Println("admin create post:", err)
		writeErr(w, http.StatusInternalServerError, "ошибка сервера")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"post": post})
}

func (a *API) adminPublishPost(w http.ResponseWriter, r *http.Request) {
	if a.authAdmin(w, r) == nil {
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "некорректный id")
		return
	}
	post, err := a.store.PublishBotPost(id)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"post": post})
}
