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

	// How long a match room tolerates being short of players before it gives up.
	// Long enough for a slow phone to finish loading the arena, short enough that
	// a no-show does not cost the other player a real wait.
	MatchWaitWindow = 30 * time.Second

	// A room with seats left holds the first round back this long, so a ten-player
	// lobby does not kick off as a duel the moment the second player walks in.
	LobbyFillWait = 15 * time.Second

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

// readyToStart: two players are enough to fight, but a lobby with seats left
// waits a little for the rest, so latecomers get a round instead of a spectator
// seat. A full room — or a practice world with no size at all — starts at once.
func (h *Hub) readyToStart(now time.Time) bool {
	if len(h.players) < MinRoundPlayers {
		h.readySince = time.Time{}
		return false
	}
	if h.maxPlayers <= 0 || len(h.players) >= h.maxPlayers {
		return true
	}
	if h.readySince.IsZero() {
		h.readySince = now
	}
	return now.Sub(h.readySince) >= LobbyFillWait
}

func (h *Hub) roundInfo() map[string]any {
	info := map[string]any{
		"state":      roundStateNames[h.roundState],
		"alive":      h.aliveCount(),
		"players":    len(h.players),
		"minPlayers": MinRoundPlayers,
		"room":       h.maxPlayers, // lobby size, so the HUD can show 3/8
	}
	if h.roundState == roundOver {
		info["nextInMs"] = time.Until(h.roundEndsAt).Milliseconds()
	}
	return info
}

func (h *Hub) startRound() {
	h.roundState = roundLive
	h.roundStartedAt = time.Now()
	h.readySince = time.Time{}
	h.resetRound() // rebuilds the arena and revives everyone, spectators included
	for _, p := range h.players {
		p.foughtRound = true
	}
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

	h.creditQuestProgress(winner)

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

// creditQuestProgress records play / kills / win toward daily and weekly quests.
// Writes run off the hub goroutine so a slow database never freezes the arena.
func (h *Hub) creditQuestProgress(winner *Player) {
	type bump struct {
		userID int64
		metric string
		delta  int
	}
	var jobs []bump
	for _, p := range h.players {
		if !p.foughtRound || p.userID == 0 {
			continue
		}
		jobs = append(jobs, bump{p.userID, questMetricPlay, 1})
		if p.roundKills > 0 {
			jobs = append(jobs, bump{p.userID, questMetricKills, p.roundKills})
		}
	}
	if winner != nil && winner.foughtRound && winner.userID != 0 {
		jobs = append(jobs, bump{winner.userID, questMetricWin, 1})
	}
	if len(jobs) == 0 {
		return
	}
	store := h.store
	go func() {
		for _, j := range jobs {
			if err := store.AddQuestProgress(j.userID, j.metric, j.delta); err != nil {
				log.Printf("quest progress %s +%d for %d: %v", j.metric, j.delta, j.userID, err)
			}
		}
	}()
}

func (h *Hub) roundTick(now time.Time) {
	switch h.roundState {
	case roundWaiting:
		if h.readyToStart(now) {
			h.startRound()
		}
	case roundLive:
		if h.aliveCount() <= 1 {
			h.endRound(h.lastAlive(), now)
		}
	case roundOver:
		if now.After(h.roundEndsAt) {
			switch {
			case len(h.players) >= MinRoundPlayers:
				h.startRound()
			case h.mode == ModePvP:
				// nobody to fight and nobody who can join: send them searching
				h.closeMatch(h.thinReason())
			default:
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
