package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	mrand "math/rand"
	"time"
)

const (
	Half         = 4 // platform spans [-Half..Half] in both axes
	MaxHP        = 100
	RollCooldown = 260 * time.Millisecond
	DashCooldown = 5 * time.Second
	RespawnDelay = 3 * time.Second
)

// blockedCells mirrors the obstacle layout hardcoded on the client.
var blockedCells = map[[2]int]bool{
	// corner holes
	{-Half, -Half}: true, {Half, Half}: true, {-Half, Half - 1}: true, {Half, -Half}: true,
	// pylons
	{-Half, 0}: true, {-Half, 2}: true, {Half, -2}: true, {2, -Half}: true, {-2, Half}: true, {Half, 3}: true,
	// crates
	{0, -Half}: true, {Half, 1}: true, {-3, Half}: true, {-Half, -2}: true,
}

type Player struct {
	ID     string `json:"id"`
	X      int    `json:"x"`
	Z      int    `json:"z"`
	Orient        // embedded: top/east/south
	HP     int    `json:"hp"`
	Dead   bool   `json:"dead"`

	client      *Client
	nextMoveAt  time.Time
	dashReadyAt time.Time
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
	T  string `json:"t"` // "move" | "dash"
	DX int    `json:"dx"`
	DZ int    `json:"dz"`
}

type Hub struct {
	players    map[string]*Player
	register   chan *Client
	unregister chan *Client
	commands   chan command
	store      *Store
}

func NewHub(store *Store) *Hub {
	return &Hub{
		players:    make(map[string]*Player),
		register:   make(chan *Client, 16),
		unregister: make(chan *Client, 16),
		commands:   make(chan command, 256),
		store:      store,
	}
}

func newID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func (h *Hub) Run() {
	ticker := time.NewTicker(100 * time.Millisecond) // drives respawn timers
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

// broadcast sends msg to every connected player.
func (h *Hub) broadcast(v any) {
	data, err := json.Marshal(v)
	if err != nil {
		log.Println("marshal:", err)
		return
	}
	for _, p := range h.players {
		p.client.trySend(data)
	}
}

func (h *Hub) sendTo(p *Player, v any) {
	data, err := json.Marshal(v)
	if err != nil {
		return
	}
	p.client.trySend(data)
}

func (h *Hub) playerAt(x, z int) *Player {
	for _, p := range h.players {
		if !p.Dead && p.X == x && p.Z == z {
			return p
		}
	}
	return nil
}

func (h *Hub) cellFree(x, z int) bool {
	if x < -Half || x > Half || z < -Half || z > Half {
		return false
	}
	if blockedCells[[2]int{x, z}] {
		return false
	}
	return h.playerAt(x, z) == nil
}

func (h *Hub) freeSpawnCell() (int, int) {
	// try random cells first, then linear scan as a fallback
	for i := 0; i < 64; i++ {
		x := mrand.Intn(2*Half+1) - Half
		z := mrand.Intn(2*Half+1) - Half
		if h.cellFree(x, z) {
			return x, z
		}
	}
	for x := -Half; x <= Half; x++ {
		for z := -Half; z <= Half; z++ {
			if h.cellFree(x, z) {
				return x, z
			}
		}
	}
	return 0, 0 // platform completely full: overlap as a last resort
}

func (h *Hub) onJoin(c *Client) {
	x, z := h.freeSpawnCell()
	p := &Player{
		ID: newID(), X: x, Z: z,
		Orient: StartOrient(),
		HP:     MaxHP,
		client: c,
	}
	c.player = p
	h.players[p.ID] = p
	h.store.SessionStarted(p.ID)

	// snapshot for the newcomer
	others := make([]*Player, 0, len(h.players))
	for _, pl := range h.players {
		others = append(others, pl)
	}
	h.sendTo(p, map[string]any{
		"t": "welcome", "id": p.ID, "players": others,
		"dashCooldownMs": DashCooldown.Milliseconds(),
	})
	// announce to everyone else
	for _, pl := range h.players {
		if pl.ID != p.ID {
			h.sendTo(pl, map[string]any{"t": "join", "p": p})
		}
	}
	log.Printf("join %s at (%d,%d), players=%d", p.ID, x, z, len(h.players))
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

func (h *Hub) onTick() {
	now := time.Now()
	for _, p := range h.players {
		if p.Dead && now.After(p.respawnAt) {
			p.Dead = false
			p.HP = MaxHP
			p.X, p.Z = h.freeSpawnCell()
			p.Orient = StartOrient()
			p.nextMoveAt = now
			h.broadcast(map[string]any{"t": "respawn", "p": p})
		}
	}
}

func (h *Hub) onCommand(cmd command) {
	p := cmd.client.player
	if p == nil || p.Dead {
		return
	}
	dx, dz := cmd.msg.DX, cmd.msg.DZ
	if !((dx == 0) != (dz == 0)) || dx < -1 || dx > 1 || dz < -1 || dz > 1 {
		return // exactly one axis, magnitude 1
	}
	now := time.Now()
	switch cmd.msg.T {
	case "move":
		if now.Before(p.nextMoveAt) {
			return
		}
		h.doRoll(p, dx, dz, now)
	case "dash":
		// dash ignores the roll cooldown (it is triggered by a double-tap right
		// after a move) and is gated only by its own 5s cooldown
		if now.Before(p.dashReadyAt) {
			h.sendTo(p, map[string]any{"t": "denied", "reason": "dash_cooldown"})
			return
		}
		h.doDash(p, dx, dz, now)
	}
}

// doRoll: tip one cell. Rolling into another player = attack (mutual damage), no movement.
func (h *Hub) doRoll(p *Player, dx, dz int, now time.Time) {
	nx, nz := p.X+dx, p.Z+dz
	if nx < -Half || nx > Half || nz < -Half || nz > Half || blockedCells[[2]int{nx, nz}] {
		return
	}
	if target := h.playerAt(nx, nz); target != nil {
		p.nextMoveAt = now.Add(RollCooldown)
		h.resolveHit(p, target, dx, dz, now)
		return
	}
	p.X, p.Z = nx, nz
	p.Orient = p.Orient.Roll(dx, dz)
	p.nextMoveAt = now.Add(RollCooldown)
	h.broadcast(map[string]any{"t": "move", "p": p, "dash": false})
}

// doDash: slide up to 2 cells without rotating. Hitting a player deals damage and stops short.
func (h *Hub) doDash(p *Player, dx, dz int, now time.Time) {
	moved := 0
	var victim *Player
	for step := 0; step < 2; step++ {
		nx, nz := p.X+dx, p.Z+dz
		if nx < -Half || nx > Half || nz < -Half || nz > Half || blockedCells[[2]int{nx, nz}] {
			break
		}
		if t := h.playerAt(nx, nz); t != nil {
			victim = t
			break
		}
		p.X, p.Z = nx, nz
		moved++
	}
	p.dashReadyAt = now.Add(DashCooldown)
	p.nextMoveAt = now.Add(RollCooldown)
	if moved > 0 {
		h.broadcast(map[string]any{"t": "move", "p": p, "dash": true, "cells": moved})
	}
	if victim != nil {
		h.resolveHit(p, victim, dx, dz, now)
	}
}

// resolveHit applies mutual damage: attacker hits with the face pointing at the
// defender, the defender hits back with the face pointing at the attacker.
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

	if d.HP <= 0 {
		a.kills++
		h.kill(d, now)
	}
	if a.HP <= 0 {
		d.kills++
		h.kill(a, now)
	}
}

func (h *Hub) kill(p *Player, now time.Time) {
	p.Dead = true
	p.HP = 0
	p.deaths++
	p.respawnAt = now.Add(RespawnDelay)
	h.store.Death(p.ID)
	h.broadcast(map[string]any{"t": "death", "id": p.ID, "respawnMs": RespawnDelay.Milliseconds()})
}
