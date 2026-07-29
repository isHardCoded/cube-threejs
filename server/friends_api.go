package main

import (
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
)

func (a *API) registerFriendRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/friends", a.friendsList)
	mux.HandleFunc("GET /api/friends/search", a.friendsSearch)
	mux.HandleFunc("GET /api/friends/blocked", a.friendsBlocked)
	mux.HandleFunc("POST /api/friends/request", a.friendsRequest)
	mux.HandleFunc("POST /api/friends/accept", a.friendsAccept)
	mux.HandleFunc("POST /api/friends/decline", a.friendsDecline)
	mux.HandleFunc("POST /api/friends/cancel", a.friendsCancel)
	mux.HandleFunc("POST /api/friends/remove", a.friendsRemove)
	mux.HandleFunc("POST /api/friends/block", a.friendsBlock)
	mux.HandleFunc("POST /api/friends/unblock", a.friendsUnblock)
	mux.HandleFunc("GET /api/users/{id}", a.publicUser)
}

type friendTarget struct {
	UserID   int64  `json:"userId"`
	Username string `json:"username"`
}

func (a *API) resolveFriendTarget(w http.ResponseWriter, body friendTarget) (*User, bool) {
	if body.UserID > 0 {
		u, err := a.store.UserByID(body.UserID)
		if errors.Is(err, ErrNoUser) {
			writeErr(w, http.StatusNotFound, "игрок не найден")
			return nil, false
		}
		if err != nil {
			log.Println("api friends target:", err)
			writeErr(w, http.StatusInternalServerError, "ошибка сервера")
			return nil, false
		}
		return u, true
	}
	name := strings.TrimSpace(body.Username)
	if name == "" {
		writeErr(w, http.StatusBadRequest, "некорректный запрос")
		return nil, false
	}
	u, err := a.store.UserByUsername(name)
	if errors.Is(err, ErrNoUser) {
		writeErr(w, http.StatusNotFound, "игрок не найден")
		return nil, false
	}
	if err != nil {
		log.Println("api friends target:", err)
		writeErr(w, http.StatusInternalServerError, "ошибка сервера")
		return nil, false
	}
	return u, true
}

func (a *API) writeFriendErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrCannotSelf):
		writeErr(w, http.StatusBadRequest, "нельзя добавить себя")
	case errors.Is(err, ErrAlreadyFriends):
		writeErr(w, http.StatusConflict, "уже в друзьях")
	case errors.Is(err, ErrAlreadyRequested):
		writeErr(w, http.StatusConflict, "заявка уже отправлена")
	case errors.Is(err, ErrNoFriendRequest):
		writeErr(w, http.StatusNotFound, "заявка не найдена")
	case errors.Is(err, ErrNotFriends):
		writeErr(w, http.StatusNotFound, "не в друзьях")
	case errors.Is(err, ErrBlocked):
		writeErr(w, http.StatusForbidden, "пользователь заблокирован")
	case errors.Is(err, ErrNoUser):
		writeErr(w, http.StatusNotFound, "игрок не найден")
	default:
		log.Println("api friends:", err)
		writeErr(w, http.StatusInternalServerError, "ошибка сервера")
	}
}

func (a *API) friendsList(w http.ResponseWriter, r *http.Request) {
	u := a.authUser(w, r)
	if u == nil {
		return
	}
	friends, err := a.store.ListFriends(u.ID)
	if err != nil {
		a.writeFriendErr(w, err)
		return
	}
	incoming, err := a.store.ListIncomingRequests(u.ID)
	if err != nil {
		a.writeFriendErr(w, err)
		return
	}
	outgoing, err := a.store.ListOutgoingRequests(u.ID)
	if err != nil {
		a.writeFriendErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"friends":  friends,
		"incoming": incoming,
		"outgoing": outgoing,
	})
}

func (a *API) friendsSearch(w http.ResponseWriter, r *http.Request) {
	u := a.authUser(w, r)
	if u == nil {
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	list, err := a.store.SearchUsers(u.ID, q, 20)
	if err != nil {
		a.writeFriendErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": list})
}

func (a *API) friendsBlocked(w http.ResponseWriter, r *http.Request) {
	u := a.authUser(w, r)
	if u == nil {
		return
	}
	list, err := a.store.ListBlocked(u.ID)
	if err != nil {
		a.writeFriendErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": list})
}

func (a *API) friendsRequest(w http.ResponseWriter, r *http.Request) {
	me := a.authUser(w, r)
	if me == nil {
		return
	}
	var body friendTarget
	if !readJSON(w, r, &body) {
		return
	}
	target, ok := a.resolveFriendTarget(w, body)
	if !ok {
		return
	}
	if err := a.store.SendFriendRequest(me.ID, target.ID); err != nil {
		a.writeFriendErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *API) friendsAccept(w http.ResponseWriter, r *http.Request) {
	me := a.authUser(w, r)
	if me == nil {
		return
	}
	var body friendTarget
	if !readJSON(w, r, &body) {
		return
	}
	target, ok := a.resolveFriendTarget(w, body)
	if !ok {
		return
	}
	if err := a.store.AcceptFriendRequest(me.ID, target.ID); err != nil {
		a.writeFriendErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *API) friendsDecline(w http.ResponseWriter, r *http.Request) {
	me := a.authUser(w, r)
	if me == nil {
		return
	}
	var body friendTarget
	if !readJSON(w, r, &body) {
		return
	}
	target, ok := a.resolveFriendTarget(w, body)
	if !ok {
		return
	}
	if err := a.store.DeclineFriendRequest(me.ID, target.ID); err != nil {
		a.writeFriendErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *API) friendsCancel(w http.ResponseWriter, r *http.Request) {
	me := a.authUser(w, r)
	if me == nil {
		return
	}
	var body friendTarget
	if !readJSON(w, r, &body) {
		return
	}
	target, ok := a.resolveFriendTarget(w, body)
	if !ok {
		return
	}
	if err := a.store.CancelFriendRequest(me.ID, target.ID); err != nil {
		a.writeFriendErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *API) friendsRemove(w http.ResponseWriter, r *http.Request) {
	me := a.authUser(w, r)
	if me == nil {
		return
	}
	var body friendTarget
	if !readJSON(w, r, &body) {
		return
	}
	target, ok := a.resolveFriendTarget(w, body)
	if !ok {
		return
	}
	if err := a.store.RemoveFriend(me.ID, target.ID); err != nil {
		a.writeFriendErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *API) friendsBlock(w http.ResponseWriter, r *http.Request) {
	me := a.authUser(w, r)
	if me == nil {
		return
	}
	var body friendTarget
	if !readJSON(w, r, &body) {
		return
	}
	target, ok := a.resolveFriendTarget(w, body)
	if !ok {
		return
	}
	if err := a.store.BlockUser(me.ID, target.ID); err != nil {
		a.writeFriendErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *API) friendsUnblock(w http.ResponseWriter, r *http.Request) {
	me := a.authUser(w, r)
	if me == nil {
		return
	}
	var body friendTarget
	if !readJSON(w, r, &body) {
		return
	}
	target, ok := a.resolveFriendTarget(w, body)
	if !ok {
		return
	}
	if err := a.store.UnblockUser(me.ID, target.ID); err != nil {
		a.writeFriendErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *API) publicUser(w http.ResponseWriter, r *http.Request) {
	me := a.authUser(w, r)
	if me == nil {
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeErr(w, http.StatusBadRequest, "некорректный запрос")
		return
	}
	card, err := a.store.PublicUser(me.ID, id)
	if err != nil {
		a.writeFriendErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": card})
}
