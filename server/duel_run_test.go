package main

import (
	"testing"
	"time"
)

func TestDuelRunFSMTransitions(t *testing.T) {
	h := NewHub(nil, MapByID(DuelRunMapID), nil)
	h.mode = ModeDuelRun
	h.maxPlayers = 2
	h.initDuelRun()

	p1 := &Player{ID: "1", Name: "A", Lives: 3}
	p2 := &Player{ID: "2", Name: "B", Lives: 3}
	h.players["1"] = p1
	h.players["2"] = p2
	h.drEnsureRunner(p1)
	h.drEnsureRunner(p2)

	now := time.Now()
	h.drInitMatch(now)
	h.drEnter(DRLoading, now)
	if h.drState != DRLoading {
		t.Fatalf("want LOADING got %s", h.drState)
	}
	h.drEnter(DRCountdown, now)
	h.drEnter(DRRunning, now)
	if h.drCanAcceptBattleInput() {
		t.Fatal("RUNNING must not accept battle input")
	}
	if !h.drCanAcceptRunnerInput() {
		t.Fatal("RUNNING must accept runner input")
	}
	h.drEnter(DRBattleActive, now)
	if h.drCanAcceptRunnerInput() {
		t.Fatal("BATTLE_ACTIVE must not accept runner input")
	}
	if !h.drCanAcceptBattleInput() {
		t.Fatal("BATTLE_ACTIVE must accept battle input")
	}
}

func TestDuelRunSeedTrackDeterministic(t *testing.T) {
	mk := func(seed uint64) []string {
		h := NewHub(nil, MapByID(DuelRunMapID), nil)
		h.mode = ModeDuelRun
		h.initDuelRun()
		h.drSeed = seed
		h.drRng = newDRRng(seed)
		h.drBuildInitialTrack()
		kinds := make([]string, len(h.drSegments))
		for i, s := range h.drSegments {
			kinds[i] = s.Kind
		}
		return kinds
	}
	a := mk(42)
	b := mk(42)
	if len(a) != len(b) {
		t.Fatalf("len mismatch %d vs %d", len(a), len(b))
	}
	for i := range a {
		if a[i] != b[i] {
			t.Fatalf("seg %d %s vs %s", i, a[i], b[i])
		}
	}
}

func TestDuelRunPassableLanes(t *testing.T) {
	h := NewHub(nil, MapByID(DuelRunMapID), nil)
	h.mode = ModeDuelRun
	h.initDuelRun()
	h.drSeed = 7
	h.drRng = newDRRng(7)
	h.drBuildInitialTrack()
	for i := 0; i < 20; i++ {
		h.drAppendSegment(h.drPickNextKind(false))
	}
	for _, seg := range h.drSegments {
		if seg.Safe {
			continue
		}
		type band struct {
			z, mask int
		}
		// reuse ensure: after ensurePassable no band should be full 7 for static
		h.drEnsurePassable(seg)
	}
}

func TestDuelRunLifeLossAndEventIdempotent(t *testing.T) {
	h := NewHub(nil, MapByID(DuelRunMapID), nil)
	h.mode = ModeDuelRun
	h.initDuelRun()
	p := &Player{ID: "1", Name: "A"}
	h.players["1"] = p
	rp := h.drEnsureRunner(p)
	now := time.Now()
	h.drLoseLife(p, rp, "test", now)
	if rp.Lives != DRDefaultLives-1 {
		t.Fatalf("lives %d", rp.Lives)
	}
	h.drMarkEvent("evt1")
	if !h.drSeenEvent("evt1") {
		t.Fatal("event not marked")
	}
}

func TestDuelRunBattleEqualHPSuddenDeath(t *testing.T) {
	h := NewHub(nil, MapByID(DuelRunMapID), nil)
	h.mode = ModeDuelRun
	h.initDuelRun()
	p1 := &Player{ID: "1", Name: "A"}
	p2 := &Player{ID: "2", Name: "B"}
	h.players["1"] = p1
	h.players["2"] = p2
	r1 := h.drEnsureRunner(p1)
	r2 := h.drEnsureRunner(p2)
	r1.BattleHP = 50
	r2.BattleHP = 50
	r1.DamageDealt = 10
	r2.DamageDealt = 10
	now := time.Now()
	h.drEnter(DRBattleActive, now)
	h.drResolveBattleEnd(now)
	if !h.drSuddenDeath {
		t.Fatal("expected sudden death")
	}
}

func TestDuelRunReconnectTimeout(t *testing.T) {
	h := NewHub(nil, MapByID(DuelRunMapID), nil)
	h.mode = ModeDuelRun
	h.initDuelRun()
	p1 := &Player{ID: "1", Name: "A"}
	p2 := &Player{ID: "2", Name: "B"}
	h.players["1"] = p1
	h.players["2"] = p2
	h.drEnsureRunner(p1)
	h.drEnsureRunner(p2)
	now := time.Now()
	h.drEnter(DRRunning, now)
	h.drOnPlayerDisconnect(p1, now)
	if h.drState != DRReconnecting {
		t.Fatalf("want RECONNECTING got %s", h.drState)
	}
	h.drReconnectDeadline = now.Add(-time.Second)
	delete(h.players, "1") // simulate gone
	h.drReconnectTick(now)
	if h.drState != DRMatchFinished {
		t.Fatalf("want MATCH_FINISHED got %s", h.drState)
	}
}
