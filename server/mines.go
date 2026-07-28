package main

import "time"

// Class abilities. Only one class exists so far; the check stays explicit so
// adding a second class is a data change, not a hunt through the movement code.
const ClassUniversal = "universal"

func classCanMine(classID string) bool {
	return classID == "" || classID == ClassUniversal
}

const (
	MineDamage    = 8
	MineCooldown  = 8 * time.Second
	MineLifetime  = 30 * time.Second
	MaxMinesAlive = 2 // per player
)

// A mine is only ever sent to the player who placed it: a trap everyone can see
// is just a wall. Victims learn about it from the explosion.
type Mine struct {
	Level int    `json:"level"`
	X     int    `json:"x"`
	Z     int    `json:"z"`
	Owner string `json:"owner"`

	expires time.Time
}

func mineKey(l, x, z int) [3]int { return [3]int{l, x, z} }

func (h *Hub) mineAt(l, x, z int) *Mine {
	return h.mines[mineKey(l, x, z)]
}

// minesOf lists the mines a player still owns; used for the count limit and to
// restore them after a reconnect (ids are stable per account).
func (h *Hub) minesOf(id string) []*Mine {
	var out []*Mine
	for _, m := range h.mines {
		if m.Owner == id {
			out = append(out, m)
		}
	}
	return out
}

func (h *Hub) placeMine(p *Player, now time.Time) {
	if !classCanMine(p.ClassID) {
		h.sendTo(p, map[string]any{"t": "denied", "reason": "no_ability"})
		return
	}
	if now.Before(p.mineReadyAt) {
		h.sendTo(p, map[string]any{"t": "denied", "reason": "mine_cooldown"})
		return
	}
	if len(h.minesOf(p.ID)) >= MaxMinesAlive {
		h.sendTo(p, map[string]any{"t": "denied", "reason": "mine_limit"})
		return
	}
	l, x, z := p.Level, p.X, p.Z
	// no stacking, and never on the trampoline: that cell is everyone's escape
	if h.mineAt(l, x, z) != nil || h.isTramp(l, x, z) || h.isHole(l, x, z) {
		h.sendTo(p, map[string]any{"t": "denied", "reason": "mine_here"})
		return
	}

	m := &Mine{Level: l, X: x, Z: z, Owner: p.ID, expires: now.Add(MineLifetime)}
	h.mines[mineKey(l, x, z)] = m
	p.mineReadyAt = now.Add(MineCooldown)
	h.sendTo(p, map[string]any{
		"t": "mine", "level": l, "x": x, "z": z,
		"expiresMs": MineLifetime.Milliseconds(),
	})
}

// mineTrigger fires when a player ends a move on an armed cell. Owners walk
// over their own mines safely, otherwise laying one would be suicide.
func (h *Hub) mineTrigger(p *Player, now time.Time) {
	m := h.mineAt(p.Level, p.X, p.Z)
	if m == nil || m.Owner == p.ID {
		return
	}
	h.removeMine(m)

	p.HP -= MineDamage
	owner := h.players[m.Owner]
	if owner != nil {
		owner.damageDealt += MineDamage
	}
	h.broadcast(map[string]any{
		"t": "mineBoom", "level": m.Level, "x": m.X, "z": m.Z,
		"id": p.ID, "dmg": MineDamage, "hp": p.HP,
	})

	if p.HP <= 0 && !p.Dead {
		if owner != nil && owner != p {
			owner.kills++
			owner.roundKills++
		}
		h.kill(p, now)
	}
}

// removeMine disarms a mine and tells its owner, who is the only one drawing it.
func (h *Hub) removeMine(m *Mine) {
	delete(h.mines, mineKey(m.Level, m.X, m.Z))
	if owner := h.players[m.Owner]; owner != nil {
		h.sendTo(owner, map[string]any{
			"t": "mineGone", "level": m.Level, "x": m.X, "z": m.Z,
		})
	}
}

func (h *Hub) expireMines(now time.Time) {
	for _, m := range h.mines {
		if now.After(m.expires) {
			h.removeMine(m)
		}
	}
}

func (h *Hub) clearMines() {
	h.mines = make(map[[3]int]*Mine)
}
