package main

import (
	"testing"
	"time"
)

func TestPeriodKeyUTC(t *testing.T) {
	// a known Wednesday in ISO week 31 of 2026
	now := time.Date(2026, 7, 29, 15, 0, 0, 0, time.UTC)
	if got := periodKeyUTC(questPeriodDaily, now); got != "2026-07-29" {
		t.Fatalf("daily key: got %q", got)
	}
	if got := periodKeyUTC(questPeriodWeekly, now); got != "2026-W31" {
		t.Fatalf("weekly key: got %q", got)
	}
}

func TestNextResetsUTC(t *testing.T) {
	now := time.Date(2026, 7, 29, 15, 30, 0, 0, time.UTC) // Wednesday
	daily := nextDailyResetUTC(now)
	if daily != time.Date(2026, 7, 30, 0, 0, 0, 0, time.UTC) {
		t.Fatalf("next daily: %v", daily)
	}
	weekly := nextWeeklyResetUTC(now)
	if weekly != time.Date(2026, 8, 3, 0, 0, 0, 0, time.UTC) {
		t.Fatalf("next weekly (Monday): %v", weekly)
	}
	// Monday morning should still point at next Monday, not "today"
	monday := time.Date(2026, 8, 3, 9, 0, 0, 0, time.UTC)
	if got := nextWeeklyResetUTC(monday); got != time.Date(2026, 8, 10, 0, 0, 0, 0, time.UTC) {
		t.Fatalf("monday next weekly: %v", got)
	}
}

func TestQuestByID(t *testing.T) {
	q, ok := questByID("daily_play")
	if !ok || q.Target != 3 || q.Reward != 5 {
		t.Fatalf("daily_play: %+v ok=%v", q, ok)
	}
	if _, ok := questByID("nope"); ok {
		t.Fatal("unknown quest should miss")
	}
}

func TestAddQuestProgressNilStore(t *testing.T) {
	s := &Store{}
	if err := s.AddQuestProgress(1, questMetricPlay, 1); err != nil {
		t.Fatal(err)
	}
}

func TestListQuestsEmptyStore(t *testing.T) {
	s := &Store{}
	daily, weekly, claimable, err := s.ListQuests(1)
	if err != nil {
		t.Fatal(err)
	}
	if len(daily) != 3 || len(weekly) != 3 || claimable != 0 {
		t.Fatalf("daily=%d weekly=%d claimable=%d", len(daily), len(weekly), claimable)
	}
	for _, q := range append(daily, weekly...) {
		if q.Progress != 0 || q.Claimed || q.Claimable {
			t.Fatalf("fresh quest should be empty: %+v", q)
		}
	}
}

func TestEndRoundCreditsFoughtPlayers(t *testing.T) {
	h := testHub()
	a := addTestPlayer(h, "a", 0, 0, 0)
	a.userID = 11
	a.foughtRound = true
	a.roundKills = 2
	b := addTestPlayer(h, "b", 0, 1, 0)
	b.userID = 22
	b.foughtRound = true
	c := addTestPlayer(h, "c", 0, 2, 0) // mid-round spectator
	c.userID = 33
	c.foughtRound = false
	c.Spectating = true

	h.roundState = roundLive
	h.roundStartedAt = time.Now().Add(-time.Minute)
	// nil store: AddQuestProgress is a no-op; this just proves endRound still runs
	h.endRound(a, time.Now())
	if h.roundState != roundOver {
		t.Fatalf("expected roundOver, got %d", h.roundState)
	}
}
