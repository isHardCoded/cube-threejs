package main

import (
	"math"
	"time"
)

type DRRunnerState struct {
	PlayerID string
	Lives    int
	RunX     int // corridor cell X: -1,0,1
	RunZ     int // corridor cell Z (along track)
	Distance float64 // == float64(RunZ), for battle distance checks
	Lane     int     // 0..2 derived from RunX+1
	LaneF    float64
	Speed    float64
	Jumping  bool
	JumpUntil time.Time
	Dashing  bool
	DashUntil time.Time
	Sliding  bool
	SlideUntil time.Time
	Slamming bool
	SlamUntil time.Time
	InvulnUntil time.Time
	DoubleJump  bool
	ShieldCharges int
	BattleHP    int
	BattleDmgMul float64
	BattleHPBonus int
	ObstaclesAvoided int
	BattlesWon       int
	DamageDealt      int
	Pickups          map[string]int
	LightReadyAt     time.Time
	HeavyReadyAt     time.Time
	DashReadyAt      time.Time
	BumpReadyAt      time.Time
	BattleX, BattleZ int
	LastDX, LastDZ   int
	HitEventIDs      map[string]bool
}

func (h *Hub) drEnsureRunner(p *Player) *DRRunnerState {
	if h.drRunners == nil {
		h.drRunners = make(map[string]*DRRunnerState)
	}
	rp := h.drRunners[p.ID]
	if rp == nil {
		rp = &DRRunnerState{
			PlayerID: p.ID, Lives: DRDefaultLives,
			RunX: 0, RunZ: 4, Lane: 1, LaneF: 1, Distance: 4,
			Speed: DRBaseSpeed, BattleHP: DRBattleHealth, BattleDmgMul: 1,
			Pickups: make(map[string]int), HitEventIDs: make(map[string]bool),
			LastDX: 0, LastDZ: 1,
		}
		h.drRunners[p.ID] = rp
		p.X, p.Z = 0, 4
	}
	return rp
}

func (h *Hub) drGrantReturnInvuln(now time.Time) {
	for _, rp := range h.drRunners {
		if rp != nil {
			rp.InvulnUntil = now.Add(DRReturnInvuln)
		}
	}
}

func (h *Hub) drResetBattleHealth() {
	ids := make([]string, 0, 2)
	for id := range h.drRunners {
		ids = append(ids, id)
	}
	for i, id := range ids {
		rp := h.drRunners[id]
		if rp == nil {
			continue
		}
		rp.BattleHP = DRBattleHealth + rp.BattleHPBonus
		rp.BattleX = 0
		if i == 0 {
			rp.BattleZ = -2
		} else {
			rp.BattleZ = 2
		}
		if p := h.players[id]; p != nil {
			p.X, p.Z = rp.BattleX, rp.BattleZ
			p.HP = rp.BattleHP
			p.Orient = StartOrient()
		}
	}
}

func (h *Hub) drOtherID(id string) string {
	for _, p := range h.players {
		if p.ID != id {
			return p.ID
		}
	}
	return ""
}

func (h *Hub) drRunnerTick(now time.Time) {
	h.drMaintainTrack()
	h.drAdvanceWave(now)
	for _, p := range h.players {
		rp := h.drRunners[p.ID]
		if rp == nil {
			continue
		}
		if rp.Lives > 0 {
			h.drTryRespawn(p, rp, now)
		}
		if rp.Lives <= 0 {
			continue
		}
		rp.Lane = rp.RunX + 1
		rp.LaneF = float64(rp.Lane)
		rp.Distance = float64(rp.RunZ)
		if rp.Jumping && now.After(rp.JumpUntil) {
			rp.Jumping = false
		}
		if rp.Dashing && now.After(rp.DashUntil) {
			rp.Dashing = false
		}
	}
	h.drBroadcastRunner(now)
}

// Collapse wave: rows fall on a timer; stand still and it catches you.
func (h *Hub) drAdvanceWave(now time.Time) {
	if h.drState != DRRunning && h.drState != DRBattleApproach && h.drState != DRReturnToRun {
		return
	}
	if h.drWaveAt.IsZero() {
		return
	}
	interval := DRWaveInterval
	lead := h.drLeadDistance()
	if lead > 60 {
		interval = 270 * time.Millisecond
	}
	if lead > 150 {
		interval = 200 * time.Millisecond
	}
	// Catch up multiple rows per hub tick so sub-100ms intervals actually apply.
	for steps := 0; steps < 4 && !now.Before(h.drWaveAt); steps++ {
		h.drWaveZ++
		h.drCrumbleRow(h.drWaveZ)
		h.drWaveAt = h.drWaveAt.Add(interval)
	}

	for _, p := range h.players {
		rp := h.drRunners[p.ID]
		if rp == nil || rp.Lives <= 0 || p.Dead {
			continue
		}
		if now.Before(rp.InvulnUntil) {
			continue
		}
		if rp.RunZ <= h.drWaveZ {
			h.drLoseLife(p, rp, "wave", now)
		}
	}
}

func (h *Hub) drCrumbleRow(z int) {
	if z < 0 {
		return
	}
	if h.destroyed[0] == nil {
		h.destroyed[0] = map[[2]int]bool{}
	}
	cells := make([][2]int, 0, 3)
	for x := -1; x <= 1; x++ {
		key := [2]int{x, z}
		if h.destroyed[0][key] {
			continue
		}
		h.destroyed[0][key] = true
		cells = append(cells, key)
	}
	if len(cells) == 0 {
		return
	}
	list := make([]map[string]any, len(cells))
	for i, c := range cells {
		list[i] = map[string]any{"x": c[0], "z": c[1]}
	}
	h.broadcast(map[string]any{"t": "dr_crumble", "cells": list})
}

// Crumble is wave-only; keep stub so older call sites compile if any remain.
func (h *Hub) drCrumbleBehind(_ *DRRunnerState) {}

func (h *Hub) drLoseLife(p *Player, rp *DRRunnerState, reason string, now time.Time) {
	if rp.Lives <= 0 {
		return
	}
	if p.Dead && !p.Spectating {
		return // already falling / waiting respawn
	}
	rp.Lives--
	p.Lives = rp.Lives
	rp.InvulnUntil = now.Add(DRReturnInvuln)
	delete(rp.Pickups, "speed_boost")
	h.broadcast(map[string]any{
		"t": "dr_life_lost", "id": p.ID, "lives": rp.Lives, "reason": reason,
		"serverTime": now.UnixMilli(),
	})
	// Play fall tumble before respawn / eliminate
	h.broadcast(map[string]any{"t": "death", "id": p.ID, "cause": "fall"})
	if rp.Lives <= 0 {
		p.Dead = true
		p.Spectating = true
		h.drFinishIfEliminated(now)
		return
	}
	p.Dead = true
	p.Spectating = false
	p.respawnAt = now.Add(DRFallAnimDuration)
}

func (h *Hub) drTryRespawn(p *Player, rp *DRRunnerState, now time.Time) {
	if rp == nil || rp.Lives <= 0 {
		return
	}
	if !p.Dead || p.Spectating || now.Before(p.respawnAt) {
		return
	}
	rp.RunX = 0
	// Spawn well ahead of the collapse (wave keeps moving during fall anim).
	rp.RunZ = h.drWaveZ + DRWaveRespawnLead
	if rp.RunZ < 4 {
		rp.RunZ = 4
	}
	if h.destroyed[0] != nil {
		// Clear a short safe pocket so you don't land on already-crumbled tiles.
		for dz := 0; dz <= 4; dz++ {
			for x := -1; x <= 1; x++ {
				delete(h.destroyed[0], [2]int{x, rp.RunZ + dz})
			}
		}
	}
	h.drSyncRunnerPos(p, rp)
	p.Dead = false
	p.Spectating = false
	p.Orient = StartOrient()
	p.HP = DRBattleHealth
	h.broadcast(map[string]any{"t": "respawn", "p": p})
	h.drBroadcastRunner(now)
}

func (h *Hub) drSyncRunnerPos(p *Player, rp *DRRunnerState) {
	rp.Lane = rp.RunX + 1
	rp.LaneF = float64(rp.Lane)
	rp.Distance = float64(rp.RunZ)
	p.X, p.Z = rp.RunX, rp.RunZ
}

func (h *Hub) drBroadcastRunner(now time.Time) {
	players := make([]map[string]any, 0, len(h.drRunners))
	for _, p := range h.players {
		rp := h.drRunners[p.ID]
		if rp == nil {
			continue
		}
		players = append(players, map[string]any{
			"id": p.ID, "name": p.Name, "lives": rp.Lives,
			"distance": rp.Distance, "lane": rp.Lane, "laneF": rp.LaneF,
			"x": rp.RunX, "z": rp.RunZ,
			"speed": rp.Speed, "jumping": rp.Jumping, "dashing": rp.Dashing,
			"invuln": now.Before(rp.InvulnUntil),
			"shield": rp.ShieldCharges, "pickups": rp.Pickups,
			"battleHp": rp.BattleHP,
			"top": p.Top, "east": p.East, "south": p.South,
		})
	}
	tier, _, _, _ := drDifficultyTier(h.drLeadDistance())
	h.broadcast(map[string]any{
		"t": "dr_runner", "serverTime": now.UnixMilli(),
		"players": players, "nextBattle": h.drNextBattleAt,
		"battleIdx": h.drBattleIndex, "tier": tier,
		"matchState": h.drState,
	})
}

func (h *Hub) drResolveObstacles(p *Player, rp *DRRunnerState, now time.Time) {
	if now.Before(rp.InvulnUntil) {
		return
	}
	seg := h.drSegmentAt(float64(rp.RunZ))
	if seg == nil || seg.Safe {
		return
	}
	localZ := float64(rp.RunZ) - seg.StartZ
	laneBit := 1 << (rp.RunX + 1)
	cellZ := int(math.Round(localZ))
	for i := range seg.Obstacles {
		o := &seg.Obstacles[i]
		if o.LaneMask&laneBit == 0 {
			continue
		}
		if int(math.Round(o.Z)) != cellZ {
			continue
		}
		eid := o.ID + ":" + p.ID + ":" + itoa(rp.RunZ)
		if rp.HitEventIDs[eid] || h.drSeenEvent(eid) {
			continue
		}
		cleared := false
		switch o.CollisionType {
		case "jumpable", "hazard":
			cleared = rp.Jumping
		case "slideable":
			cleared = rp.Dashing
		case "gap":
			cleared = rp.Jumping || rp.Dashing
		case "dynamic":
			cleared = rp.Jumping || rp.Dashing
		}
		if cleared {
			rp.ObstaclesAvoided++
			h.drMarkEvent(eid)
			continue
		}
		h.drMarkEvent(eid)
		rp.HitEventIDs[eid] = true
		if rp.ShieldCharges > 0 {
			rp.ShieldCharges--
			rp.InvulnUntil = now.Add(500 * time.Millisecond)
			h.broadcast(map[string]any{"t": "dr_pickup", "id": p.ID, "kind": "shield_break"})
			continue
		}
		h.drLoseLife(p, rp, "obstacle", now)
		return
	}
}

func (h *Hub) drCellBlocked(x, z int, jumping, dashing bool) (blocked bool, gap bool) {
	if h.destroyed[0] != nil && h.destroyed[0][[2]int{x, z}] {
		return true, true // crumbled behind — fall
	}
	seg := h.drSegmentAt(float64(z))
	if seg == nil {
		// Past authored track — treat as void so you can't walk into empty air.
		if z >= 0 {
			return true, true
		}
		return false, false
	}
	if seg.Safe {
		return false, false
	}
	localZ := float64(z) - seg.StartZ
	laneBit := 1 << (x + 1)
	cellZ := int(math.Round(localZ))
	for i := range seg.Obstacles {
		o := &seg.Obstacles[i]
		if o.LaneMask&laneBit == 0 {
			continue
		}
		// Exact cell only — never ghost-block neighbours of a half-cell Z.
		if int(math.Round(o.Z)) != cellZ {
			continue
		}
		switch o.CollisionType {
		case "gap":
			if dashing || jumping {
				return false, true
			}
			return true, true
		case "jumpable":
			if jumping {
				return false, false
			}
			return true, false
		case "slideable":
			if dashing {
				return false, false
			}
			return true, false
		case "hazard":
			// Walk-on hazard: bump like solid, jump clears.
			if jumping {
				return false, false
			}
			return true, false
		default:
			// Walls — go around or short-jump; landing still collides.
			return true, false
		}
	}
	return false, false
}

func (h *Hub) drRunnerAt(x, z int, selfID string) (*Player, *DRRunnerState) {
	for _, o := range h.players {
		if o.ID == selfID {
			continue
		}
		rp := h.drRunners[o.ID]
		if rp != nil && rp.Lives > 0 && rp.RunX == x && rp.RunZ == z {
			return o, rp
		}
	}
	return nil, nil
}

func (h *Hub) drRunStep(p *Player, rp *DRRunnerState, dx, dz, steps int, jumping bool, now time.Time) {
	if dx == 0 && dz == 0 {
		return
	}
	if jumping {
		h.drRunJump(p, rp, dx, dz, now)
		return
	}
	rp.LastDX, rp.LastDZ = dx, dz
	for s := 0; s < steps; s++ {
		nx, nz := rp.RunX+dx, rp.RunZ+dz
		// Don't go behind start
		if nz < 0 {
			h.sendTo(p, map[string]any{"t": "denied", "reason": "blocked"})
			return
		}
		// Side rails = classic fence: walk/dash bump, only a jump clears them (and falls).
		if nx < -1 || nx > 1 {
			h.sendTo(p, map[string]any{"t": "denied", "reason": "blocked"})
			h.sendTo(p, map[string]any{"t": "bump", "id": p.ID, "dx": dx, "dz": dz})
			return
		}
		if opp, orp := h.drRunnerAt(nx, nz, p.ID); opp != nil {
			h.drRunFaceHit(p, rp, opp, orp, dx, dz, now)
			return
		}
		blocked, gap := h.drCellBlocked(nx, nz, false, rp.Dashing)
		if blocked {
			if gap {
				rp.RunX, rp.RunZ = nx, nz
				h.drSyncRunnerPos(p, rp)
				h.broadcast(map[string]any{"t": "move", "p": p, "dx": dx, "dz": dz})
				h.drLoseLife(p, rp, "fall", now)
				return
			}
			h.sendTo(p, map[string]any{"t": "denied", "reason": "blocked"})
			return
		}
		if gap && !rp.Dashing {
			rp.RunX, rp.RunZ = nx, nz
			h.drSyncRunnerPos(p, rp)
			h.broadcast(map[string]any{"t": "move", "p": p, "dx": dx, "dz": dz})
			h.drLoseLife(p, rp, "fall", now)
			return
		}
		rp.RunX, rp.RunZ = nx, nz
		p.Orient = p.Orient.Roll(dx, dz)
		h.drSyncRunnerPos(p, rp)
		h.drResolvePickups(p, rp)
	}
	// If a dash finished on a gap cell, fall.
	if _, gap := h.drCellBlocked(rp.RunX, rp.RunZ, false, false); gap {
		msg := map[string]any{"t": "move", "p": p, "dx": dx, "dz": dz}
		if steps > 1 {
			msg["dash"] = true
		}
		h.broadcast(msg)
		h.drLoseLife(p, rp, "fall", now)
		h.drMaintainTrack()
		h.drBroadcastRunner(now)
		return
	}
	// Move first, then runner snapshot — otherwise the client snaps to the
	// destination before the roll/jump anim and the cube dips under the track.
	msg := map[string]any{"t": "move", "p": p, "dx": dx, "dz": dz}
	if steps > 1 {
		msg["dash"] = true
	}
	h.broadcast(msg)
	h.drMaintainTrack()
	h.drBroadcastRunner(now)
}

// drRunJump: classic 2-cell leap. Mid cell is airborne (solids/gaps cleared);
// landing collides; over the side rails is a fall — always a full 2-cell arc
// like classic fence (never a 1-cell "jerk" into the void).
func (h *Hub) drRunJump(p *Player, rp *DRRunnerState, dx, dz int, now time.Time) {
	rp.LastDX, rp.LastDZ = dx, dz
	rp.Jumping = true
	rp.JumpUntil = now.Add(DRJumpDuration)
	p.jumpReadyAt = now.Add(JumpCooldown)
	p.holdMoves(now, RollCooldown)

	fromX, fromZ := rp.RunX, rp.RunZ
	mx, mz := fromX+dx, fromZ+dz
	lx, lz := fromX+2*dx, fromZ+2*dz

	emitJump := func(toX, toZ int, fall bool) {
		rp.RunX, rp.RunZ = toX, toZ
		h.drSyncRunnerPos(p, rp)
		if !fall {
			h.drResolvePickups(p, rp)
		}
		h.broadcast(map[string]any{
			"t": "move", "p": p, "jump": true,
			"fromX": fromX, "fromZ": fromZ,
			"dx": dx, "dz": dz,
		})
		if fall {
			h.drLoseLife(p, rp, "fall", now)
			return
		}
		h.drMaintainTrack()
		h.drBroadcastRunner(now)
	}

	if mz < 0 || lz < 0 {
		h.sendTo(p, map[string]any{"t": "denied", "reason": "blocked"})
		rp.Jumping = false
		return
	}
	// Over the rails: always leap the full 2 cells (classic fence), then fall.
	if mx < -1 || mx > 1 || lx < -1 || lx > 1 {
		emitJump(lx, lz, true)
		return
	}

	if opp, orp := h.drRunnerAt(lx, lz, p.ID); opp != nil {
		rp.RunX, rp.RunZ = lx, lz
		h.drSyncRunnerPos(p, rp)
		h.broadcast(map[string]any{
			"t": "move", "p": p, "jump": true, "stomp": true,
			"fromX": fromX, "fromZ": fromZ,
			"dx": dx, "dz": dz,
		})
		h.drRunFaceHit(p, rp, opp, orp, dx, dz, now)
		return
	}

	// Landing must be a free floor cell — jump clears the MID air cell only.
	// Never "land on" a rock/crate/wall (jumping=false for landing check).
	landBlocked, landGap := h.drCellBlocked(lx, lz, false, false)
	if landGap {
		emitJump(lx, lz, true)
		return
	}
	if landBlocked {
		// Fall short onto mid if that tile is free (classic).
		midBlocked, midGap := h.drCellBlocked(mx, mz, false, false)
		if midGap {
			emitJump(mx, mz, true)
			return
		}
		if midBlocked {
			h.sendTo(p, map[string]any{"t": "denied", "reason": "blocked"})
			rp.Jumping = false
			return
		}
		if opp, orp := h.drRunnerAt(mx, mz, p.ID); opp != nil {
			h.drRunFaceHit(p, rp, opp, orp, dx, dz, now)
			return
		}
		emitJump(mx, mz, false)
		return
	}
	emitJump(lx, lz, false)
}

func (h *Hub) drRunFaceHit(a *Player, arp *DRRunnerState, d *Player, drp *DRRunnerState, dx, dz int, now time.Time) {
	if now.Before(arp.BumpReadyAt) || now.Before(drp.BumpReadyAt) {
		return
	}
	if now.Before(arp.InvulnUntil) || now.Before(drp.InvulnUntil) {
		return
	}
	dmgToD := a.FaceToward(dx, dz)
	dmgToA := d.FaceToward(-dx, -dz)
	drp.BattleHP -= dmgToD
	arp.BattleHP -= dmgToA
	arp.DamageDealt += dmgToD
	a.damageDealt += dmgToD
	d.damageDealt += dmgToA
	if drp.BattleHP < 0 {
		drp.BattleHP = 0
	}
	if arp.BattleHP < 0 {
		arp.BattleHP = 0
	}
	arp.BumpReadyAt = now.Add(DRRunBumpCooldown)
	drp.BumpReadyAt = now.Add(DRRunBumpCooldown)
	drp.InvulnUntil = now.Add(280 * time.Millisecond)
	arp.InvulnUntil = now.Add(200 * time.Millisecond)

	// Knock defender one cell if free
	kx, kz := drp.RunX+dx, drp.RunZ+dz
	if kx >= -1 && kx <= 1 && kz >= 0 {
		if occ, _ := h.drRunnerAt(kx, kz, d.ID); occ == nil {
			blocked, _ := h.drCellBlocked(kx, kz, false, false)
			if !blocked {
				drp.RunX, drp.RunZ = kx, kz
				h.drSyncRunnerPos(d, drp)
			}
		}
	}

	h.broadcast(map[string]any{
		"t": "hit", "a": a.ID, "d": d.ID,
		"dmgToD": dmgToD, "dmgToA": dmgToA,
		"hpA": arp.BattleHP, "hpD": drp.BattleHP,
		"dx": dx, "dz": dz,
	})
	h.broadcast(map[string]any{
		"t": "dr_run_hit", "a": a.ID, "d": d.ID,
		"dmgToD": dmgToD, "dmgToA": dmgToA,
		"hpA": arp.BattleHP, "hpD": drp.BattleHP,
	})
	h.drBroadcastRunner(now)

	if drp.BattleHP <= 0 {
		h.drLoseLife(d, drp, "hit", now)
		drp.BattleHP = DRBattleHealth
	}
	if arp.BattleHP <= 0 {
		h.drLoseLife(a, arp, "hit", now)
		arp.BattleHP = DRBattleHealth
	}
}

func (h *Hub) drResolvePickups(p *Player, rp *DRRunnerState) {
	seg := h.drSegmentAt(float64(rp.RunZ))
	if seg == nil {
		return
	}
	localZ := float64(rp.RunZ) - seg.StartZ
	cellZ := int(math.Round(localZ))
	kept := make([]DRPickupSpec, 0, len(seg.Pickups))
	for _, pk := range seg.Pickups {
		if pk.Lane == rp.RunX+1 && int(math.Round(pk.Z)) == cellZ {
			h.drApplyPickup(rp, pk.Kind)
			h.broadcast(map[string]any{
				"t": "dr_pickup", "id": p.ID, "kind": pk.Kind, "pickupId": pk.ID,
			})
			continue
		}
		kept = append(kept, pk)
	}
	seg.Pickups = kept
}

func abs64(v float64) float64 {
	if v < 0 {
		return -v
	}
	return v
}

func (h *Hub) drApplyPickup(rp *DRRunnerState, kind string) {
	if rp.Pickups == nil {
		rp.Pickups = make(map[string]int)
	}
	switch kind {
	case "shield":
		if rp.ShieldCharges < 1 {
			rp.ShieldCharges = 1
		}
	case "speed_boost":
		rp.Pickups["speed_boost"] = 1
	case "double_jump":
		rp.DoubleJump = true
		rp.Pickups["double_jump"] = 1
	case "dash_recharge":
		rp.DashReadyAt = time.Time{}
		rp.Pickups["dash_recharge"] = 1
	case "battle_damage":
		rp.BattleDmgMul = 1.15
		rp.Pickups["battle_damage"] = 1
	case "battle_health":
		rp.BattleHPBonus = 20
		rp.Pickups["battle_health"] = 1
	}
}

func (h *Hub) drFindNextSafe(from float64) *DRSegment {
	for _, s := range h.drSegments {
		if s.Safe && s.StartZ+s.Length > from {
			return s
		}
	}
	return h.drAppendSegment(SegRecovery)
}

func (h *Hub) drHandleRunnerInput(p *Player, action, actionID string, now time.Time) {
	if !h.drCanAcceptRunnerInput() {
		return
	}
	if actionID != "" && h.drSeenEvent(actionID) {
		return
	}
	if actionID != "" {
		h.drMarkEvent(actionID)
	}
	rp := h.drEnsureRunner(p)
	if rp.Lives <= 0 {
		return
	}
	dx, dz := 0, 0
	steps := 1
	jumping := false
	switch action {
	case "lane_left", "left":
		dx = -1
	case "lane_right", "right":
		dx = 1
	case "forward", "up":
		dz = 1
	case "back", "down":
		dz = -1
	case "jump":
		h.drHandleRunnerJump(p, 0, 0, now)
		return
	case "dash":
		h.drHandleRunnerDash(p, 0, 0, now)
		return
	default:
		return
	}
	if !p.claimMove(now) {
		h.sendTo(p, map[string]any{"t": "denied", "reason": "cooldown"})
		return
	}
	h.drRunStep(p, rp, dx, dz, steps, jumping, now)
}

// Track forward is +Z. Cam yaw 180 looks down +Z, so classic WASD is screen-mirrored:
// invert both axes (W→+Z forward, A→+X = screen-left).
func (h *Hub) drHandleRunnerMove(p *Player, dx, dz int, now time.Time) {
	rp := h.drEnsureRunner(p)
	if !h.drCanAcceptRunnerInput() || rp.Lives <= 0 || p.Dead {
		return
	}
	if !p.claimMove(now) {
		h.sendTo(p, map[string]any{"t": "denied", "reason": "cooldown"})
		return
	}
	h.drRunStep(p, rp, -dx, -dz, 1, false, now)
}

func (h *Hub) drHandleRunnerJump(p *Player, dx, dz int, now time.Time) {
	rp := h.drEnsureRunner(p)
	if !h.drCanAcceptRunnerInput() || rp.Lives <= 0 || p.Dead {
		return
	}
	if now.Before(p.jumpReadyAt) {
		return
	}
	fx, fz := -dx, -dz
	if fx == 0 && fz == 0 {
		fx, fz = rp.LastDX, rp.LastDZ
	}
	if fx == 0 && fz == 0 {
		fz = 1
	}
	h.drRunStep(p, rp, fx, fz, 2, true, now)
}

func (h *Hub) drHandleRunnerDash(p *Player, dx, dz int, now time.Time) {
	rp := h.drEnsureRunner(p)
	if !h.drCanAcceptRunnerInput() || rp.Lives <= 0 || p.Dead {
		return
	}
	if now.Before(p.dashReadyAt) {
		h.sendTo(p, map[string]any{"t": "denied", "reason": "dash_cooldown"})
		return
	}
	fx, fz := -dx, -dz
	if fx == 0 && fz == 0 {
		fx, fz = rp.LastDX, rp.LastDZ
	}
	if fx == 0 && fz == 0 {
		fz = 1
	}
	rp.Dashing = true
	rp.DashUntil = now.Add(DRDashDuration)
	p.dashReadyAt = now.Add(DashCooldown)
	rp.DashReadyAt = p.dashReadyAt
	h.drRunStep(p, rp, fx, fz, 2, false, now)
}
