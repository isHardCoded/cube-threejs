package main

import (
	"log"
	"time"
)

// Duel Run hub fields live on Hub (see game.go). This file wires matchmaking
// helpers and command/tick entry points.

func (h *Hub) initDuelRun() {
	h.drState = DRWaitingForPlayers
	h.drRunners = make(map[string]*DRRunnerState)
	h.drEventSeen = make(map[string]bool)
	h.drSegments = nil
	h.drSeed = 0
	h.drWaveZ = -1
	h.drWaveAt = time.Time{}
}

func (h *Hub) drTick(now time.Time) {
	if !h.isDuelRun() {
		return
	}
	h.drFSMTick(now)
}

func (h *Hub) drOnJoin(c *Client, p *Player, now time.Time) {
	h.drEnsureRunner(p)
	p.Lives = DRDefaultLives
	p.HP = DRBattleHealth
	p.Spectating = false
	p.Dead = false
	// Reconnect mid-match
	if h.drPaused && h.drDisconnectID == p.ID {
		h.drResumeFromReconnect(now)
	}
	h.drSendSnapshot(p, now)
	need := drPlayersNeeded()
	if h.drState == DRWaitingForPlayers && h.drReadyPlayers() >= need {
		h.drInitMatch(now)
		h.drEnter(DRLoading, now)
		// Everyone needs corridor spawn cells (welcome still had 0,0).
		for _, pl := range h.players {
			if pl != nil {
				h.drSendSnapshot(pl, now)
			}
		}
	} else {
		h.drBroadcastState(now)
	}
}

func (h *Hub) drWelcomeExtras(welcome map[string]any) {
	welcome["maxLives"] = DRDefaultLives
	welcome["maxHp"] = DRBattleHealth
	welcome["dr"] = true
	welcome["config"] = DRConfigPayload()
	welcome["matchState"] = h.drState
	welcome["seed"] = h.drSeed
	welcome["segments"] = h.drTrackSnapshot()
	welcome["nextBattle"] = h.drNextBattleAt
	welcome["battleIdx"] = h.drBattleIndex
}

func (h *Hub) drHandleCommand(p *Player, msg clientMsg, now time.Time) bool {
	if !h.isDuelRun() {
		return false
	}
	switch msg.T {
	case "dr_input":
		action := msg.Action
		if h.drCanAcceptBattleInput() {
			h.drHandleBattleInput(p, action, msg.ActionID, msg.BX, msg.BZ, now)
		} else if action != "" {
			h.drHandleRunnerInput(p, action, msg.ActionID, now)
		}
		return true
	case "move":
		if h.drCanAcceptBattleInput() {
			// Cam yaw 180: invert so W/A match screen (same as runner).
			dx, dz := -msg.DX, -msg.DZ
			action := ""
			if dx < 0 {
				action = "left"
			} else if dx > 0 {
				action = "right"
			} else if dz < 0 {
				action = "back"
			} else if dz > 0 {
				action = "forward"
			}
			if action != "" {
				h.drHandleBattleInput(p, action, msg.ActionID, 0, 0, now)
			}
			return true
		}
		h.drHandleRunnerMove(p, msg.DX, msg.DZ, now)
		return true
	case "jump":
		if h.drCanAcceptBattleInput() {
			h.drHandleBattleInput(p, "forward", msg.ActionID, 0, 0, now)
		} else {
			h.drHandleRunnerJump(p, msg.DX, msg.DZ, now)
		}
		return true
	case "dash":
		if h.drCanAcceptBattleInput() {
			h.drHandleBattleInput(p, "dash", msg.ActionID, 0, 0, now)
		} else {
			h.drHandleRunnerDash(p, msg.DX, msg.DZ, now)
		}
		return true
	case "mine":
		// Mines work on the corridor like classic (arcade feel).
		return false
	case "bump":
		return true
	}
	return false
}

// CreateDuelRun matchmaking helpers on Arena.

func (a *Arena) QuickEnqueueDuelRun(userID int64) (*PendingMatch, error) {
	return a.EnqueueDuelRun(userID)
}

func (a *Arena) EnqueueDuelRun(userID int64) (*PendingMatch, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	now := time.Now()
	a.sweepLocked(now)

	if m := a.liveTicketLocked(userID, now); m != nil {
		if m.Mode == ModeDuelRun {
			return m, nil
		}
		// Drop conflicting PvP ticket
		delete(a.pending, userID)
	}

	// Dev solo: skip queue — open a private lobby and start with one player.
	if duelRunSoloDev() {
		a.dequeueDuelLocked(userID)
		return a.openDuelLobbyLocked(now, userID), nil
	}

	// Join open duel lobby
	for _, l := range a.lobbies {
		if l == nil || l.hub == nil || l.hub.mode != ModeDuelRun {
			continue
		}
		if !l.hasRoom() || l.members[userID] {
			continue
		}
		a.dequeueDuelLocked(userID)
		return a.admitDuelLocked(l, userID, now), nil
	}

	// Pair with another duel searcher
	for i, other := range a.duelQueue {
		if other.UserID == userID {
			continue
		}
		a.duelQueue = append(a.duelQueue[:i], a.duelQueue[i+1:]...)
		a.dequeueDuelLocked(userID)
		return a.openDuelLobbyLocked(now, other.UserID, userID), nil
	}

	// Enqueue
	me := a.duelEntryLocked(userID)
	if me == nil {
		me = &queueEntry{UserID: userID, Since: now, Size: 2, Maps: []string{DuelRunMapID}}
		a.duelQueue = append(a.duelQueue, me)
	}
	me.Seen = now
	me.Size = 2
	me.Maps = []string{DuelRunMapID}
	return nil, nil
}

func (a *Arena) CreateDuelRunLobby(userID int64) (*PendingMatch, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	now := time.Now()
	a.sweepLocked(now)
	if m := a.liveTicketLocked(userID, now); m != nil {
		if m.Mode == ModeDuelRun {
			return m, nil
		}
		delete(a.pending, userID)
	}
	a.dequeueDuelLocked(userID)
	m := a.openDuelLobbyLocked(now, userID)
	if l := a.lobbies[m.ID]; l != nil && l.hub != nil {
		l.hub.hosted = true
	}
	return m, nil
}

func (a *Arena) openDuelLobbyLocked(now time.Time, first ...int64) *PendingMatch {
	gm := MapByID(DuelRunMapID)
	id := "dr-" + newMatchID()
	h := NewHub(a.store, gm, a.presence)
	h.id = id
	h.mode = ModeDuelRun
	h.maxPlayers = 2
	h.allowed = map[int64]bool{}
	h.initDuelRun()
	h.onEmpty = func(hub *Hub) { a.removeRoom(hub.id) }
	h.onJoined = func(uid int64) { a.ClaimMatch(uid, id) }
	h.onLeft = func(uid int64) { a.releaseSlot(id, uid) }

	var hostID int64
	if len(first) > 0 {
		hostID = first[0]
	}
	h.hostID = hostID

	l := &lobby{hub: h, mapID: gm.ID, capacity: 2, hostID: hostID, members: map[int64]bool{}}
	a.rooms[id] = h
	a.lobbies[id] = l
	a.startHub(h)
	log.Printf("arena: duel_run lobby %s (host %d)", id, hostID)

	var m *PendingMatch
	for _, uid := range first {
		m = a.admitDuelLocked(l, uid, now)
	}
	return m
}

func (a *Arena) admitDuelLocked(l *lobby, userID int64, now time.Time) *PendingMatch {
	l.members[userID] = true
	l.hub.allow(userID)
	m := &PendingMatch{
		ID: l.hub.id, MapID: DuelRunMapID, Mode: ModeDuelRun,
		Size: 2, Expires: now.Add(reserveTTL),
	}
	a.pending[userID] = m
	log.Printf("arena: %d seated in duel_run %s (%d/2)", userID, l.hub.id, len(l.members))
	return m
}

func (a *Arena) duelEntryLocked(userID int64) *queueEntry {
	for _, e := range a.duelQueue {
		if e.UserID == userID {
			return e
		}
	}
	return nil
}

func (a *Arena) dequeueDuelLocked(userID int64) {
	out := a.duelQueue[:0]
	for _, e := range a.duelQueue {
		if e.UserID != userID {
			out = append(out, e)
		}
	}
	a.duelQueue = out
}

func (a *Arena) ListDuelRunLobbies() []LobbyPublic {
	a.mu.Lock()
	defer a.mu.Unlock()
	now := time.Now()
	a.sweepLocked(now)
	out := make([]LobbyPublic, 0)
	for _, l := range a.lobbies {
		if l == nil || l.hub == nil || l.hub.mode != ModeDuelRun {
			continue
		}
		out = append(out, a.lobbyPublicLocked(l))
	}
	return out
}

func (a *Arena) DequeueDuelRun(userID int64) {
	a.Dequeue(userID)
}
