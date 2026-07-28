package main

import (
	"log"
	"time"
)

// A world needs two players to run a match. Below that it stays in practice
// mode — free respawns, no rewards — so a lone player still has something to
// do and cannot mint Cubes against nobody.
const (
	MinRoundPlayers  = 2
	IntermissionTime = 7 * time.Second

	// Wins faster than this pay nothing. Otherwise two friends could take turns
	// jumping off the edge and print Cubes a few seconds at a time.
	MinRewardedRound = 30 * time.Second

	CubesForWin  = 10
	CubesPerKill = 2
)

const (
	roundWaiting = iota // not enough players: practice with respawns
	roundLive           // elimination, last cube standing wins
	roundOver           // showing the result before the next round
)

var roundStateNames = [...]string{"waiting", "live", "over"}

// Spectators are the players waiting for the next round: out of lives, or joined
// after the fight started. They are also flagged Dead, so every board check
// (occupied cells, input, collisions) ignores them without extra conditions.
//
// A player who is merely dead is still in the round — they have lives left and
// respawn shortly, so they count as alive here.
func (h *Hub) aliveCount() int {
	n := 0
	for _, p := range h.players {
		if !p.Spectating {
			n++
		}
	}
	return n
}

func (h *Hub) lastAlive() *Player {
	for _, p := range h.players {
		if !p.Spectating {
			return p
		}
	}
	return nil
}

func (h *Hub) roundInfo() map[string]any {
	info := map[string]any{
		"state":      roundStateNames[h.roundState],
		"alive":      h.aliveCount(),
		"players":    len(h.players),
		"minPlayers": MinRoundPlayers,
	}
	if h.roundState == roundOver {
		info["nextInMs"] = time.Until(h.roundEndsAt).Milliseconds()
	}
	return info
}

func (h *Hub) startRound() {
	h.roundState = roundLive
	h.roundStartedAt = time.Now()
	h.resetRound() // rebuilds the arena and revives everyone, spectators included
	log.Printf("%s: round started with %d players", h.gameMap.ID, len(h.players))
}

func (h *Hub) enterWaiting() {
	h.roundState = roundWaiting
	h.resetRound()
}

// endRound freezes the crumbling, announces the result and pays the winner.
// A walkover (everyone else disconnected) still counts as a win, as long as the
// round lasted long enough to have been a real fight.
func (h *Hub) endRound(winner *Player, now time.Time) {
	h.roundState = roundOver
	h.roundEndsAt = now.Add(IntermissionTime)

	msg := map[string]any{"t": "roundOver", "nextInMs": IntermissionTime.Milliseconds()}
	if winner == nil {
		msg["draw"] = true
		log.Printf("%s: round ended with no survivors", h.gameMap.ID)
	} else {
		reward := 0
		if now.Sub(h.roundStartedAt) >= MinRewardedRound {
			reward = CubesForWin + CubesPerKill*winner.roundKills
			h.award(winner, reward)
		} else {
			msg["tooShort"] = true
		}
		msg["winnerId"] = winner.ID
		msg["winnerName"] = winner.Name
		msg["kills"] = winner.roundKills
		msg["reward"] = reward
		log.Printf("%s: %s won with %d kills, reward %d",
			h.gameMap.ID, winner.ID, winner.roundKills, reward)
	}
	h.broadcast(msg)
}

func (h *Hub) roundTick(now time.Time) {
	switch h.roundState {
	case roundWaiting:
		if len(h.players) >= MinRoundPlayers {
			h.startRound()
		}
	case roundLive:
		if h.aliveCount() <= 1 {
			h.endRound(h.lastAlive(), now)
		}
	case roundOver:
		if now.After(h.roundEndsAt) {
			if len(h.players) >= MinRoundPlayers {
				h.startRound()
			} else {
				h.enterWaiting()
			}
		}
	}
}

type awardResult struct {
	userID  int64
	balance int
	err     error
}

// The Cubes write happens off the hub goroutine: a slow query must never freeze
// a world. The new balance comes back through a channel, so only the hub
// goroutine ever touches players and their connections.
func (h *Hub) award(p *Player, amount int) {
	userID, mapID := p.userID, h.gameMap.ID
	go func() {
		balance, err := h.store.AwardCubes(userID, mapID, amount)
		h.awards <- awardResult{userID: userID, balance: balance, err: err}
	}()
}

func (h *Hub) onAward(a awardResult) {
	if a.err != nil {
		log.Printf("%s: award to %d failed: %v", h.gameMap.ID, a.userID, a.err)
		return
	}
	for _, p := range h.players {
		if p.userID == a.userID {
			h.sendTo(p, map[string]any{"t": "cubes", "total": a.balance})
			return
		}
	}
}
