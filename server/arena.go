package main

import (
	"crypto/rand"
	"encoding/hex"
	"log"
	"sort"
	"strconv"
	"sync"
	"time"
)

const (
	ModeTraining = "training"
	ModePvP      = "pvp"

	// How long a ticket holds a seat in a lobby. Short, because an unclaimed seat
	// is a seat the rest of the lobby is waiting on.
	reserveTTL = 45 * time.Second

	// A search slot lives only as long as its owner keeps asking for status.
	// Without that, a closed tab or a phone that went to sleep stays in the
	// queue forever and the next real player is paired with a ghost — which is
	// how somebody ends up alone in an arena nobody is coming to.
	queueTTL = 10 * time.Second
)

// RoomSizes are the lobby sizes players can pick. Two is a duel; the rest are
// free-for-alls that still start as soon as MinRoundPlayers are in.
var RoomSizes = []int{2, 4, 8, 10}

func validRoomSize(n int) bool {
	for _, s := range RoomSizes {
		if s == n {
			return true
		}
	}
	return false
}

// Arena owns ephemeral game rooms: solo training worlds and PvP lobbies.
type Arena struct {
	store    *Store
	presence *Presence

	mu      sync.Mutex
	rooms   map[string]*Hub         // match / training id → hub
	lobbies map[string]*lobby       // pvp rooms the arena can still fill
	queue   []*queueEntry
	duelQueue []*queueEntry         // Duel Run size-2 queue (isolated from PvP)
	pending map[int64]*PendingMatch // userID → seat waiting to be taken
}

// lobby is a PvP room the arena keeps filling. It mirrors the guest list so a
// seat count can be enforced without reading hub state from another goroutine:
// a member is someone in the room, or someone holding a ticket for it.
type lobby struct {
	hub      *Hub
	mapID    string
	capacity int
	hostID   int64
	members  map[int64]bool
}

func (l *lobby) hasRoom() bool { return len(l.members) < l.capacity }

// LobbyPublic is one row in the lobby browser.
type LobbyPublic struct {
	ID       string `json:"id"`
	MapID    string `json:"mapId"`
	Capacity int    `json:"capacity"`
	Players  int    `json:"players"`
	HostID   int64  `json:"hostId"`
	HostName string `json:"hostName"`
	State    string `json:"state"` // waiting | live | over
	Joinable bool   `json:"joinable"`
}

// LobbyMember is one seat on the lobby detail card.
type LobbyMember struct {
	ID        int64  `json:"id"`
	Username  string `json:"username"`
	AvatarURL string `json:"avatarUrl,omitempty"`
	IsHost    bool   `json:"isHost"`
	InRoom    bool   `json:"inRoom"`
}

// LobbyDetail is the lobby browser drill-down.
type LobbyDetail struct {
	LobbyPublic
	Members []LobbyMember `json:"members"`
}

type queueEntry struct {
	UserID int64
	Maps   []string
	Size   int // 0 = any size (quick search)
	Since  time.Time
	Seen   time.Time // last status poll: proof the searcher is still there
}

// DefaultQuickRoom is the lobby size opened when two quick-searchers pair up.
const DefaultQuickRoom = 8

// PendingMatch is the seat a player was given and still has to take.
type PendingMatch struct {
	ID      string `json:"matchId"`
	MapID   string `json:"mapId"`
	Mode    string `json:"mode"`
	Size    int    `json:"size"`
	Expires time.Time
}

// SearchState is what the client polls for: idle, searching or matched.
type SearchState struct {
	State string
	Maps  []string
	Size  int
	Match *PendingMatch
}

// Persistent free-fight lobby: join/leave anytime; never destroyed when empty.
const (
	FreeFightLobbyID  = "pvp-freefight"
	FreeFightCapacity = 16
)

func NewArena(store *Store, presence *Presence) *Arena {
	a := &Arena{
		store:    store,
		presence: presence,
		rooms:    make(map[string]*Hub),
		lobbies:  make(map[string]*lobby),
		pending:  make(map[int64]*PendingMatch),
	}
	a.ensureFreeFightLobbyLocked()
	return a
}

// ensureFreeFightLobbyLocked creates the always-on freefight hub if missing.
// Caller must hold a.mu (except NewArena, which runs before any concurrent use).
func (a *Arena) ensureFreeFightLobbyLocked() *lobby {
	if l := a.lobbies[FreeFightLobbyID]; l != nil {
		return l
	}
	gm := MapByID(FreeFightMapID)
	h := NewHub(a.store, gm, a.presence)
	h.id = FreeFightLobbyID
	h.mode = ModePvP
	h.freeCombat = true
	h.gridHalf = 10
	h.maxPlayers = FreeFightCapacity
	h.hosted = true
	h.roundState = roundLive // continuous fight; no classic round machine
	h.allowed = map[int64]bool{}
	// Empty freefight must stay up — next join reuses the same room.
	h.onEmpty = func(hub *Hub) {
		log.Println("arena: freefight empty (kept alive)", hub.id)
	}
	h.onJoined = func(uid int64) { a.ClaimMatch(uid, FreeFightLobbyID) }
	h.onLeft = func(uid int64) { a.releaseSlot(FreeFightLobbyID, uid) }

	l := &lobby{
		hub: h, mapID: gm.ID, capacity: FreeFightCapacity,
		members: map[int64]bool{},
	}
	a.rooms[FreeFightLobbyID] = h
	a.lobbies[FreeFightLobbyID] = l
	a.startHub(h)
	log.Printf("arena: persistent freefight lobby %s (cap %d)", FreeFightLobbyID, FreeFightCapacity)
	return l
}

// KickUser removes a player from any live hub (ban).
func (a *Arena) KickUser(userID int64, reason string) {
	_ = reason
	a.Dequeue(userID)
	if a.presence != nil {
		a.presence.Kick(userID)
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
	delete(a.lobbies, id)
	// A ticket outliving its room would send the player to a match the server
	// answers with 404. Drop them here so the search reports "idle" instead.
	for uid, m := range a.pending {
		if m.ID == id {
			delete(a.pending, uid)
		}
	}
	a.mu.Unlock()
	if h != nil {
		h.stop()
	}
	log.Println("arena: room closed", id)
}

// releaseSlot frees the seat of a player who left, so the lobby can refill.
func (a *Arena) releaseSlot(roomID string, userID int64) {
	a.mu.Lock()
	defer a.mu.Unlock()
	l := a.lobbies[roomID]
	if l == nil || !l.members[userID] {
		return
	}
	delete(l.members, userID)
	hostChanged := false
	if l.hostID == userID {
		a.reassignHostLocked(l)
		hostChanged = true
	}
	log.Printf("arena: seat freed in %s (%d/%d)", roomID, len(l.members), l.capacity)
	if hostChanged && l.hub != nil {
		l.hub.broadcast(map[string]any{"t": "round", "round": l.hub.roundInfo()})
	}
}

func (a *Arena) reassignHostLocked(l *lobby) {
	l.hostID = 0
	if l.hub != nil {
		l.hub.hostID = 0
	}
	ids := make([]int64, 0, len(l.members))
	for uid := range l.members {
		ids = append(ids, uid)
	}
	if len(ids) == 0 {
		return
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	l.hostID = ids[0]
	if l.hub != nil {
		l.hub.hostID = l.hostID
	}
	log.Printf("arena: host of %s is now %d", l.hub.id, l.hostID)
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

// QuickEnqueue finds any open classic lobby (any map, any size) or waits for one.
func (a *Arena) QuickEnqueue(userID int64) (*PendingMatch, error) {
	return a.Enqueue(userID, allMapIDs(), 0)
}

// FreeEnqueue seats into the persistent freefight lobby (no search / no new rooms).
func (a *Arena) FreeEnqueue(userID int64) (*PendingMatch, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	now := time.Now()
	a.sweepLocked(now)

	if m := a.liveTicketLocked(userID, now); m != nil {
		if m.ID == FreeFightLobbyID {
			return m, nil
		}
		return nil, errAlreadySeated
	}

	l := a.ensureFreeFightLobbyLocked()
	if l.members[userID] {
		return a.admitLocked(l, userID, now), nil
	}
	if !l.hasRoom() {
		return nil, errLobbyFull
	}
	a.dequeueLocked(userID)
	return a.admitLocked(l, userID, now), nil
}

// FreeFightInfo is a snapshot of the persistent freefight lobby for the UI.
func (a *Arena) FreeFightInfo() LobbyPublic {
	a.mu.Lock()
	defer a.mu.Unlock()
	l := a.ensureFreeFightLobbyLocked()
	return a.lobbyPublicLocked(l)
}

// CreateLobby opens a hosted room the founder can start when enough players join.
func (a *Arena) CreateLobby(userID int64, mapID string, size int) (*PendingMatch, error) {
	if !MapExists(mapID) || mapID == ArenaMapID || mapID == DuelRunMapID {
		return nil, errNoMaps
	}
	if !validRoomSize(size) {
		return nil, errBadRoomSize
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	now := time.Now()
	a.sweepLocked(now)

	if m := a.liveTicketLocked(userID, now); m != nil {
		return m, nil
	}
	a.dequeueLocked(userID)
	m := a.openLobbyLocked(mapID, size, now, userID)
	if l := a.lobbies[m.ID]; l != nil && l.hub != nil {
		l.hub.hosted = true
	}
	return m, nil
}

// JoinLobby seats the player in a specific open lobby from the browser.
func (a *Arena) JoinLobby(userID int64, lobbyID string) (*PendingMatch, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	now := time.Now()
	a.sweepLocked(now)

	if m := a.liveTicketLocked(userID, now); m != nil {
		if m.ID == lobbyID {
			return m, nil
		}
		return nil, errAlreadySeated
	}

	l := a.lobbies[lobbyID]
	if l == nil {
		return nil, errLobbyGone
	}
	if l.members[userID] {
		return a.admitLocked(l, userID, now), nil
	}
	if !l.hasRoom() {
		return nil, errLobbyFull
	}
	a.dequeueLocked(userID)
	return a.admitLocked(l, userID, now), nil
}

// ListLobbies returns every PvP room that is still accepting (or showing) seats.
func (a *Arena) ListLobbies() []LobbyPublic {
	a.mu.Lock()
	defer a.mu.Unlock()
	now := time.Now()
	a.sweepLocked(now)

	out := make([]LobbyPublic, 0, len(a.lobbies))
	for _, l := range a.lobbies {
		if l != nil && l.hub != nil && l.hub.mode == ModeDuelRun {
			continue // Duel Run has its own browser
		}
		if l.mapID == FreeFightMapID {
			continue // freefight has its own matchmaking entry
		}
		out = append(out, a.lobbyPublicLocked(l))
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Players != out[j].Players {
			return out[i].Players > out[j].Players
		}
		return out[i].ID < out[j].ID
	})
	return out
}

// LobbyInfo is the detail view for one room.
func (a *Arena) LobbyInfo(lobbyID string) (*LobbyDetail, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	now := time.Now()
	a.sweepLocked(now)

	l := a.lobbies[lobbyID]
	if l == nil {
		return nil, errLobbyGone
	}
	detail := &LobbyDetail{LobbyPublic: a.lobbyPublicLocked(l)}
	ids := make([]int64, 0, len(l.members))
	for uid := range l.members {
		ids = append(ids, uid)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })

	byID := map[int64]OnlineUser{}
	if a.store != nil && a.store.pool != nil && len(ids) > 0 {
		if users, err := a.store.UsersPublicByIDs(ids); err == nil {
			for _, u := range users {
				byID[u.ID] = u
			}
		}
	}
	inRoom := map[int64]bool{}
	if l.hub != nil {
		for _, p := range l.hub.players {
			inRoom[p.userID] = true
		}
	}
	detail.Members = make([]LobbyMember, 0, len(ids))
	for _, uid := range ids {
		u := byID[uid]
		name := u.Username
		if name == "" {
			name = "PLAYER"
		}
		detail.Members = append(detail.Members, LobbyMember{
			ID: uid, Username: name, AvatarURL: u.AvatarURL,
			IsHost: uid == l.hostID, InRoom: inRoom[uid],
		})
	}
	return detail, nil
}

func (a *Arena) lobbyPublicLocked(l *lobby) LobbyPublic {
	hostName := ""
	if a.store != nil && a.store.pool != nil && l.hostID != 0 {
		if u, err := a.store.UserByID(l.hostID); err == nil && u != nil {
			hostName = u.Username
		}
	}
	state := "waiting"
	if l.hub != nil {
		state = roundStateNames[l.hub.roundState]
	}
	return LobbyPublic{
		ID: l.hub.id, MapID: l.mapID, Capacity: l.capacity,
		Players: len(l.members), HostID: l.hostID, HostName: hostName,
		State: state, Joinable: l.hasRoom(),
	}
}

// Enqueue puts the player into PvP search over the given maps and room size.
// Size 0 means "any" (quick search). Calling it again while searching is how
// the client heals a slot the server has forgotten.
func (a *Arena) Enqueue(userID int64, maps []string, size int) (*PendingMatch, error) {
	clean, err := validMaps(maps)
	if err != nil {
		return nil, err
	}
	if size != 0 && !validRoomSize(size) {
		return nil, errBadRoomSize
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	now := time.Now()
	a.sweepLocked(now)

	if m := a.liveTicketLocked(userID, now); m != nil {
		return m, nil
	}

	me := a.entryLocked(userID)
	if me == nil {
		me = &queueEntry{UserID: userID, Since: now}
		a.queue = append(a.queue, me)
	}
	me.Maps = clean
	me.Size = size
	me.Seen = now

	// A lobby that is already filling beats opening another one: it is the only
	// way a bigger room ever reaches its player count.
	if m := a.joinOpenLobbyLocked(userID, clean, size, now); m != nil {
		a.dequeueLocked(userID)
		return m, nil
	}

	// otherwise open a room with the longest-waiting searcher who fits
	for i, other := range a.queue {
		if other.UserID == userID {
			continue
		}
		roomSize := pairedRoomSize(size, other.Size)
		if roomSize == 0 {
			continue
		}
		pick := firstIntersection(other.Maps, clean)
		if pick == "" {
			continue
		}
		a.queue = append(a.queue[:i], a.queue[i+1:]...)
		a.dequeueLocked(userID)
		return a.openLobbyLocked(pick, roomSize, now, other.UserID, userID), nil
	}
	return nil, nil
}

// pairedRoomSize is the lobby capacity two searchers would open together.
// Zero means they are incompatible (different fixed sizes).
func pairedRoomSize(a, b int) int {
	switch {
	case a == 0 && b == 0:
		return DefaultQuickRoom
	case a == 0:
		return b
	case b == 0:
		return a
	case a == b:
		return a
	default:
		return 0
	}
}

// joinOpenLobbyLocked seats the player in the fullest matching lobby that still
// has room, so lobbies complete instead of all sitting half empty.
// size 0 accepts any capacity (quick search).
func (a *Arena) joinOpenLobbyLocked(userID int64, maps []string, size int, now time.Time) *PendingMatch {
	ids := make([]string, 0, len(a.lobbies))
	for id, l := range a.lobbies {
		if !l.hasRoom() || l.members[userID] {
			continue
		}
		if l.hub != nil && l.hub.mode == ModeDuelRun {
			continue
		}
		if size != 0 && l.capacity != size {
			continue
		}
		if !containsMap(maps, l.mapID) {
			continue
		}
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return nil
	}
	sort.Slice(ids, func(i, j int) bool {
		li, lj := a.lobbies[ids[i]], a.lobbies[ids[j]]
		if len(li.members) != len(lj.members) {
			return len(li.members) > len(lj.members)
		}
		return ids[i] < ids[j]
	})
	return a.admitLocked(a.lobbies[ids[0]], userID, now)
}

func (a *Arena) openLobbyLocked(mapID string, size int, now time.Time, first ...int64) *PendingMatch {
	gm := MapByID(mapID)
	id := "pvp-" + newMatchID()
	h := NewHub(a.store, gm, a.presence)
	h.id = id
	h.mode = ModePvP
	h.freeCombat = gm.ID == FreeFightMapID
	if h.freeCombat {
		h.gridHalf = 10 // matches jungle lake basin radius on the client
	}
	h.maxPlayers = size
	h.allowed = map[int64]bool{} // filled as the arena admits players
	if h.freeCombat {
		// Prefer the persistent singleton; if one is ever opened this way, keep it.
		h.hosted = true
		h.roundState = roundLive
		h.onEmpty = func(hub *Hub) {
			log.Println("arena: freefight empty (kept alive)", hub.id)
		}
	} else {
		h.onEmpty = func(hub *Hub) { a.removeRoom(hub.id) }
	}
	h.onJoined = func(uid int64) { a.ClaimMatch(uid, id) }
	h.onLeft = func(uid int64) { a.releaseSlot(id, uid) }

	var hostID int64
	if len(first) > 0 {
		hostID = first[0]
	}
	h.hostID = hostID

	l := &lobby{hub: h, mapID: gm.ID, capacity: size, hostID: hostID, members: map[int64]bool{}}
	a.rooms[id] = h
	a.lobbies[id] = l
	a.startHub(h)
	log.Printf("arena: lobby %s on %s for %d players (host %d)", id, gm.ID, size, hostID)

	var m *PendingMatch
	for _, uid := range first {
		m = a.admitLocked(l, uid, now)
	}
	return m
}

// admitLocked reserves a seat and hands the player the ticket for it.
func (a *Arena) admitLocked(l *lobby, userID int64, now time.Time) *PendingMatch {
	l.members[userID] = true
	l.hub.allow(userID)
	mode := ModePvP
	if l.hub != nil && l.hub.mode != "" {
		mode = l.hub.mode
	}
	m := &PendingMatch{
		ID:      l.hub.id,
		MapID:   l.mapID,
		Mode:    mode,
		Size:    l.capacity,
		Expires: now.Add(reserveTTL),
	}
	a.pending[userID] = m
	log.Printf("arena: %d seated in %s (%d/%d)", userID, l.hub.id, len(l.members), l.capacity)
	return m
}

// Dequeue gives up the search. A seat the player never took is given back, and a
// room left with nobody at all is closed: the players who are already inside keep
// playing, and the lobby stays open for somebody else to fill.
func (a *Arena) Dequeue(userID int64) {
	a.mu.Lock()
	a.dequeueLocked(userID)
	a.dequeueDuelLocked(userID)
	m := a.pending[userID]
	if m == nil {
		a.mu.Unlock()
		return
	}
	delete(a.pending, userID)

	var dead *Hub
	if l := a.lobbies[m.ID]; l != nil {
		delete(l.members, userID)
		if len(l.members) == 0 && l.mapID != FreeFightMapID {
			dead = l.hub
			delete(a.lobbies, m.ID)
			delete(a.rooms, m.ID)
		}
	}
	a.mu.Unlock()

	log.Printf("arena: %d gave up seat in %s", userID, m.ID)
	if dead != nil {
		dead.dismissMatch("lobby_closed")
	}
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

func (a *Arena) entryLocked(userID int64) *queueEntry {
	for _, e := range a.queue {
		if e.UserID == userID {
			return e
		}
	}
	return nil
}

// Status reports queue / match state for the account. The poll behind it doubles
// as the searcher's heartbeat.
func (a *Arena) Status(userID int64) SearchState {
	a.mu.Lock()
	defer a.mu.Unlock()
	now := time.Now()
	a.sweepLocked(now)

	if m := a.liveTicketLocked(userID, now); m != nil {
		return SearchState{State: "matched", Match: m, Size: m.Size}
	}
	if e := a.entryLocked(userID); e != nil {
		e.Seen = now
		return SearchState{State: "searching", Maps: e.Maps, Size: e.Size}
	}
	if e := a.duelEntryLocked(userID); e != nil {
		e.Seen = now
		return SearchState{State: "searching", Maps: e.Maps, Size: e.Size}
	}
	return SearchState{State: "idle"}
}

// IsSearching is true while the account is in the queue or holding a match ticket.
func (a *Arena) IsSearching(userID int64) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	now := time.Now()
	a.sweepLocked(now)
	if a.liveTicketLocked(userID, now) != nil {
		return true
	}
	return a.entryLocked(userID) != nil || a.duelEntryLocked(userID) != nil
}

// ClaimMatch clears the ticket once the player is in the room. The seat stays
// theirs: they are holding it in person now.
func (a *Arena) ClaimMatch(userID int64, matchID string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	m := a.pending[userID]
	if m != nil && m.ID == matchID {
		delete(a.pending, userID)
	}
}

// liveTicketLocked returns the seat the player still has to take, forgetting
// tickets that expired or whose room is already gone.
func (a *Arena) liveTicketLocked(userID int64, now time.Time) *PendingMatch {
	m := a.pending[userID]
	if m == nil {
		return nil
	}
	if now.After(m.Expires) || a.rooms[m.ID] == nil {
		a.forgetTicketLocked(userID, m)
		return nil
	}
	return m
}

func (a *Arena) forgetTicketLocked(userID int64, m *PendingMatch) {
	delete(a.pending, userID)
	if l := a.lobbies[m.ID]; l != nil {
		delete(l.members, userID)
	}
}

// sweepLocked forgets unusable tickets and search slots nobody is polling for.
// Every entry point runs it first, so a ghost can never be picked as an opponent
// and an unclaimed seat cannot block a lobby forever.
func (a *Arena) sweepLocked(now time.Time) {
	for uid, m := range a.pending {
		if now.After(m.Expires) || a.rooms[m.ID] == nil {
			a.forgetTicketLocked(uid, m)
		}
	}
	live := a.queue[:0]
	for _, e := range a.queue {
		if now.Sub(e.Seen) <= queueTTL {
			live = append(live, e)
			continue
		}
		log.Printf("arena: dropped stale search slot of %d", e.UserID)
	}
	a.queue = live
	duelLive := a.duelQueue[:0]
	for _, e := range a.duelQueue {
		if now.Sub(e.Seen) <= queueTTL {
			duelLive = append(duelLive, e)
			continue
		}
		log.Printf("arena: dropped stale duel_run search slot of %d", e.UserID)
	}
	a.duelQueue = duelLive
}

// validMaps normalises the requested maps. An unknown id is refused rather than
// quietly falling back to the default map the way MapByID does: a stale or
// hand-made request must not drop players onto a map none of them picked.
func validMaps(maps []string) ([]string, error) {
	seen := map[string]bool{}
	var out []string
	for _, id := range maps {
		if !MapExists(id) || id == ArenaMapID || id == DuelRunMapID || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	if len(out) == 0 {
		return nil, errNoMaps
	}
	return out, nil
}

func containsMap(maps []string, id string) bool {
	for _, m := range maps {
		if m == id {
			return true
		}
	}
	return false
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

func allMapIDs() []string {
	out := make([]string, 0, len(GameMaps))
	for id := range GameMaps {
		if id == ArenaMapID || id == DuelRunMapID || id == FreeFightMapID {
			continue // mode-specific floors, not in classic PvP matchmaking
		}
		out = append(out, id)
	}
	sort.Strings(out)
	return out
}

var (
	errNoMaps       = errString("выберите хотя бы одну карту")
	errBadRoomSize  = errString("выберите размер комнаты")
	errLobbyGone    = errString("лобби больше не доступно")
	errLobbyFull    = errString("лобби уже заполнено")
	errAlreadySeated = errString("вы уже в другом лобби")
)

type errString string

func (e errString) Error() string { return string(e) }
