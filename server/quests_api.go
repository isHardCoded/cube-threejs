package main

import (
	"errors"
	"log"
	"net/http"
	"time"
)

func (a *API) registerQuestRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/quests", a.questsList)
	mux.HandleFunc("POST /api/quests/claim", a.questsClaim)
	mux.HandleFunc("GET /api/badges", a.badges)
}

func (a *API) questsList(w http.ResponseWriter, r *http.Request) {
	u := a.authUser(w, r)
	if u == nil {
		return
	}
	daily, weekly, claimable, err := a.store.ListQuests(u.ID)
	if err != nil {
		log.Println("api quests:", err)
		writeErr(w, http.StatusInternalServerError, "ошибка сервера")
		return
	}
	now := time.Now()
	writeJSON(w, http.StatusOK, map[string]any{
		"daily":     daily,
		"weekly":    weekly,
		"claimable": claimable,
		"resetsAt": map[string]any{
			"daily":  nextDailyResetUTC(now).UTC().Format(time.RFC3339),
			"weekly": nextWeeklyResetUTC(now).UTC().Format(time.RFC3339),
		},
	})
}

func (a *API) questsClaim(w http.ResponseWriter, r *http.Request) {
	u := a.authUser(w, r)
	if u == nil {
		return
	}
	var body struct {
		ID string `json:"id"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	if body.ID == "" {
		writeErr(w, http.StatusBadRequest, "некорректный запрос")
		return
	}
	reward, balance, err := a.store.ClaimQuest(u.ID, body.ID)
	if err != nil {
		a.writeQuestErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":     true,
		"reward": reward,
		"cubes":  balance,
	})
}

func (a *API) badges(w http.ResponseWriter, r *http.Request) {
	u := a.authUser(w, r)
	if u == nil {
		return
	}
	friends, err := a.store.CountIncomingFriendRequests(u.ID)
	if err != nil {
		log.Println("api badges friends:", err)
		writeErr(w, http.StatusInternalServerError, "ошибка сервера")
		return
	}
	quests, err := a.store.ClaimableQuestCount(u.ID)
	if err != nil {
		log.Println("api badges quests:", err)
		writeErr(w, http.StatusInternalServerError, "ошибка сервера")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"friendRequests":  friends,
		"questsClaimable": quests,
	})
}

func (a *API) writeQuestErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrUnknownQuest):
		writeErr(w, http.StatusNotFound, "квест не найден")
	case errors.Is(err, ErrQuestIncomplete):
		writeErr(w, http.StatusConflict, "квест ещё не выполнен")
	case errors.Is(err, ErrQuestClaimed):
		writeErr(w, http.StatusConflict, "награда уже получена")
	case errors.Is(err, ErrNoStore):
		writeErr(w, http.StatusServiceUnavailable, "ошибка сервера")
	default:
		log.Println("api quests claim:", err)
		writeErr(w, http.StatusInternalServerError, "ошибка сервера")
	}
}
