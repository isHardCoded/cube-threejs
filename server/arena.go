package main

import (
	"crypto/rand"
	"encoding/hex"
	"log"
	"strconv"
	"sync"
	"time"
)

const (
	ModeTraining = "training"
	ModePvP      = "pvp"

	matchTTL = 2 * time.Minute
)

// Arena owns ephemeral game rooms: solo training worlds and PvP matches.
type Arena struct {
	store    *Store
	presence *Presence

	mu      sync.Mutex
	rooms   map[string]*Hub // match / training id → hub
	queue   []*queueEntry
	pending map[int64]*PendingMatch // userID → matched room waiting for connect
}

type queueEntry struct {
	UserID int64
	Maps   []string
	Since  time.Time
}

// PendingMatch is handed to both players after the queue pairs them.
type PendingMatch struct {
	ID      string `json:"matchId"`
	MapID   string `json:"mapId"`
	Mode    string `json:"mode"`
	Players []int64
	Expires time.Time
}

func NewArena(store *Store, presence *Presence) *Arena {
	return &Arena{
		store:    store,
		presence: presence,
		rooms:    make(map[string]*Hub),
		pending:  make(map[int64]*PendingMatch),
	}
}

func newMatchID() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

func (a *Arena) removeRoom(id string) {
	a.mu.Lock()
	h := a.rooms[id]
	delete(a.rooms, id)
	a.mu.Unlock()
	if h != nil {
		h.stop()
	}
	log.Println("arena: room closed", id)
}

func (a *Arena) startHub(h *Hub) {
	go h.Run()
}

// TrainingHub gives each account a private solo world on the chosen map.
func (a *Arena) TrainingHub(mapID string, userID int64) *Hub {
	gm := MapByID(mapID)
	id := "train-" + strconv.FormatInt(userID, 10) + "-" + gm.ID

	a.mu.Lock()
	defer a.mu.Unlock()
	if h := a.rooms[id]; h != nil {
		return h
	}
	h := NewHub(a.store, gm, a.presence)
	h.id = id
	h.mode = ModeTraining
	h.maxPlayers = 1
	h.allowed = map[int64]bool{userID: true}
	h.onEmpty = func(hub *Hub) { a.removeRoom(hub.id) }
	a.rooms[id] = h
	a.startHub(h)
	log.Println("arena: training room", id)
	return h
}

func (a *Arena) MatchHub(matchID string) *Hub {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.rooms[matchID]
}

func (a *Arena) createPvPMatch(mapID string, aID, bID int64) *PendingMatch {
	gm := MapByID(mapID)
	id := "pvp-" + newMatchID()
	h := NewHub(a.store, gm, a.presence)
	h.id = id
	h.mode = ModePvP
	h.maxPlayers = 2
	h.allowed = map[int64]bool{aID: true, bID: true}
	h.onEmpty = func(hub *Hub) { a.removeRoom(hub.id) }
	h.onJoined = func(userID int64) { a.ClaimMatch(userID, id) }
	a.rooms[id] = h
	a.startHub(h)

	m := &PendingMatch{
		ID:      id,
		MapID:   gm.ID,
		Mode:    ModePvP,
		Players: []int64{aID, bID},
		Expires: time.Now().Add(matchTTL),
	}
	a.pending[aID] = m
	a.pending[bID] = m
	log.Printf("arena: pvp match %s on %s (%d vs %d)", id, gm.ID, aID, bID)
	return m
}

// Enqueue puts the player into PvP search over the given maps.
func (a *Arena) Enqueue(userID int64, maps []string) (*PendingMatch, error) {
	clean := uniqueReadyMaps(maps)
	if len(clean) == 0 {
		return nil, errNoMaps
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	a.purgeExpiredLocked(time.Now())

	// already matched and still valid
	if m := a.pending[userID]; m != nil && time.Now().Before(m.Expires) {
		return m, nil
	}

	// re-queue: drop previous waiting slot
	a.dequeueLocked(userID)

	// try to pair with someone who shares a map
	for i, other := range a.queue {
		if other.UserID == userID {
			continue
		}
		pick := firstIntersection(other.Maps, clean)
		if pick == "" {
			continue
		}
		// remove other from queue
		a.queue = append(a.queue[:i], a.queue[i+1:]...)
		return a.createPvPMatch(pick, other.UserID, userID), nil
	}

	a.queue = append(a.queue, &queueEntry{
		UserID: userID,
		Maps:   clean,
		Since:  time.Now(),
	})
	return nil, nil
}

func (a *Arena) Dequeue(userID int64) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.dequeueLocked(userID)
}

func (a *Arena) dequeueLocked(userID int64) {
	out := a.queue[:0]
	for _, e := range a.queue {
		if e.UserID != userID {
			out = append(out, e)
		}
	}
	a.queue = out
}

// Status reports queue / match state for the account.
func (a *Arena) Status(userID int64) (state string, match *PendingMatch, maps []string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.purgeExpiredLocked(time.Now())

	if m := a.pending[userID]; m != nil {
		return "matched", m, nil
	}
	for _, e := range a.queue {
		if e.UserID == userID {
			return "searching", nil, e.Maps
		}
	}
	return "idle", nil, nil
}

// ClaimMatch clears the pending ticket once the player is in the room.
func (a *Arena) ClaimMatch(userID int64, matchID string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	m := a.pending[userID]
	if m != nil && m.ID == matchID {
		delete(a.pending, userID)
	}
}

func (a *Arena) purgeExpiredLocked(now time.Time) {
	for uid, m := range a.pending {
		if now.After(m.Expires) {
			delete(a.pending, uid)
		}
	}
}

func uniqueReadyMaps(maps []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, id := range maps {
		m := MapByID(id)
		if !seen[m.ID] {
			seen[m.ID] = true
			out = append(out, m.ID)
		}
	}
	return out
}

func firstIntersection(a, b []string) string {
	set := map[string]bool{}
	for _, id := range a {
		set[id] = true
	}
	for _, id := range b {
		if set[id] {
			return id
		}
	}
	return ""
}

var errNoMaps = errString("выберите хотя бы одну карту")

type errString string

func (e errString) Error() string { return string(e) }
