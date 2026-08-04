package main

import "time"

func (h *Hub) drSeenEvent(id string) bool {
	if id == "" {
		return false
	}
	if h.drEventSeen == nil {
		h.drEventSeen = make(map[string]bool)
	}
	return h.drEventSeen[id]
}

func (h *Hub) drMarkEvent(id string) {
	if id == "" {
		return
	}
	if h.drEventSeen == nil {
		h.drEventSeen = make(map[string]bool)
	}
	h.drEventSeen[id] = true
	// Bound memory
	if len(h.drEventSeen) > 4000 {
		h.drEventSeen = make(map[string]bool)
	}
}

func (h *Hub) drOnPlayerDisconnect(p *Player, now time.Time) {
	if !h.isDuelRun() || h.drState == DRMatchFinished {
		return
	}
	h.drPaused = true
	h.drDisconnectID = p.ID
	h.drReconnectDeadline = now.Add(DRReconnectTimeout)
	prev := h.drState
	if prev != DRReconnecting {
		h.drStateBeforePause = prev
	}
	h.drState = DRReconnecting
	h.broadcast(map[string]any{
		"t": "dr_reconnect_pause", "playerId": p.ID,
		"timeoutMs": DRReconnectTimeout.Milliseconds(),
		"serverTime": now.UnixMilli(),
	})
}

func (h *Hub) drReconnectTick(now time.Time) {
	if !h.drPaused {
		return
	}
	// If disconnected player reappeared
	if h.drDisconnectID != "" {
		if p := h.players[h.drDisconnectID]; p != nil && p.client != nil {
			h.drResumeFromReconnect(now)
			return
		}
	}
	if now.After(h.drReconnectDeadline) {
		// Disconnected player loses
		loserID := h.drDisconnectID
		loser := h.players[loserID]
		if loser != nil {
			rp := h.drEnsureRunner(loser)
			rp.Lives = 0
			loser.Lives = 0
			loser.Dead = true
			loser.Spectating = true
		} else if rp := h.drRunners[loserID]; rp != nil {
			rp.Lives = 0
		}
		h.drPaused = false
		var winner *Player
		for _, p := range h.players {
			if p.ID != loserID {
				winner = p
				break
			}
		}
		if winner == nil {
			// Prefer runner still marked alive
			for id, rp := range h.drRunners {
				if id != loserID && rp != nil && rp.Lives > 0 {
					winner = h.players[id]
					break
				}
			}
		}
		h.drEndMatch(winner, now)
	}
}

func (h *Hub) drResumeFromReconnect(now time.Time) {
	h.drPaused = false
	h.drDisconnectID = ""
	resume := h.drStateBeforePause
	if resume == "" || resume == DRReconnecting {
		resume = DRReturnToRun
	}
	// Safe point resume
	h.drGrantReturnInvuln(now)
	for _, rp := range h.drRunners {
		if rp == nil {
			continue
		}
		seg := h.drFindNextSafe(rp.Distance)
		if seg != nil {
			rp.Distance = seg.StartZ + 3
			rp.Lane = 1
			rp.LaneF = 1
		}
	}
	h.drEnter(resume, now)
	// Send full snapshot to everyone
	for _, p := range h.players {
		h.drSendSnapshot(p, now)
	}
}

func (h *Hub) drSendSnapshot(p *Player, now time.Time) {
	runners := make([]map[string]any, 0, len(h.drRunners))
	for _, pl := range h.players {
		rp := h.drRunners[pl.ID]
		if rp == nil {
			continue
		}
		runners = append(runners, map[string]any{
			"id": pl.ID, "name": pl.Name, "lives": rp.Lives,
			"distance": rp.Distance, "lane": rp.Lane, "laneF": rp.LaneF,
			"x": rp.RunX, "z": rp.RunZ,
			"speed": rp.Speed, "battleHp": rp.BattleHP, "bx": rp.BattleX, "bz": rp.BattleZ,
			"pickups": rp.Pickups, "shield": rp.ShieldCharges,
			"battlesWon": rp.BattlesWon, "obstaclesAvoided": rp.ObstaclesAvoided,
			"damageDealt": rp.DamageDealt,
		})
	}
	h.sendTo(p, map[string]any{
		"t": "dr_snapshot", "serverTime": now.UnixMilli(),
		"matchState": h.drState, "endsAt": h.drStateEnds.UnixMilli(),
		"seed": h.drSeed, "battleIdx": h.drBattleIndex,
		"nextBattle": h.drNextBattleAt, "segments": h.drTrackSnapshot(),
		"players": runners, "config": DRConfigPayload(),
		"paused": h.drPaused,
	})
}
