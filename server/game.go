package main

import (
	"encoding/json"
	"log"
	mrand "math/rand"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	Half   = 4 // each platform spans [-Half..Half] in both axes
	Levels = 3
	MaxHP  = 30

	// Lives are the match currency: dying costs one and you come back, until the
	// last one is spent and the round is over for you.
	MaxLives = 5

	// slightly below the client's 140ms send gate so network jitter never
	// bunches two legit moves into a cooldown denial (which snaps the cube back)
	RollCooldown = 110 * time.Millisecond
	// Jitter absorber: an input that arrives a hair early is played instead of
	// refused, because every denial snaps the client's predicted cube back a
	// cell. Accepting it costs nothing — the next slot is still counted from the
	// one that was due, so pressing early cannot outpace RollCooldown.
	InputGrace   = 45 * time.Millisecond
	DashCooldown = 5 * time.Second
	JumpCooldown = 1200 * time.Millisecond
	RespawnDelay = 3 * time.Second

	CalmDuration = 60 * time.Second       // timer between destruction waves
	TileInterval = 400 * time.Millisecond // one tile crumbles per interval
)

const (
	modeCalm = iota
	modeCrumble
)

type Player struct {
	ID      string `json:"id"` // account id as text: stable across reconnects
	Name    string `json:"name"`
	SkinID  string `json:"skinId"`
	HatID   string `json:"hatId"`
	ClassID string `json:"classId"`
	Level   int    `json:"level"`
	X       int    `json:"x"`
	Z       int    `json:"z"`
	Orient         // embedded: top/east/south
	HP      int    `json:"hp"`
	Lives   int    `json:"lives"`
	Dead    bool   `json:"dead"`
	// waiting for the next round: out of lives, or joined mid-fight
	Spectating bool `json:"spectating"`

	userID      int64
	client      *Client
	MineSkinID  string // armed onto each mine at place time; not broadcast on the cube
	nextMoveAt  time.Time
	dashReadyAt time.Time
	jumpReadyAt time.Time
	mineReadyAt time.Time
	respawnAt   time.Time
	bumpReadyAt time.Time // rate-limit for wall-bonk VFX relay

	kills       int
	deaths      int
	damageDealt int
	roundKills  int
	// true if this player was on the board when the live round started; mid-round
	// spectators stay false so they do not farm quest progress from the sidelines
	foughtRound bool
}

// onCooldown reports whether an input arriving now is still inside a cooldown.
func onCooldown(now, until time.Time) bool {
	return now.Add(InputGrace).Before(until)
}

// claimMove takes the player's next movement slot, or reports that the roll
// cooldown has not run out yet. Only player commands go through here: movement
// the world causes (knockback, launch) is not rate limited.
func (p *Player) claimMove(now time.Time) bool {
	if onCooldown(now, p.nextMoveAt) {
		return false
	}
	// The next slot is counted from the one that was due, so a press let through
	// early on jitter cannot pull the whole rhythm forward move after move.
	from := p.nextMoveAt
	if from.Before(now) {
		from = now
	}
	p.nextMoveAt = from.Add(RollCooldown)
	return true
}

// holdMoves keeps movement on cooldown for at least d. It never pulls an
// existing deadline forward, and never pushes it past what the client's own
// send gate expects — that gate is what keeps rolls from being denied.
func (p *Player) holdMoves(now time.Time, d time.Duration) {
	if until := now.Add(d); p.nextMoveAt.Before(until) {
		p.nextMoveAt = until
	}
}

type command struct {
	client *Client
	msg    clientMsg
}

type clientMsg struct {
	T  string  `json:"t"` // "move" | "dash" | "jump" | "mine" | "bump" | "ping"
	DX int     `json:"dx"`
	DZ int     `json:"dz"`
	Ts float64 `json:"ts"` // client timestamp echoed by "pong"
}

type Hub struct {
	id         string
	mode       string // training | pvp | ""
	maxPlayers int    // 0 = unlimited
	hostID     int64  // account that can force-start a waiting lobby
	hosted     bool   // true if opened via Create Lobby (may wait alone)
	onEmpty    func(*Hub)
	onJoined   func(userID int64)
	onLeft     func(userID int64)
	quit       chan struct{}
	dismiss    chan string // the arena asks a match room to end, with a reason
	closing    bool

	// allowed is the guest list. The arena writes it as it seats players into a
	// filling lobby while the hub goroutine reads it on join, so it is the one
	// piece of hub state that needs a lock. A nil list lets anyone in.
	guests  sync.Mutex
	allowed map[int64]bool

	// a match room needs players to be worth running: these track how long it has
	// been short of them, whether it ever had enough, and since when it could
	// start — a lobby with seats left waits a moment for the rest to arrive
	thinSince  time.Time
	readySince time.Time
	everFull   bool

	gameMap    *GameMap
	players    map[string]*Player
	register   chan *Client
	unregister chan *Client
	commands   chan command
	evict      chan int64 // account claimed by another map
	awards     chan awardResult
	store      *Store
	presence   *Presence

	destroyed [Levels]map[[2]int]bool
	tramp     [Levels]*[2]int
	mines     map[[3]int]*Mine // keyed by level and cell

	roundState     int
	roundStartedAt time.Time
	roundEndsAt    time.Time // intermission deadline

	phaseMode    int
	phaseLevel   int
	phaseEndsAt  time.Time // calm deadline
	crumbleOrder [][2]int
	nextTileAt   time.Time

	// Arena PvE (ModeArena): hostile cubes, survival / kill-goal waves
	mobs         map[string]*ArenaMob
	nextMobSeq   int
	nextMobSpawn time.Time
	arenaKills   int
	arenaEndsAt  time.Time
	gridHalf     int // 0 = default Half; Arena uses a wider floor
}

// Each map is a separate world: its own hub, round timer and player list.
func NewHub(store *Store, gameMap *GameMap, presence *Presence) *Hub {
	h := &Hub{
		gameMap:    gameMap,
		players:    make(map[string]*Player),
		register:   make(chan *Client, 16),
		unregister: make(chan *Client, 16),
		commands:   make(chan command, 256),
		evict:      make(chan int64, 16),
		awards:     make(chan awardResult, 8),
		store:      store,
		presence:   presence,
		quit:       make(chan struct{}),
		dismiss:    make(chan string, 1),
	}
	for l := 0; l < Levels; l++ {
		h.destroyed[l] = make(map[[2]int]bool)
	}
	h.clearMines()
	h.mobs = make(map[string]*ArenaMob)
	h.startCalm(0, false)
	return h
}

func (h *Hub) Run() {
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-h.quit:
			return
		case c := <-h.register:
			h.onJoin(c)
		case c := <-h.unregister:
			h.onLeave(c)
		case cmd := <-h.commands:
			h.onCommand(cmd)
		case userID := <-h.evict:
			h.onEvict(userID)
		case a := <-h.awards:
			h.onAward(a)
		case reason := <-h.dismiss:
			h.closeMatch(reason)
		case <-ticker.C:
			h.onTick()
		}
	}
}

func (h *Hub) stop() {
	select {
	case <-h.quit:
	default:
		close(h.quit)
	}
}

// allow adds an account to the guest list of a room that is already running.
func (h *Hub) allow(userID int64) {
	h.guests.Lock()
	defer h.guests.Unlock()
	if h.allowed == nil {
		h.allowed = map[int64]bool{}
	}
	h.allowed[userID] = true
}

func (h *Hub) isAllowed(userID int64) bool {
	h.guests.Lock()
	defer h.guests.Unlock()
	return h.allowed == nil || h.allowed[userID]
}

// enqueueClient hands a connection to the hub goroutine, unless the room has
// already shut down: a socket parked on a stopped hub would never be answered.
func (h *Hub) enqueueClient(c *Client) bool {
	select {
	case <-h.quit:
		return false
	case h.register <- c:
		return true
	}
}

// dismissMatch asks the room to end from outside the hub goroutine.
func (h *Hub) dismissMatch(reason string) {
	select {
	case h.dismiss <- reason:
	default: // one dismissal is enough
	}
}

// closeMatch ends the room for everyone still in it and hands it back to the
// arena. Players are told why, so the client can put them back into the search
// instead of leaving them staring at an arena that will never fill up.
func (h *Hub) closeMatch(reason string) {
	if h.closing {
		return
	}
	h.closing = true

	leaving := make([]*Player, 0, len(h.players))
	for _, p := range h.players {
		leaving = append(leaving, p)
	}
	for _, p := range leaving {
		h.sendTo(p, map[string]any{"t": "kicked", "reason": reason})
		// the world is going away, so the account is free again: leaving the
		// stale claim behind would misroute the player's next join
		h.presence.Leave(p.userID, h)
		h.dropPlayer(p)
		if p.client != nil {
			p.client.closeAfterFlush()
		}
	}
	log.Printf("%s: match %s closed: %s", h.gameMap.ID, h.id, reason)
	if h.onEmpty != nil {
		h.onEmpty(h)
	}
	h.stop()
}

// watchMatch keeps a match room honest after a fight has started. Anonymous
// duel rooms that never get a second cube still close after MatchWaitWindow;
// hosted lobbies stay open in waiting so friends can join from the browser.
func (h *Hub) watchMatch(now time.Time) {
	if h.mode != ModePvP || h.closing {
		return
	}
	if h.roundState == roundWaiting && h.hosted {
		h.thinSince = time.Time{}
		return
	}
	if len(h.players) >= MinRoundPlayers {
		h.thinSince = time.Time{}
		return
	}
	if h.thinSince.IsZero() {
		h.thinSince = now
		return
	}
	// the result of the fight stays on screen first; roundTick closes the room
	// when the intermission runs out with nobody left to play against
	if h.roundState == roundOver || now.Sub(h.thinSince) < MatchWaitWindow {
		return
	}
	h.closeMatch(h.thinReason())
}

func (h *Hub) thinReason() string {
	if h.everFull {
		return "opponent_left"
	}
	return "opponent_missing"
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

func (h *Hub) broadcast(v any) {
	data, err := json.Marshal(v)
	if err != nil {
		log.Println("marshal:", err)
		return
	}
	for _, p := range h.players {
		if p.client != nil {
			p.client.trySend(data)
		}
	}
}

func (h *Hub) sendTo(p *Player, v any) {
	data, err := json.Marshal(v)
	if err != nil || p.client == nil {
		return
	}
	p.client.trySend(data)
}

func inBounds(x, z int) bool {
	return x >= -Half && x <= Half && z >= -Half && z <= Half
}

func (h *Hub) gridSpan() int {
	if h != nil && h.gridHalf > 0 {
		return h.gridHalf
	}
	return Half
}

func (h *Hub) inBounds(x, z int) bool {
	hh := h.gridSpan()
	return x >= -hh && x <= hh && z >= -hh && z <= hh
}

// isHole: the tile has crumbled away — stepping here means falling to your death.
func (h *Hub) isHole(l, x, z int) bool {
	return h.destroyed[l][[2]int{x, z}]
}

// isBlocked: an intact obstacle occupies the cell (destroyed obstacles are holes).
func (h *Hub) isBlocked(l, x, z int) bool {
	return h.gameMap.blocked[l][[2]int{x, z}] && !h.isHole(l, x, z)
}

func (h *Hub) playerAt(l, x, z int) *Player {
	for _, p := range h.players {
		if !p.Dead && p.Level == l && p.X == x && p.Z == z {
			return p
		}
	}
	return nil
}

func (h *Hub) cellFree(l, x, z int) bool {
	if !h.inBounds(x, z) || h.isBlocked(l, x, z) || h.isHole(l, x, z) || h.playerAt(l, x, z) != nil {
		return false
	}
	if h.isArena() && l == 0 && h.mobAt(x, z) != nil {
		return false
	}
	return true
}

func (h *Hub) isTramp(l, x, z int) bool {
	tr := h.tramp[l]
	return tr != nil && tr[0] == x && tr[1] == z
}

func (h *Hub) freeSpawnCellOn(l int) (int, int, bool) {
	hh := h.gridSpan()
	for i := 0; i < 64; i++ {
		x := mrand.Intn(2*hh+1) - hh
		z := mrand.Intn(2*hh+1) - hh
		if h.cellFree(l, x, z) && !h.isTramp(l, x, z) {
			return x, z, true
		}
	}
	for x := -hh; x <= hh; x++ {
		for z := -hh; z <= hh; z++ {
			if h.cellFree(l, x, z) && !h.isTramp(l, x, z) {
				return x, z, true
			}
		}
	}
	return 0, 0, false
}

func (h *Hub) countFree(l int) int {
	n := 0
	hh := h.gridSpan()
	for x := -hh; x <= hh; x++ {
		for z := -hh; z <= hh; z++ {
			if h.cellFree(l, x, z) && !h.isTramp(l, x, z) {
				n++
			}
		}
	}
	return n
}

// spawnCell picks the level of the current phase, falling back to any level
// that still has an intact free cell. If the current platform is mostly gone,
// spawn a level higher so the player isn't dropped into an instant death loop.
func (h *Hub) spawnCell() (int, int, int) {
	first := h.phaseLevel
	if h.phaseMode == modeCrumble && first < Levels-1 && h.countFree(first) < 15 {
		first++
	}
	for _, l := range []int{first, first + 1, first + 2, 0, 1, 2} {
		if l < 0 || l >= Levels {
			continue
		}
		if x, z, ok := h.freeSpawnCellOn(l); ok {
			return l, x, z
		}
	}
	return 0, 0, 0
}

// ---------------------------------------------------------------------------
// join / leave / snapshot
// ---------------------------------------------------------------------------

func (h *Hub) phaseInfo() map[string]any {
	info := map[string]any{"level": h.phaseLevel}
	if h.phaseMode == modeCalm {
		info["mode"] = "calm"
		info["remainMs"] = time.Until(h.phaseEndsAt).Milliseconds()
	} else {
		info["mode"] = "crumble"
	}
	return info
}

func (h *Hub) worldSnapshot() map[string]any {
	destroyed := make([][][2]int, Levels)
	for l := 0; l < Levels; l++ {
		cells := make([][2]int, 0, len(h.destroyed[l]))
		for c := range h.destroyed[l] {
			cells = append(cells, c)
		}
		destroyed[l] = cells
	}
	tramps := make([]any, Levels)
	for l := 0; l < Levels; l++ {
		if h.tramp[l] != nil {
			tramps[l] = []int{h.tramp[l][0], h.tramp[l][1]}
		}
	}
	return map[string]any{
		"destroyed": destroyed, "tramps": tramps,
		"phase": h.phaseInfo(), "round": h.roundInfo(),
	}
}

// sanitizeName trims and clamps a nickname; falls back to a generated one.
func sanitizeName(raw string) string {
	name := strings.TrimSpace(raw)
	name = strings.Map(func(r rune) rune {
		if r < 32 { // strip control characters
			return -1
		}
		return r
	}, name)
	runes := []rune(name)
	if len(runes) > 14 {
		name = string(runes[:14])
	}
	if name == "" {
		name = "PLAYER"
	}
	return name
}

func (h *Hub) rejectJoin(c *Client, reason string) {
	h.sendRaw(c, map[string]any{"t": "kicked", "reason": reason})
	c.closeAfterFlush()
	h.presence.Leave(c.userID, h)
}

func (h *Hub) sendRaw(c *Client, v any) {
	data, err := json.Marshal(v)
	if err != nil {
		return
	}
	c.trySend(data)
}

func (h *Hub) onJoin(c *Client) {
	id := strconv.FormatInt(c.userID, 10)

	if !h.isAllowed(c.userID) {
		h.rejectJoin(c, "not_invited")
		return
	}

	// One cube per account: a second tab would otherwise double the farming.
	if old := h.players[id]; old != nil {
		h.kickPlayer(old, "another_session")
	} else if h.maxPlayers > 0 && len(h.players) >= h.maxPlayers {
		h.rejectJoin(c, "room_full")
		return
	}

	l, x, z := h.spawnCell()
	if h.isArena() {
		l, x, z = 0, 0, 0 // centre of the flat floor
	}
	p := &Player{
		ID: id, Name: sanitizeName(c.name), SkinID: c.skinID, HatID: c.hatID, ClassID: c.classID,
		Level: l, X: x, Z: z,
		Orient:     StartOrient(),
		HP:         MaxHP,
		Lives:      MaxLives,
		userID:     c.userID,
		client:     c,
		MineSkinID: c.mineSkinID,
	}
	// a fight in progress is not joinable: watch it out and start with everyone
	// else in the next round. Solo Arena always restarts instead.
	if !h.isArena() && h.roundState != roundWaiting {
		p.Spectating = true
		p.Dead = true
	}
	c.player = p
	h.players[p.ID] = p
	if len(h.players) >= MinRoundPlayers {
		h.everFull = true
	}
	h.store.SessionStarted(p.userID)

	// Arena must be live before welcome so the first snapshot already has the
	// timer / kill goal — otherwise the HUD sits on "practice".
	if h.isArena() && !p.Spectating {
		h.prepareArena(time.Now())
	}

	others := make([]*Player, 0, len(h.players))
	for _, pl := range h.players {
		others = append(others, pl)
	}
	welcome := map[string]any{
		"t": "welcome", "id": p.ID, "mode": h.mode, "players": others,
		"dashCooldownMs": DashCooldown.Milliseconds(),
		"jumpCooldownMs": JumpCooldown.Milliseconds(),
		"mineCooldownMs": MineCooldown.Milliseconds(),
		"maxMines":       MaxMinesAlive,
		"maxLives":       MaxLives,
		// every armed mine is visible to everyone (own and enemy).
		"mines": h.allMines(),
		// the client draws obstacles from this, so both sides agree on what blocks
		"map":    h.gameMap.ID,
		"layout": h.gameMap.Levels,
		// every cube is rendered from this catalog, so skins look the same for all
		"skins": Skins,
		"mineSkinId": c.mineSkinID,
		"mineSkins":  MineSkins,
	}
	for k, v := range h.worldSnapshot() {
		welcome[k] = v
	}
	if h.isArena() {
		welcome["maxLives"] = 1
		welcome["maxHp"] = ArenaMaxHP
		welcome["half"] = h.gridSpan()
		welcome["mobs"] = h.mobList()
		welcome["arena"] = h.arenaInfo(time.Now())
	}
	h.sendTo(p, welcome)
	for _, pl := range h.players {
		if pl.ID != p.ID {
			h.sendTo(pl, map[string]any{"t": "join", "p": p})
		}
	}
	if h.mode == ModePvP {
		h.broadcast(map[string]any{"t": "round", "round": h.roundInfo()})
	}
	role := "playing"
	if p.Spectating {
		role = "watching"
	}
	log.Printf("join %s on %s at L%d (%d,%d) %s, players=%d",
		p.ID, h.gameMap.ID, l, x, z, role, len(h.players))
	if h.onJoined != nil {
		h.onJoined(c.userID)
	}
}

// dropPlayer takes a player out of the world and tells the remaining ones.
// It deliberately leaves Presence alone: a kicked player is usually being
// replaced right away, either here or on another map.
func (h *Hub) dropPlayer(p *Player) {
	delete(h.players, p.ID)
	h.store.SessionEnded(p.userID, p.kills, p.deaths, p.damageDealt)
	h.broadcast(map[string]any{"t": "leave", "id": p.ID})
}

// kickPlayer retires a connection that lost its claim on the account.
func (h *Hub) kickPlayer(p *Player, reason string) {
	h.sendTo(p, map[string]any{"t": "kicked", "reason": reason})
	h.dropPlayer(p)
	if p.client != nil {
		p.client.closeAfterFlush()
	}
}

// onEvict runs when the account showed up on a different map.
func (h *Hub) onEvict(userID int64) {
	p := h.players[strconv.FormatInt(userID, 10)]
	if p == nil {
		return
	}
	h.kickPlayer(p, "another_session")
	log.Printf("%s: %s left for another map", h.gameMap.ID, p.ID)
	if h.onLeft != nil {
		h.onLeft(userID)
	}
	// the evicted socket never reaches onLeave, so this is the only chance to
	// hand an emptied world back instead of leaving its ticker running
	if len(h.players) == 0 && h.onEmpty != nil {
		h.onEmpty(h)
	}
}

func (h *Hub) onLeave(c *Client) {
	p := c.player
	// a reconnect may already have replaced this player: only the live one leaves
	if p == nil || h.players[p.ID] != p {
		return
	}
	h.dropPlayer(p)
	h.presence.Leave(p.userID, h)
	log.Printf("leave %s on %s, players=%d", p.ID, h.gameMap.ID, len(h.players))
	if h.mode == ModePvP && len(h.players) > 0 {
		h.broadcast(map[string]any{"t": "round", "round": h.roundInfo()})
	}
	// the seat is free again, so the lobby can take somebody else
	if h.onLeft != nil {
		h.onLeft(p.userID)
	}
	if len(h.players) == 0 && h.onEmpty != nil {
		h.onEmpty(h)
	}
}

// ---------------------------------------------------------------------------
// phase machine: calm -> crumble -> next level ... -> reset
// ---------------------------------------------------------------------------

func (h *Hub) startCalm(level int, announce bool) {
	h.phaseMode = modeCalm
	h.phaseLevel = level
	h.phaseEndsAt = time.Now().Add(CalmDuration)
	if announce {
		h.broadcast(map[string]any{
			"t": "phase", "mode": "calm", "level": level,
			"remainMs": CalmDuration.Milliseconds(),
		})
	}
}

func (h *Hub) startCrumble() {
	l := h.phaseLevel
	h.phaseMode = modeCrumble
	h.nextTileAt = time.Now().Add(TileInterval)

	// trampoline near the center (levels 0 and 1 only)
	if l < Levels-1 {
		var candidates [][2]int
		for x := -1; x <= 1; x++ {
			for z := -1; z <= 1; z++ {
				if !h.isBlocked(l, x, z) {
					candidates = append(candidates, [2]int{x, z})
				}
			}
		}
		if len(candidates) > 0 {
			c := candidates[mrand.Intn(len(candidates))]
			h.tramp[l] = &c
			h.broadcast(map[string]any{"t": "tramp", "level": l, "x": c[0], "z": c[1]})
		}
	}

	// destruction order: ring by ring from the rim inward, shuffled within rings,
	// the trampoline cell is spared until the very end
	h.crumbleOrder = h.crumbleOrder[:0]
	for ring := Half; ring >= 0; ring-- {
		var cells [][2]int
		for x := -Half; x <= Half; x++ {
			for z := -Half; z <= Half; z++ {
				r := max(abs(x), abs(z))
				if r != ring || h.isTramp(l, x, z) {
					continue
				}
				cells = append(cells, [2]int{x, z})
			}
		}
		mrand.Shuffle(len(cells), func(i, j int) { cells[i], cells[j] = cells[j], cells[i] })
		h.crumbleOrder = append(h.crumbleOrder, cells...)
	}

	h.broadcast(map[string]any{"t": "phase", "mode": "crumble", "level": l})
	log.Printf("%s: crumble started on level %d", h.gameMap.ID, l)
}

func (h *Hub) crumbleTick(now time.Time) {
	if now.Before(h.nextTileAt) {
		return
	}
	h.nextTileAt = now.Add(TileInterval)
	l := h.phaseLevel

	if len(h.crumbleOrder) == 0 {
		// finally take out the trampoline cell and move on
		if h.tramp[l] != nil {
			c := *h.tramp[l]
			h.tramp[l] = nil
			h.destroyCell(l, c[0], c[1], now)
		}
		if l < Levels-1 {
			h.startCalm(l+1, true)
		} else if h.roundState == roundWaiting {
			// practice loops forever; a match instead ends with its last survivor,
			// which the round machine notices as the final tiles take everyone out
			h.resetRound()
		}
		return
	}

	c := h.crumbleOrder[0]
	h.crumbleOrder = h.crumbleOrder[1:]
	h.destroyCell(l, c[0], c[1], now)
}

func (h *Hub) destroyCell(l, x, z int, now time.Time) {
	h.destroyed[l][[2]int{x, z}] = true
	h.broadcast(map[string]any{"t": "tiles", "level": l, "cells": [][2]int{{x, z}}})
	if m := h.mineAt(l, x, z); m != nil {
		h.removeMine(m) // the tile it sat on is gone
	}
	if p := h.playerAt(l, x, z); p != nil {
		h.fallDeath(p, now)
	}
}

func (h *Hub) resetRound() {
	for l := 0; l < Levels; l++ {
		h.destroyed[l] = make(map[[2]int]bool)
		h.tramp[l] = nil
	}
	h.clearMines() // clients drop their own on "reset"
	h.startCalm(0, false)
	now := time.Now()
	for _, p := range h.players {
		p.Level = 0
		p.HP = MaxHP
		p.Lives = MaxLives
		p.Dead = false
		p.Spectating = false
		p.roundKills = 0
		p.Orient = StartOrient()
		p.nextMoveAt = now
		p.X, p.Z = 0, 0
		if x, z, ok := h.freeSpawnCellOn(0); ok {
			p.X, p.Z = x, z
		}
	}
	list := make([]*Player, 0, len(h.players))
	for _, p := range h.players {
		list = append(list, p)
	}
	h.broadcast(map[string]any{
		"t": "reset", "players": list,
		"phase": h.phaseInfo(), "round": h.roundInfo(),
	})
}

func (h *Hub) onTick() {
	now := time.Now()

	// respawns while lives remain (practice never spends them); the intermission
	// leaves the board frozen, so nobody comes back during it
	if h.roundState != roundOver && !h.isArena() {
		for _, p := range h.players {
			// spectators are the ones out of lives (or waiting for the next round)
			if p.Dead && !p.Spectating && now.After(p.respawnAt) {
				l, x, z := h.spawnCell()
				p.Dead = false
				p.HP = MaxHP
				p.Level, p.X, p.Z = l, x, z
				p.Orient = StartOrient()
				p.nextMoveAt = now
				h.broadcast(map[string]any{"t": "respawn", "p": p})
			}
		}
	}

	h.expireMines(now)
	h.arenaTick(now)
	h.roundTick(now)
	h.watchMatch(now)

	// the arena holds still while the result is on screen
	if h.closing || h.roundState == roundOver {
		return
	}
	if h.isArena() {
		return // flat floor, no crumble waves
	}
	switch h.phaseMode {
	case modeCalm:
		if now.After(h.phaseEndsAt) {
			h.startCrumble()
		}
	case modeCrumble:
		h.crumbleTick(now)
	}
}

// hostStart lets the lobby host skip the fill wait and begin with whoever is in.
func (h *Hub) hostStart(p *Player) {
	if h.mode != ModePvP || h.hostID == 0 || p.userID != h.hostID {
		return
	}
	if h.roundState != roundWaiting || len(h.players) < MinRoundPlayers {
		return
	}
	h.startRound()
}

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------

func (h *Hub) onCommand(cmd command) {
	p := cmd.client.player
	// input from a retired connection (kicked or already gone) is ignored
	if p == nil || h.players[p.ID] != p {
		return
	}
	// host start is allowed even if the cube is somehow marked dead in waiting
	if cmd.msg.T == "start" {
		h.hostStart(p)
		return
	}
	if p.Dead {
		return
	}
	now := time.Now()
	// abilities carry no direction, so they skip the movement validation below
	if cmd.msg.T == "mine" {
		if h.isArena() {
			h.sendTo(p, map[string]any{"t": "denied", "reason": "blocked"})
			return
		}
		h.placeMine(p, now)
		return
	}

	dx, dz := cmd.msg.DX, cmd.msg.DZ
	if !((dx == 0) != (dz == 0)) || dx < -1 || dx > 1 || dz < -1 || dz > 1 {
		return
	}
	switch cmd.msg.T {
	case "move":
		if !p.claimMove(now) {
			h.sendTo(p, map[string]any{"t": "denied", "reason": "cooldown"})
			return
		}
		h.doRoll(p, dx, dz, now)
	case "dash":
		if onCooldown(now, p.dashReadyAt) {
			h.sendTo(p, map[string]any{"t": "denied", "reason": "dash_cooldown"})
			return
		}
		h.doDash(p, dx, dz, now)
	case "jump":
		if onCooldown(now, p.jumpReadyAt) {
			h.sendTo(p, map[string]any{"t": "denied", "reason": "jump_cooldown"})
			return
		}
		h.doJump(p, dx, dz, now)
	case "bump":
		// Visual-only jelly bonk against a wall/obstacle. Rate-limited so a
		// held key cannot flood every client with afterimages.
		if now.Before(p.bumpReadyAt) {
			return
		}
		p.bumpReadyAt = now.Add(120 * time.Millisecond)
		h.broadcast(map[string]any{"t": "bump", "id": p.ID, "dx": dx, "dz": dz})
	}
}

// doRoll steps one cell. The roll cooldown is already spent by the caller, so
// this only decides what the cell does to the player.
func (h *Hub) doRoll(p *Player, dx, dz int, now time.Time) {
	nx, nz := p.X+dx, p.Z+dz
	l := p.Level
	if !h.inBounds(nx, nz) || h.isBlocked(l, nx, nz) {
		h.sendTo(p, map[string]any{"t": "denied", "reason": "blocked"})
		return
	}
	if target := h.playerAt(l, nx, nz); target != nil {
		h.resolveHit(p, target, dx, dz, now)
		return
	}
	if h.isArena() {
		if mob := h.mobAt(nx, nz); mob != nil {
			h.resolveMobHit(p, mob, dx, dz, now, false)
			return
		}
	}
	p.X, p.Z = nx, nz
	p.Orient = p.Orient.Roll(dx, dz)
	h.broadcast(map[string]any{"t": "move", "p": p})
	if h.isHole(l, nx, nz) {
		h.fallDeath(p, now)
		return
	}
	h.landed(p, now)
}

func (h *Hub) doDash(p *Player, dx, dz int, now time.Time) {
	l := p.Level
	moved := 0
	fell := false
	var victim *Player
	var mob *ArenaMob
	for step := 0; step < 2; step++ {
		nx, nz := p.X+dx, p.Z+dz
		if !h.inBounds(nx, nz) || h.isBlocked(l, nx, nz) {
			break
		}
		if t := h.playerAt(l, nx, nz); t != nil {
			victim = t
			break
		}
		if h.isArena() {
			if m := h.mobAt(nx, nz); m != nil {
				mob = m
				break
			}
		}
		p.X, p.Z = nx, nz
		moved++
		if h.isHole(l, nx, nz) {
			fell = true
			break
		}
		if h.isTramp(l, nx, nz) {
			break
		}
		// dashing over a mine sets it off instead of gliding past it
		if m := h.mineAt(l, nx, nz); m != nil && m.Owner != p.ID {
			break
		}
	}
	p.dashReadyAt = now.Add(DashCooldown)
	p.holdMoves(now, RollCooldown)
	if moved > 0 {
		h.broadcast(map[string]any{"t": "move", "p": p, "dash": true, "cells": moved})
	}
	if victim != nil {
		h.resolveHit(p, victim, dx, dz, now)
	} else if mob != nil {
		h.resolveMobHit(p, mob, dx, dz, now, false)
	}
	if fell {
		h.fallDeath(p, now)
		return
	}
	if !p.Dead {
		h.landed(p, now)
	}
}

// doJump: leap two cells in the given direction without changing dice faces.
// The arc clears the fence — jumping past the platform edge is lethal.
func (h *Hub) doJump(p *Player, dx, dz int, now time.Time) {
	l := p.Level
	lx, lz := p.X+2*dx, p.Z+2*dz
	mx, mz := p.X+dx, p.Z+dz
	p.jumpReadyAt = now.Add(JumpCooldown)
	p.holdMoves(now, RollCooldown)

	// over the fence into the void
	if !h.inBounds(lx, lz) {
		p.X, p.Z = lx, lz // client animates the arc out of the arena
		h.broadcast(map[string]any{"t": "move", "p": p, "jump": true})
		h.fallDeath(p, now)
		return
	}

	// Stomp: land on the occupied cell's top face and shove the other die out.
	if t := h.playerAt(l, lx, lz); t != nil {
		p.X, p.Z = lx, lz
		h.broadcast(map[string]any{"t": "move", "p": p, "jump": true, "stomp": true})
		h.resolveStomp(p, t, dx, dz, now)
		if !p.Dead {
			h.landed(p, now)
		}
		return
	}
	if h.isArena() {
		if m := h.mobAt(lx, lz); m != nil {
			p.X, p.Z = lx, lz
			h.broadcast(map[string]any{"t": "move", "p": p, "jump": true, "stomp": true})
			h.resolveMobHit(p, m, dx, dz, now, true)
			if !p.Dead {
				h.landed(p, now)
			}
			return
		}
	}

	// landing on an intact obstacle: fall short onto the middle cell if possible
	if h.isBlocked(l, lx, lz) {
		if h.cellFree(l, mx, mz) || h.isHole(l, mx, mz) {
			p.X, p.Z = mx, mz
			h.broadcast(map[string]any{"t": "move", "p": p, "jump": true})
			if h.isHole(l, mx, mz) {
				h.fallDeath(p, now)
				return
			}
			h.landed(p, now)
		}
		return
	}

	p.X, p.Z = lx, lz
	h.broadcast(map[string]any{"t": "move", "p": p, "jump": true})
	if h.isHole(l, lx, lz) {
		h.fallDeath(p, now)
		return
	}
	h.landed(p, now)
}

// ---------------------------------------------------------------------------
// combat / knockback / trampoline / deaths
// ---------------------------------------------------------------------------

func (h *Hub) resolveHit(a, d *Player, dx, dz int, now time.Time) {
	dmgToD := a.FaceToward(dx, dz)
	dmgToA := d.FaceToward(-dx, -dz)

	d.HP -= dmgToD
	a.HP -= dmgToA
	a.damageDealt += dmgToD
	d.damageDealt += dmgToA

	h.broadcast(map[string]any{
		"t": "hit", "a": a.ID, "d": d.ID,
		"dmgToD": dmgToD, "dmgToA": dmgToA,
		"hpA": a.HP, "hpD": d.HP,
		"dx": dx, "dz": dz,
	})

	if d.HP > 0 {
		if moved, fell := h.knockback(d, dx, dz); moved {
			h.broadcast(map[string]any{"t": "move", "p": d, "knock": true})
			if fell {
				h.fallDeath(d, now)
			} else {
				h.landed(d, now)
			}
		}
	}
	if a.HP > 0 {
		if moved, fell := h.knockback(a, -dx, -dz); moved {
			h.broadcast(map[string]any{"t": "move", "p": a, "knock": true})
			if fell {
				h.fallDeath(a, now)
			} else {
				h.landed(a, now)
			}
		}
	}

	if d.HP <= 0 && !d.Dead {
		a.kills++
		a.roundKills++
		h.kill(d, now)
	}
	if a.HP <= 0 && !a.Dead {
		d.kills++
		d.roundKills++
		h.kill(a, now)
	}
}

// resolveStomp: jumper lands on defender's top face, deals bottom-face damage,
// and only the defender is forced out of the cell (jumper keeps the tile).
func (h *Hub) resolveStomp(a, d *Player, dx, dz int, now time.Time) {
	dmgToD := 7 - a.Top // underside presses onto their top
	if dmgToD < 1 {
		dmgToD = 1
	}

	d.HP -= dmgToD
	a.damageDealt += dmgToD

	h.broadcast(map[string]any{
		"t": "hit", "a": a.ID, "d": d.ID,
		"dmgToD": dmgToD, "dmgToA": 0,
		"hpA": a.HP, "hpD": d.HP,
		"dx": dx, "dz": dz,
		"stomp": true,
	})

	if d.HP > 0 {
		moved, fell := h.displaceFrom(d, dx, dz)
		if moved {
			h.broadcast(map[string]any{"t": "move", "p": d, "knock": true})
			if fell {
				h.fallDeath(d, now)
			} else {
				h.landed(d, now)
			}
		} else {
			// Nowhere to go — crushed under the landing.
			a.kills++
			a.roundKills++
			h.kill(d, now)
		}
	}

	if d.HP <= 0 && !d.Dead {
		a.kills++
		a.roundKills++
		h.kill(d, now)
	}
}

// displaceFrom knocks p out of its cell, preferring (dx,dz), then sides, then back.
func (h *Hub) displaceFrom(p *Player, dx, dz int) (bool, bool) {
	dirs := [][2]int{
		{dx, dz},
		{dz, dx},
		{-dz, -dx},
		{-dx, -dz},
	}
	// Deduplicate when dx/dz axis makes perpendiculars identical.
	seen := map[[2]int]bool{}
	for _, dir := range dirs {
		if dir[0] == 0 && dir[1] == 0 {
			continue
		}
		if seen[dir] {
			continue
		}
		seen[dir] = true
		if moved, fell := h.knockback(p, dir[0], dir[1]); moved {
			return true, fell
		}
	}
	// Last resort: any free cell on this level.
	if x, z, ok := h.freeSpawnCellOn(p.Level); ok {
		p.X, p.Z = x, z
		return true, h.isHole(p.Level, x, z)
	}
	return false, false
}

// knockback pushes p one cell in (dx, dz). The fence stops it at the edge;
// an intact obstacle or player bounces it one cell the opposite way.
// When checking occupancy, ignore `p` itself (stomps leave two dice on one cell briefly).
// Returns (moved, fellIntoHole).
func (h *Hub) knockback(p *Player, dx, dz int) (bool, bool) {
	l := p.Level
	nx, nz := p.X+dx, p.Z+dz
	if !h.inBounds(nx, nz) {
		return false, false
	}
	blocked := h.isBlocked(l, nx, nz) || h.otherPlayerAt(l, nx, nz, p) != nil
	if blocked {
		bx, bz := p.X-dx, p.Z-dz
		if !h.inBounds(bx, bz) || h.isBlocked(l, bx, bz) || h.otherPlayerAt(l, bx, bz, p) != nil {
			return false, false
		}
		p.X, p.Z = bx, bz
		return true, h.isHole(l, bx, bz)
	}
	p.X, p.Z = nx, nz
	return true, h.isHole(l, nx, nz)
}

func (h *Hub) otherPlayerAt(l, x, z int, self *Player) *Player {
	for _, p := range h.players {
		if p != self && !p.Dead && p.Level == l && p.X == x && p.Z == z {
			return p
		}
	}
	return nil
}

// landed runs everything that reacts to a player standing on a cell. Every kind
// of movement — roll, dash, jump, knockback — ends here, so a new cell effect
// cannot be dodged by arriving through a path someone forgot to patch.
func (h *Hub) landed(p *Player, now time.Time) {
	h.mineTrigger(p, now)
	if p.Dead {
		return
	}
	h.trampCheck(p)
}

// trampCheck launches the player to the next level when standing on the trampoline.
func (h *Hub) trampCheck(p *Player) {
	if !h.isTramp(p.Level, p.X, p.Z) {
		return
	}
	nl := p.Level + 1
	tx, tz := p.X, p.Z
	if !h.cellFree(nl, tx, tz) {
		if x, z, ok := h.freeSpawnCellOn(nl); ok {
			tx, tz = x, z
		}
	}
	p.Level, p.X, p.Z = nl, tx, tz
	h.broadcast(map[string]any{"t": "launch", "p": p})
}

// die takes a player off the board. During a match that is final — they watch
// the rest of the round; in practice mode they come back after a short delay.
func (h *Hub) die(p *Player, cause string, now time.Time) {
	p.Dead = true
	p.HP = 0
	p.deaths++
	h.store.Death(p.userID)

	msg := map[string]any{"t": "death", "id": p.ID, "cause": cause}
	// practice costs nothing; in a match every death burns a life
	if h.roundState == roundLive {
		p.Lives--
		msg["lives"] = p.Lives
	}

	if p.Lives <= 0 && h.roundState == roundLive {
		p.Spectating = true
		msg["eliminated"] = true
		msg["alive"] = h.aliveCount()
	} else {
		p.respawnAt = now.Add(RespawnDelay)
		msg["respawnMs"] = RespawnDelay.Milliseconds()
	}
	h.broadcast(msg)

	if h.isArena() && h.roundState == roundLive {
		h.endArena(false, now)
	}
}

func (h *Hub) fallDeath(p *Player, now time.Time) {
	h.die(p, "fall", now)
}

func (h *Hub) kill(p *Player, now time.Time) {
	h.die(p, "hit", now)
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}
