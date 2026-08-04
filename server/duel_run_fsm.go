package main

import "time"

// Match FSM states (TZ §5).
const (
	DRWaitingForPlayers = "WAITING_FOR_PLAYERS"
	DRLoading           = "LOADING"
	DRCountdown         = "COUNTDOWN"
	DRRunning           = "RUNNING"
	DRBattleApproach    = "BATTLE_APPROACH"
	DRBattleIntro       = "BATTLE_INTRO"
	DRBattleActive      = "BATTLE_ACTIVE"
	DRBattleResult      = "BATTLE_RESULT"
	DRReturnToRun       = "RETURN_TO_RUN"
	DRPlayerEliminated  = "PLAYER_ELIMINATED"
	DRMatchFinished     = "MATCH_FINISHED"
	DRReconnecting      = "RECONNECTING"
)

func (h *Hub) isDuelRun() bool { return h.mode == ModeDuelRun }

func (h *Hub) drEnter(state string, now time.Time) {
	prev := h.drState
	h.drState = state
	h.drStateEntered = now
	switch state {
	case DRLoading:
		h.drStateEnds = now.Add(DRLoadingDuration)
	case DRCountdown:
		h.drStateEnds = now.Add(DRCountdownDuration)
	case DRBattleIntro:
		h.drStateEnds = now.Add(DRBattleIntroDuration)
	case DRBattleActive:
		h.drSuddenDeath = false
		h.drStateEnds = now.Add(DRBattleDuration)
		h.drResetBattleHealth()
	case DRBattleResult:
		h.drStateEnds = now.Add(DRBattleResultFreeze)
	case DRReturnToRun:
		h.drStateEnds = now.Add(DRCountdownDuration)
		h.drGrantReturnInvuln(now)
	case DRBattleApproach:
		h.drStateEnds = now.Add(2 * time.Second)
	default:
		h.drStateEnds = time.Time{}
	}
	if prev != state {
		h.drBroadcastState(now)
	}
}

func (h *Hub) drCanAcceptRunnerInput() bool {
	if h.drPaused {
		return false
	}
	return h.drState == DRRunning || h.drState == DRReturnToRun || h.drState == DRBattleApproach
}

func (h *Hub) drCanAcceptBattleInput() bool {
	if h.drPaused {
		return false
	}
	return h.drState == DRBattleActive
}

func (h *Hub) drBroadcastState(now time.Time) {
	h.broadcast(map[string]any{
		"t":          "dr_state",
		"matchState": h.drState,
		"serverTime": now.UnixMilli(),
		"endsAt":     h.drStateEnds.UnixMilli(),
		"battleIdx":  h.drBattleIndex,
		"seed":       h.drSeed,
		"nextBattle": h.drNextBattleAt,
		"paused":     h.drPaused,
	})
}

func (h *Hub) drFSMTick(now time.Time) {
	if h.drPaused {
		h.drReconnectTick(now)
		return
	}
	switch h.drState {
	case DRWaitingForPlayers:
		if h.drReadyPlayers() >= drPlayersNeeded() {
			h.drInitMatch(now)
			h.drEnter(DRLoading, now)
		}
	case DRLoading:
		if now.After(h.drStateEnds) {
			h.drEnter(DRCountdown, now)
		}
	case DRCountdown:
		if now.After(h.drStateEnds) {
			h.drEnter(DRRunning, now)
			h.drWaveZ = -1
			h.drWaveAt = now.Add(DRWaveStartDelay)
		}
	case DRRunning:
		h.drRunnerTick(now)
		if h.drCheckBattleTrigger() {
			h.drEnter(DRBattleApproach, now)
		}
	case DRBattleApproach:
		h.drRunnerTick(now) // still advancing on safe stretch
		if now.After(h.drStateEnds) {
			h.drEnter(DRBattleIntro, now)
		}
	case DRBattleIntro:
		if now.After(h.drStateEnds) {
			h.drEnter(DRBattleActive, now)
		}
	case DRBattleActive:
		h.drBattleTick(now)
	case DRBattleResult:
		if now.After(h.drStateEnds) {
			if h.drFinishIfEliminated(now) {
				return
			}
			h.drPrepareReturnToRun(now)
			h.drEnter(DRReturnToRun, now)
		}
	case DRReturnToRun:
		if now.After(h.drStateEnds) {
			h.drBattleIndex++
			h.drScheduleNextBattle()
			h.drEnter(DRRunning, now)
		}
	case DRPlayerEliminated, DRMatchFinished:
		// idle until dismiss / rematch leave
	}
}

func (h *Hub) drReadyPlayers() int {
	n := 0
	for _, p := range h.players {
		if p != nil && !p.Spectating {
			n++
		}
	}
	return n
}

func (h *Hub) drInitMatch(now time.Time) {
	if h.drSeed == 0 {
		h.drSeed = uint64(now.UnixNano())
	}
	h.drBattleIndex = 0
	h.drNextBattleAt = DRFirstBattleDistance
	h.drRng = newDRRng(h.drSeed)
	h.drBuildInitialTrack()
	h.drEventSeen = make(map[string]bool)
	i := 0
	for _, p := range h.players {
		if p == nil {
			continue
		}
		rp := h.drEnsureRunner(p)
		rp.Lives = DRDefaultLives
		rp.RunX = 0
		rp.RunZ = 4 + i*2 // slight stagger so they don't spawn stacked
		rp.Lane = 1
		rp.LaneF = 1
		rp.Distance = float64(rp.RunZ)
		rp.Speed = DRBaseSpeed
		rp.InvulnUntil = time.Time{}
		rp.BattleHP = DRBattleHealth
		rp.ObstaclesAvoided = 0
		rp.BattlesWon = 0
		rp.DamageDealt = 0
		rp.Pickups = nil
		rp.LastDX, rp.LastDZ = 0, 1
		p.Lives = DRDefaultLives
		p.HP = DRBattleHealth
		p.X, p.Z = rp.RunX, rp.RunZ
		p.Dead = false
		p.Spectating = false
		p.Orient = StartOrient()
		i++
	}
}

func (h *Hub) drFinishIfEliminated(now time.Time) bool {
	alive := make([]*Player, 0, 2)
	for _, p := range h.players {
		rp := h.drRunners[p.ID]
		if rp != nil && rp.Lives > 0 {
			alive = append(alive, p)
		}
	}
	if len(alive) >= 2 {
		return false
	}
	h.drEnter(DRPlayerEliminated, now)
	var winner *Player
	if len(alive) == 1 {
		winner = alive[0]
	} else {
		// both out — higher distance, then damage dealt
		winner = h.drTiebreakWinner()
	}
	h.drEndMatch(winner, now)
	return true
}

func (h *Hub) drTiebreakWinner() *Player {
	var best *Player
	var bestDist, bestDmg float64
	for _, p := range h.players {
		rp := h.drRunners[p.ID]
		if rp == nil {
			continue
		}
		if best == nil || rp.Distance > bestDist || (rp.Distance == bestDist && float64(rp.DamageDealt) > bestDmg) {
			best = p
			bestDist = rp.Distance
			bestDmg = float64(rp.DamageDealt)
		}
	}
	return best
}

func (h *Hub) drEndMatch(winner *Player, now time.Time) {
	h.drEnter(DRMatchFinished, now)
	winnerID := ""
	if winner != nil {
		winnerID = winner.ID
	}
	stats := make([]map[string]any, 0, len(h.players))
	for _, p := range h.players {
		rp := h.drRunners[p.ID]
		if rp == nil {
			continue
		}
		stats = append(stats, map[string]any{
			"id":               p.ID,
			"name":             p.Name,
			"lives":            rp.Lives,
			"distance":         rp.Distance,
			"battlesWon":       rp.BattlesWon,
			"obstaclesAvoided": rp.ObstaclesAvoided,
			"damageDealt":      rp.DamageDealt,
		})
		if winner != nil && p.ID == winner.ID {
			h.award(p, 20)
		}
	}
	h.broadcast(map[string]any{
		"t": "dr_match_over", "winnerId": winnerID, "stats": stats, "serverTime": now.UnixMilli(),
	})
}
