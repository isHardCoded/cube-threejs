package main

import (
	"math"
	"time"
)

const (
	// Continuous PvP (WASD + splash punch). Enabled for all ModePvP hubs.
	FreeMaxSpeed     = 8.5
	FreePoseMinGap   = 40 * time.Millisecond
	PunchCooldownFree = 480 * time.Millisecond
	PunchRadius      = 1.85
	PunchDamage      = 7
	PunchKnock       = 0.55
)

func (h *Hub) isFreeCombat() bool {
	return h.mode == ModePvP
}

func (p *Player) syncCellFromFree() {
	p.X = int(math.Round(p.FX))
	p.Z = int(math.Round(p.FZ))
}

func (p *Player) freePublic() map[string]any {
	return map[string]any{
		"id": p.ID, "fx": p.FX, "fz": p.FZ,
		"faceX": p.FaceX, "faceZ": p.FaceZ,
		"level": p.Level, "hp": p.HP, "lives": p.Lives,
		"dead": p.Dead, "spectating": p.Spectating,
		"voice": p.VoiceOn,
	}
}

func (h *Hub) freeSpawnInto(p *Player) {
	l, x, z := h.spawnCell()
	p.Level, p.X, p.Z = l, x, z
	p.FX, p.FZ = float64(x), float64(z)
	p.FaceX, p.FaceZ = 0, -1
	p.Orient = StartOrient()
}

func (h *Hub) clampFreePos(p *Player, x, z float64) (float64, float64) {
	span := float64(h.gridSpan()) + 0.35
	if x > span {
		x = span
	} else if x < -span {
		x = -span
	}
	if z > span {
		z = span
	} else if z < -span {
		z = -span
	}
	// Soft push out of solid obstacles (rounded cell).
	cx, cz := int(math.Round(x)), int(math.Round(z))
	if h.isBlocked(p.Level, cx, cz) {
		// Stay put — client will be corrected to last good pose.
		return p.FX, p.FZ
	}
	return x, z
}

func (h *Hub) onFreePose(p *Player, msg clientMsg, now time.Time) {
	if !h.isFreeCombat() || p.Dead {
		return
	}
	if now.Before(p.nextPoseAt) {
		return
	}
	p.nextPoseAt = now.Add(FreePoseMinGap)

	nx, nz := msg.X, msg.Z
	if math.IsNaN(nx) || math.IsNaN(nz) || math.IsInf(nx, 0) || math.IsInf(nz, 0) {
		return
	}
	dx, dz := nx-p.FX, nz-p.FZ
	dist := math.Hypot(dx, dz)
	// Cap how far one pose can jump (anti-teleport). Allow a little slack for lag.
	maxStep := FreeMaxSpeed * 0.12 // ~120ms worth
	if dist > maxStep && dist > 0.001 {
		s := maxStep / dist
		nx = p.FX + dx*s
		nz = p.FZ + dz*s
	}
	nx, nz = h.clampFreePos(p, nx, nz)
	p.FX, p.FZ = nx, nz
	p.syncCellFromFree()

	fx, fz := msg.FaceX, msg.FaceZ
	if fl := math.Hypot(fx, fz); fl > 1e-4 {
		p.FaceX, p.FaceZ = fx/fl, fz/fl
	}

	h.broadcast(map[string]any{
		"t": "pose", "id": p.ID,
		"fx": p.FX, "fz": p.FZ, "level": p.Level,
		"faceX": p.FaceX, "faceZ": p.FaceZ,
	})

	if h.isHole(p.Level, p.X, p.Z) {
		h.fallDeath(p, now)
	}
}

func (h *Hub) onFreePunch(p *Player, now time.Time) {
	if !h.isFreeCombat() || p.Dead {
		return
	}
	if onCooldown(now, p.punchReadyAt) {
		h.sendTo(p, map[string]any{"t": "denied", "reason": "punch_cooldown"})
		return
	}
	p.punchReadyAt = now.Add(PunchCooldownFree)

	side := 1
	if now.UnixNano()&1 == 0 {
		side = -1
	}
	h.broadcast(map[string]any{
		"t": "splash", "id": p.ID,
		"fx": p.FX, "fz": p.FZ, "level": p.Level,
		"r": PunchRadius, "side": side,
		"faceX": p.FaceX, "faceZ": p.FaceZ,
	})

	for _, d := range h.players {
		if d == p || d.Dead || d.Spectating || d.Level != p.Level {
			continue
		}
		if math.Hypot(d.FX-p.FX, d.FZ-p.FZ) > PunchRadius {
			continue
		}
		h.resolveSplashHit(p, d, now)
	}
}

func (h *Hub) resolveSplashHit(a, d *Player, now time.Time) {
	dmg := PunchDamage
	d.HP -= dmg
	if d.HP < 0 {
		d.HP = 0
	}
	a.damageDealt += dmg

	// Knock victim away from attacker.
	kx, kz := d.FX-a.FX, d.FZ-a.FZ
	kl := math.Hypot(kx, kz)
	if kl < 1e-4 {
		kx, kz = a.FaceX, a.FaceZ
		kl = math.Hypot(kx, kz)
	}
	if kl > 1e-4 {
		kx, kz = kx/kl*PunchKnock, kz/kl*PunchKnock
		d.FX, d.FZ = h.clampFreePos(d, d.FX+kx, d.FZ+kz)
		d.syncCellFromFree()
	}

	h.broadcast(map[string]any{
		"t": "hit", "a": a.ID, "d": d.ID,
		"dmgToD": dmg, "dmgToA": 0,
		"hpA": a.HP, "hpD": d.HP,
		"dx": kx, "dz": kz,
		"splash": true,
		"fx":     d.FX, "fz": d.FZ,
	})

	if d.HP <= 0 {
		a.kills++
		a.roundKills++
		h.kill(d, now)
	} else if h.isHole(d.Level, d.X, d.Z) {
		h.fallDeath(d, now)
	}
}

func (h *Hub) onVoiceToggle(p *Player, on bool) {
	if !h.isFreeCombat() {
		return
	}
	p.VoiceOn = on
	h.broadcast(map[string]any{"t": "voice", "id": p.ID, "on": on})
}

// Relay WebRTC signaling between peers (offer / answer / ICE).
func (h *Hub) onVoiceSignal(from *Player, msg clientMsg) {
	if !h.isFreeCombat() || msg.To == "" || msg.To == from.ID {
		return
	}
	target := h.players[msg.To]
	if target == nil {
		return
	}
	out := map[string]any{
		"t": msg.T, "from": from.ID, "to": msg.To,
	}
	if msg.Sdp != "" {
		out["sdp"] = msg.Sdp
	}
	if len(msg.Candidate) > 0 {
		out["candidate"] = msg.Candidate
	}
	h.sendTo(target, out)
}
