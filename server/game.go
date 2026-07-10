package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	mrand "math/rand"
	"strings"
	"time"
)

const (
	Half   = 4 // each platform spans [-Half..Half] in both axes
	Levels = 3
	MaxHP  = 30

	RollCooldown = 130 * time.Millisecond
	DashCooldown = 5 * time.Second
	JumpCooldown = 1200 * time.Millisecond
	RespawnDelay = 3 * time.Second

	CalmDuration = 60 * time.Second        // timer between destruction waves
	TileInterval = 400 * time.Millisecond  // one tile crumbles per interval
)

const (
	modeCalm = iota
	modeCrumble
)

// Obstacle layouts per level; must mirror the client's prop placement.
var levelBlocked = [Levels]map[[2]int]bool{
	{ // level 0
		{-Half, 0}: true, {-Half, 2}: true, {Half, -2}: true, {2, -Half}: true, {-2, Half}: true, {Half, 3}: true,
		{0, -Half}: true, {Half, 1}: true, {-3, Half}: true, {-Half, -2}: true,
		{2, 2}: true, {-2, -2}: true, {0, 3}: true,
	},
	{ // level 1
		{3, 3}: true, {-3, -3}: true, {0, -3}: true, {3, 0}: true,
		{-1, -1}: true, {1, 3}: true, {-3, 1}: true,
		{-1, 2}: true, {2, -2}: true, {2, 0}: true, {-3, -1}: true,
	},
	{ // level 2: sparse final arena with a blocked center
		{0, 0}: true, {2, 3}: true, {-2, -3}: true,
		{3, -3}: true, {-3, 3}: true, {1, -1}: true, {-1, 1}: true,
	},
}

type Player struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Level  int    `json:"level"`
	X      int    `json:"x"`
	Z      int    `json:"z"`
	Orient        // embedded: top/east/south
	HP     int    `json:"hp"`
	Dead   bool   `json:"dead"`

	client      *Client
	nextMoveAt  time.Time
	dashReadyAt time.Time
	jumpReadyAt time.Time
	respawnAt   time.Time

	kills       int
	deaths      int
	damageDealt int
}

type command struct {
	client *Client
	msg    clientMsg
}

type clientMsg struct {
	T  string `json:"t"` // "move" | "dash" | "jump"
	DX int    `json:"dx"`
	DZ int    `json:"dz"`
}

type Hub struct {
	players    map[string]*Player
	register   chan *Client
	unregister chan *Client
	commands   chan command
	store      *Store

	destroyed [Levels]map[[2]int]bool
	tramp     [Levels]*[2]int

	phaseMode    int
	phaseLevel   int
	phaseEndsAt  time.Time // calm deadline
	crumbleOrder [][2]int
	nextTileAt   time.Time
}

func NewHub(store *Store) *Hub {
	h := &Hub{
		players:    make(map[string]*Player),
		register:   make(chan *Client, 16),
		unregister: make(chan *Client, 16),
		commands:   make(chan command, 256),
		store:      store,
	}
	for l := 0; l < Levels; l++ {
		h.destroyed[l] = make(map[[2]int]bool)
	}
	h.startCalm(0, false)
	return h
}

func newID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func (h *Hub) Run() {
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case c := <-h.register:
			h.onJoin(c)
		case c := <-h.unregister:
			h.onLeave(c)
		case cmd := <-h.commands:
			h.onCommand(cmd)
		case <-ticker.C:
			h.onTick()
		}
	}
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

// isHole: the tile has crumbled away — stepping here means falling to your death.
func (h *Hub) isHole(l, x, z int) bool {
	return h.destroyed[l][[2]int{x, z}]
}

// isBlocked: an intact obstacle occupies the cell (destroyed obstacles are holes).
func (h *Hub) isBlocked(l, x, z int) bool {
	return levelBlocked[l][[2]int{x, z}] && !h.isHole(l, x, z)
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
	return inBounds(x, z) && !h.isBlocked(l, x, z) && !h.isHole(l, x, z) && h.playerAt(l, x, z) == nil
}

func (h *Hub) isTramp(l, x, z int) bool {
	tr := h.tramp[l]
	return tr != nil && tr[0] == x && tr[1] == z
}

func (h *Hub) freeSpawnCellOn(l int) (int, int, bool) {
	for i := 0; i < 64; i++ {
		x := mrand.Intn(2*Half+1) - Half
		z := mrand.Intn(2*Half+1) - Half
		if h.cellFree(l, x, z) && !h.isTramp(l, x, z) {
			return x, z, true
		}
	}
	for x := -Half; x <= Half; x++ {
		for z := -Half; z <= Half; z++ {
			if h.cellFree(l, x, z) && !h.isTramp(l, x, z) {
				return x, z, true
			}
		}
	}
	return 0, 0, false
}

func (h *Hub) countFree(l int) int {
	n := 0
	for x := -Half; x <= Half; x++ {
		for z := -Half; z <= Half; z++ {
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
	return map[string]any{"destroyed": destroyed, "tramps": tramps, "phase": h.phaseInfo()}
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

func (h *Hub) onJoin(c *Client) {
	l, x, z := h.spawnCell()
	p := &Player{
		ID: newID(), Name: sanitizeName(c.name), Level: l, X: x, Z: z,
		Orient: StartOrient(),
		HP:     MaxHP,
		client: c,
	}
	c.player = p
	h.players[p.ID] = p
	h.store.SessionStarted(p.ID)

	others := make([]*Player, 0, len(h.players))
	for _, pl := range h.players {
		others = append(others, pl)
	}
	welcome := map[string]any{
		"t": "welcome", "id": p.ID, "players": others,
		"dashCooldownMs": DashCooldown.Milliseconds(),
		"jumpCooldownMs": JumpCooldown.Milliseconds(),
	}
	for k, v := range h.worldSnapshot() {
		welcome[k] = v
	}
	h.sendTo(p, welcome)
	for _, pl := range h.players {
		if pl.ID != p.ID {
			h.sendTo(pl, map[string]any{"t": "join", "p": p})
		}
	}
	log.Printf("join %s at L%d (%d,%d), players=%d", p.ID, l, x, z, len(h.players))
}

func (h *Hub) onLeave(c *Client) {
	p := c.player
	if p == nil || h.players[p.ID] == nil {
		return
	}
	delete(h.players, p.ID)
	h.store.SessionEnded(p.ID, p.kills, p.deaths, p.damageDealt)
	h.broadcast(map[string]any{"t": "leave", "id": p.ID})
	log.Printf("leave %s, players=%d", p.ID, len(h.players))
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
	log.Printf("crumble started on level %d", l)
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
		} else {
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
	if p := h.playerAt(l, x, z); p != nil {
		h.fallDeath(p, now)
	}
}

func (h *Hub) resetRound() {
	for l := 0; l < Levels; l++ {
		h.destroyed[l] = make(map[[2]int]bool)
		h.tramp[l] = nil
	}
	h.startCalm(0, false)
	now := time.Now()
	for _, p := range h.players {
		p.Level = 0
		p.HP = MaxHP
		p.Dead = false
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
		"phase": h.phaseInfo(),
	})
	log.Println("round reset: everyone back to level 0")
}

func (h *Hub) onTick() {
	now := time.Now()
	for _, p := range h.players {
		if p.Dead && now.After(p.respawnAt) {
			l, x, z := h.spawnCell()
			p.Dead = false
			p.HP = MaxHP
			p.Level, p.X, p.Z = l, x, z
			p.Orient = StartOrient()
			p.nextMoveAt = now
			h.broadcast(map[string]any{"t": "respawn", "p": p})
		}
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

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------

func (h *Hub) onCommand(cmd command) {
	p := cmd.client.player
	if p == nil || p.Dead {
		return
	}
	dx, dz := cmd.msg.DX, cmd.msg.DZ
	if !((dx == 0) != (dz == 0)) || dx < -1 || dx > 1 || dz < -1 || dz > 1 {
		return
	}
	now := time.Now()
	switch cmd.msg.T {
	case "move":
		if now.Before(p.nextMoveAt) {
			h.sendTo(p, map[string]any{"t": "denied", "reason": "cooldown"})
			return
		}
		h.doRoll(p, dx, dz, now)
	case "dash":
		if now.Before(p.dashReadyAt) {
			h.sendTo(p, map[string]any{"t": "denied", "reason": "dash_cooldown"})
			return
		}
		h.doDash(p, dx, dz, now)
	case "jump":
		if now.Before(p.jumpReadyAt) {
			h.sendTo(p, map[string]any{"t": "denied", "reason": "jump_cooldown"})
			return
		}
		h.doJump(p, dx, dz, now)
	}
}

func (h *Hub) doRoll(p *Player, dx, dz int, now time.Time) {
	nx, nz := p.X+dx, p.Z+dz
	l := p.Level
	if !inBounds(nx, nz) || h.isBlocked(l, nx, nz) {
		h.sendTo(p, map[string]any{"t": "denied", "reason": "blocked"})
		return
	}
	if target := h.playerAt(l, nx, nz); target != nil {
		p.nextMoveAt = now.Add(RollCooldown)
		h.resolveHit(p, target, dx, dz, now)
		return
	}
	p.X, p.Z = nx, nz
	p.Orient = p.Orient.Roll(dx, dz)
	p.nextMoveAt = now.Add(RollCooldown)
	h.broadcast(map[string]any{"t": "move", "p": p})
	if h.isHole(l, nx, nz) {
		h.fallDeath(p, now)
		return
	}
	h.trampCheck(p)
}

func (h *Hub) doDash(p *Player, dx, dz int, now time.Time) {
	l := p.Level
	moved := 0
	fell := false
	var victim *Player
	for step := 0; step < 2; step++ {
		nx, nz := p.X+dx, p.Z+dz
		if !inBounds(nx, nz) || h.isBlocked(l, nx, nz) {
			break
		}
		if t := h.playerAt(l, nx, nz); t != nil {
			victim = t
			break
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
	}
	p.dashReadyAt = now.Add(DashCooldown)
	p.nextMoveAt = now.Add(RollCooldown)
	if moved > 0 {
		h.broadcast(map[string]any{"t": "move", "p": p, "dash": true, "cells": moved})
	}
	if victim != nil {
		h.resolveHit(p, victim, dx, dz, now)
	}
	if fell {
		h.fallDeath(p, now)
		return
	}
	if !p.Dead {
		h.trampCheck(p)
	}
}

// doJump: leap two cells in the given direction without changing dice faces.
// The arc clears the fence — jumping past the platform edge is lethal.
func (h *Hub) doJump(p *Player, dx, dz int, now time.Time) {
	l := p.Level
	lx, lz := p.X+2*dx, p.Z+2*dz
	mx, mz := p.X+dx, p.Z+dz
	p.jumpReadyAt = now.Add(JumpCooldown)
	p.nextMoveAt = now.Add(RollCooldown)

	// over the fence into the void
	if !inBounds(lx, lz) {
		p.X, p.Z = lx, lz // client animates the arc out of the arena
		h.broadcast(map[string]any{"t": "move", "p": p, "jump": true})
		h.fallDeath(p, now)
		return
	}

	// landing on another player: mid-air body check
	if t := h.playerAt(l, lx, lz); t != nil {
		if h.cellFree(l, mx, mz) {
			p.X, p.Z = mx, mz
		}
		h.broadcast(map[string]any{"t": "move", "p": p, "jump": true})
		h.resolveHit(p, t, dx, dz, now)
		if !p.Dead {
			h.trampCheck(p)
		}
		return
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
			h.trampCheck(p)
		}
		return
	}

	p.X, p.Z = lx, lz
	h.broadcast(map[string]any{"t": "move", "p": p, "jump": true})
	if h.isHole(l, lx, lz) {
		h.fallDeath(p, now)
		return
	}
	h.trampCheck(p)
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
				h.trampCheck(d)
			}
		}
	}
	if a.HP > 0 {
		if moved, fell := h.knockback(a, -dx, -dz); moved {
			h.broadcast(map[string]any{"t": "move", "p": a, "knock": true})
			if fell {
				h.fallDeath(a, now)
			} else {
				h.trampCheck(a)
			}
		}
	}

	if d.HP <= 0 && !d.Dead {
		a.kills++
		h.kill(d, now)
	}
	if a.HP <= 0 && !a.Dead {
		d.kills++
		h.kill(a, now)
	}
}

// knockback pushes p one cell in (dx, dz). The fence stops it at the edge;
// an intact obstacle or player bounces it one cell the opposite way.
// Returns (moved, fellIntoHole).
func (h *Hub) knockback(p *Player, dx, dz int) (bool, bool) {
	l := p.Level
	nx, nz := p.X+dx, p.Z+dz
	if !inBounds(nx, nz) {
		return false, false
	}
	if h.isBlocked(l, nx, nz) || h.playerAt(l, nx, nz) != nil {
		bx, bz := p.X-dx, p.Z-dz
		if !inBounds(bx, bz) || h.isBlocked(l, bx, bz) || h.playerAt(l, bx, bz) != nil {
			return false, false
		}
		p.X, p.Z = bx, bz
		return true, h.isHole(l, bx, bz)
	}
	p.X, p.Z = nx, nz
	return true, h.isHole(l, nx, nz)
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

func (h *Hub) fallDeath(p *Player, now time.Time) {
	p.Dead = true
	p.HP = 0
	p.deaths++
	p.respawnAt = now.Add(RespawnDelay)
	h.store.Death(p.ID)
	h.broadcast(map[string]any{"t": "death", "id": p.ID, "cause": "fall", "respawnMs": RespawnDelay.Milliseconds()})
}

func (h *Hub) kill(p *Player, now time.Time) {
	p.Dead = true
	p.HP = 0
	p.deaths++
	p.respawnAt = now.Add(RespawnDelay)
	h.store.Death(p.ID)
	h.broadcast(map[string]any{"t": "death", "id": p.ID, "cause": "hit", "respawnMs": RespawnDelay.Milliseconds()})
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}
