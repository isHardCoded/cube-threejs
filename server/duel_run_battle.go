package main

import (
	"time"
)

// Mini-battle on a classic sector grid (same movement as crumbling PvP).
// Positions are integer cells on [-DRArenaHalf..DRArenaHalf].

func (h *Hub) drBattleTick(now time.Time) {
	if !h.drSuddenDeath && now.After(h.drStateEnds) {
		h.drResolveBattleEnd(now)
		return
	}
	if h.drSuddenDeath && now.After(h.drStateEnds) {
		h.drForceSuddenDeathResult(now)
		return
	}
	for _, p := range h.players {
		rp := h.drRunners[p.ID]
		if rp == nil || rp.Lives <= 0 {
			continue
		}
		if !h.drBattleInBounds(rp.BattleX, rp.BattleZ) {
			h.drBattleKO(p, "fall", now)
			return
		}
	}
	h.drBroadcastBattle(now)
}

func (h *Hub) drBattleInBounds(x, z int) bool {
	return x >= -DRArenaHalf && x <= DRArenaHalf && z >= -DRArenaHalf && z <= DRArenaHalf
}

func (h *Hub) drBroadcastBattle(now time.Time) {
	players := make([]map[string]any, 0, 2)
	for _, p := range h.players {
		rp := h.drRunners[p.ID]
		if rp == nil {
			continue
		}
		players = append(players, map[string]any{
			"id": p.ID, "hp": rp.BattleHP,
			"x": rp.BattleX, "z": rp.BattleZ,
			"lives": rp.Lives,
			"top": p.Top, "east": p.East, "south": p.South,
		})
	}
	remain := h.drStateEnds.Sub(now).Milliseconds()
	if remain < 0 {
		remain = 0
	}
	h.broadcast(map[string]any{
		"t": "dr_battle", "serverTime": now.UnixMilli(),
		"players": players, "remainMs": remain, "suddenDeath": h.drSuddenDeath,
		"matchState": h.drState, "half": DRArenaHalf,
	})
}

func (h *Hub) drHandleBattleInput(p *Player, action, actionID string, _bx, _bz float64, now time.Time) {
	if !h.drCanAcceptBattleInput() {
		return
	}
	if actionID != "" && h.drSeenEvent(actionID) {
		return
	}
	if actionID != "" {
		h.drMarkEvent(actionID)
	}
	rp := h.drEnsureRunner(p)
	if rp.Lives <= 0 || rp.BattleHP <= 0 {
		return
	}

	dx, dz := 0, 0
	switch action {
	case "lane_left", "left":
		dx = -1
	case "lane_right", "right":
		dx = 1
	case "jump", "forward", "up":
		dz = 1
	case "slide", "back", "down":
		dz = -1
	case "dash":
		// Dash uses last facing from player orient / stored intent
		dx, dz = h.drBattleFacing(p)
		if dx == 0 && dz == 0 {
			dz = 1
		}
		h.drBattleStep(p, rp, dx, dz, 2, now, actionID)
		return
	case "light", "heavy", "bump":
		// Face combat is on contact via step; treat as move into opponent
		dx, dz = h.drBattleFacing(p)
		if dx == 0 && dz == 0 {
			dz = 1
		}
	case "move":
		return
	default:
		return
	}
	if dx == 0 && dz == 0 {
		return
	}
	if !p.claimMove(now) && action != "dash" {
		return
	}
	h.drBattleStep(p, rp, dx, dz, 1, now, actionID)
}

func (h *Hub) drBattleFacing(p *Player) (int, int) {
	// Prefer last non-zero move stored on runner
	rp := h.drRunners[p.ID]
	if rp != nil && (rp.LastDX != 0 || rp.LastDZ != 0) {
		return rp.LastDX, rp.LastDZ
	}
	return 0, 1
}

func (h *Hub) drBattleStep(p *Player, rp *DRRunnerState, dx, dz, steps int, now time.Time, actionID string) {
	rp.LastDX, rp.LastDZ = dx, dz
	for s := 0; s < steps; s++ {
		nx, nz := rp.BattleX+dx, rp.BattleZ+dz
		if !h.drBattleInBounds(nx, nz) {
			// Stepping off the arena
			rp.BattleX, rp.BattleZ = nx, nz
			h.drBattleKO(p, "fall", now)
			return
		}
		if opp, orp := h.drOpponentAtBattle(nx, nz, p.ID); opp != nil {
			h.drBattleFaceHit(p, rp, opp, orp, dx, dz, now, actionID)
			return
		}
		rp.BattleX, rp.BattleZ = nx, nz
		p.X, p.Z = nx, nz
		p.Orient = p.Orient.Roll(dx, dz)
	}
	h.drBroadcastBattle(now)
}

func (h *Hub) drOpponentAtBattle(x, z int, selfID string) (*Player, *DRRunnerState) {
	for _, o := range h.players {
		if o.ID == selfID {
			continue
		}
		orp := h.drRunners[o.ID]
		if orp != nil && orp.BattleX == x && orp.BattleZ == z && orp.BattleHP > 0 {
			return o, orp
		}
	}
	return nil, nil
}

func (h *Hub) drBattleFaceHit(a *Player, arp *DRRunnerState, d *Player, drp *DRRunnerState, dx, dz int, now time.Time, actionID string) {
	if now.Before(drp.InvulnUntil) || now.Before(arp.InvulnUntil) {
		return
	}
	dmgToD := a.FaceToward(dx, dz)
	dmgToA := d.FaceToward(-dx, -dz)
	// Scale classic faces (1-6) into battle HP space
	dmgToD *= 4
	dmgToA *= 4

	drp.BattleHP -= dmgToD
	arp.BattleHP -= dmgToA
	arp.DamageDealt += dmgToD
	drp.DamageDealt += dmgToA
	a.damageDealt += dmgToD
	d.damageDealt += dmgToA

	h.broadcast(map[string]any{
		"t": "dr_battle_hit", "actionId": actionID,
		"attackerId": a.ID, "victimId": d.ID, "hit": true,
		"dmgToD": dmgToD, "dmgToA": dmgToA,
		"hpA": arp.BattleHP, "hpD": drp.BattleHP,
		"dx": dx, "dz": dz, "attackType": "face",
	})

	// Knock victim one cell if free
	kx, kz := drp.BattleX+dx, drp.BattleZ+dz
	if h.drBattleInBounds(kx, kz) {
		if occ, _ := h.drOpponentAtBattle(kx, kz, d.ID); occ == nil {
			drp.BattleX, drp.BattleZ = kx, kz
			d.X, d.Z = kx, kz
		}
	} else {
		drp.BattleX, drp.BattleZ = kx, kz
		h.drBattleKO(d, "fall", now)
		return
	}
	drp.InvulnUntil = now.Add(280 * time.Millisecond)
	arp.InvulnUntil = now.Add(200 * time.Millisecond)

	if drp.BattleHP <= 0 {
		drp.BattleHP = 0
		h.drBattleKO(d, "hp", now)
		return
	}
	if arp.BattleHP <= 0 {
		arp.BattleHP = 0
		h.drBattleKO(a, "hp", now)
		return
	}
	h.drBroadcastBattle(now)
}

func (h *Hub) drOpponent(p *Player) (*Player, *DRRunnerState) {
	if p == nil {
		return nil, nil
	}
	for _, o := range h.players {
		if o.ID != p.ID {
			return o, h.drRunners[o.ID]
		}
	}
	return nil, nil
}

func (h *Hub) drBattleKO(loser *Player, reason string, now time.Time) {
	if h.drState != DRBattleActive {
		return
	}
	winner, wrp := h.drOpponent(loser)
	lrp := h.drRunners[loser.ID]
	if wrp != nil {
		wrp.BattlesWon++
	}
	h.drBattleWinnerID = ""
	if winner != nil {
		h.drBattleWinnerID = winner.ID
	}
	if lrp != nil {
		h.drLoseLife(loser, lrp, "battle_"+reason, now)
		lrp.InvulnUntil = now.Add(DRLoserBattleShield)
	}
	if wrp != nil {
		wrp.BattleDmgMul = 1
		delete(wrp.Pickups, "battle_damage")
		wrp.BattleHPBonus = 0
		delete(wrp.Pickups, "battle_health")
	}
	if lrp != nil {
		lrp.BattleDmgMul = 1
		lrp.BattleHPBonus = 0
	}
	h.broadcast(map[string]any{
		"t": "dr_battle_result", "winnerId": h.drBattleWinnerID,
		"loserId": loser.ID, "reason": reason,
	})
	if h.drState != DRMatchFinished {
		h.drEnter(DRBattleResult, now)
	}
}

func (h *Hub) drResolveBattleEnd(now time.Time) {
	var a, b *Player
	var ar, br *DRRunnerState
	i := 0
	for _, p := range h.players {
		rp := h.drRunners[p.ID]
		if rp == nil {
			continue
		}
		if i == 0 {
			a, ar = p, rp
		} else {
			b, br = p, rp
		}
		i++
	}
	if a == nil || b == nil {
		h.drEnter(DRBattleResult, now)
		return
	}
	if ar.BattleHP > br.BattleHP {
		h.drBattleKO(b, "timeout_hp", now)
		return
	}
	if br.BattleHP > ar.BattleHP {
		h.drBattleKO(a, "timeout_hp", now)
		return
	}
	if ar.DamageDealt > br.DamageDealt {
		h.drBattleKO(b, "timeout_dmg", now)
		return
	}
	if br.DamageDealt > ar.DamageDealt {
		h.drBattleKO(a, "timeout_dmg", now)
		return
	}
	h.drSuddenDeath = true
	h.drStateEnds = now.Add(DRSuddenDeathDuration)
	h.drBroadcastState(now)
	h.broadcast(map[string]any{"t": "dr_sudden_death", "remainMs": DRSuddenDeathDuration.Milliseconds()})
}

func (h *Hub) drForceSuddenDeathResult(now time.Time) {
	var a, b *Player
	var ar, br *DRRunnerState
	i := 0
	for _, p := range h.players {
		rp := h.drRunners[p.ID]
		if rp == nil {
			continue
		}
		if i == 0 {
			a, ar = p, rp
		} else {
			b, br = p, rp
		}
		i++
	}
	if a == nil || b == nil {
		return
	}
	// Closer to center wins
	da := absInt(ar.BattleX) + absInt(ar.BattleZ)
	db := absInt(br.BattleX) + absInt(br.BattleZ)
	if da < db {
		h.drBattleKO(b, "sudden_death", now)
	} else if db < da {
		h.drBattleKO(a, "sudden_death", now)
	} else if ar.Distance >= br.Distance {
		h.drBattleKO(b, "sudden_death", now)
	} else {
		h.drBattleKO(a, "sudden_death", now)
	}
}

func absInt(v int) int {
	if v < 0 {
		return -v
	}
	return v
}
