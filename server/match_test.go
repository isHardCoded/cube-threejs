package main

import (
	"testing"
	"time"
)

// testMatchHub builds a PvP room the way the arena does, minus the goroutine, so
// tests can drive the clock themselves. closed reports the reason the room gave
// the arena when it shut itself down.
func testMatchHub(t *testing.T) (h *Hub, closed *string) {
	t.Helper()
	h = NewHub(&Store{}, GameMaps[DefaultMapID], NewPresence())
	h.id = "pvp-test"
	h.mode = ModePvP
	h.maxPlayers = 2
	h.allowed = nil // tests seat their own players

	var reason string
	closed = &reason
	h.onEmpty = func(*Hub) { reason = "closed" }
	return h, closed
}

// kickReason reads the reason the room sent a client before dropping it.
func kickReason(c *Client) string {
	msg := findMsg(drain(c), "kicked")
	if msg == nil {
		return ""
	}
	r, _ := msg["reason"].(string)
	return r
}

func TestMatchRoomNobodyEntersReapsItself(t *testing.T) {
	h, closed := testMatchHub(t)
	now := time.Now()

	h.watchMatch(now) // starts the clock on an empty room
	h.watchMatch(now.Add(MatchWaitWindow - time.Second))
	if *closed != "" {
		t.Fatal("the room gave up before the wait window was over")
	}

	h.watchMatch(now.Add(MatchWaitWindow + time.Second))
	if *closed == "" {
		t.Error("a room nobody ever entered must not stay open")
	}
}

func TestOpponentWhoNeverConnectsEndsTheMatch(t *testing.T) {
	h, closed := testMatchHub(t)
	a := testClient(h, 1, "Alice")
	h.onJoin(a)
	drain(a)

	now := time.Now()
	h.watchMatch(now)
	h.roundTick(now)
	if h.roundState != roundWaiting {
		t.Fatalf("one player cannot start a match, state=%d", h.roundState)
	}

	h.watchMatch(now.Add(MatchWaitWindow + time.Second))
	if *closed == "" {
		t.Fatal("the room kept a lone player waiting for an opponent who is not coming")
	}
	if r := kickReason(a); r != "opponent_missing" {
		t.Errorf("kick reason %q, want opponent_missing", r)
	}
	if len(h.players) != 0 {
		t.Errorf("%d players left behind in a closed room", len(h.players))
	}
}

// The walkover already pays the winner; what used to be missing is the way out of
// the room afterwards.
func TestWinnerIsNotStrandedAfterAWalkover(t *testing.T) {
	h, closed := testMatchHub(t)
	a, b := testClient(h, 1, "Alice"), testClient(h, 2, "Bob")
	h.onJoin(a)
	h.onJoin(b)
	now := time.Now()
	h.roundTick(now)
	if h.roundState != roundLive {
		t.Fatalf("two players should be fighting, state=%d", h.roundState)
	}

	h.onLeave(b) // the loser closes the tab
	h.roundTick(now)
	if h.roundState != roundOver {
		t.Fatalf("a lone survivor ends the round, state=%d", h.roundState)
	}

	// the result stays on screen for the whole intermission
	h.watchMatch(now)
	if *closed != "" {
		t.Fatal("the room closed before showing the result")
	}

	h.roundEndsAt = now.Add(-time.Millisecond)
	h.roundTick(now)
	if *closed == "" {
		t.Fatal("the winner was left alone in a room nobody else can join")
	}
	if r := kickReason(a); r != "opponent_left" {
		t.Errorf("kick reason %q, want opponent_left", r)
	}
}

func TestTrainingRoomKeepsPractisingAlone(t *testing.T) {
	h := testHub() // no mode: a practice world
	h.onEmpty = func(*Hub) { t.Error("practice should not close on its own") }
	c := testClient(h, 1, "Solo")
	h.onJoin(c)

	now := time.Now()
	h.watchMatch(now)
	h.watchMatch(now.Add(2 * MatchWaitWindow))
	if h.closing {
		t.Error("a solo practice world is a feature, not an empty match")
	}
}

func TestFullMatchRoomIsNeverReaped(t *testing.T) {
	h, closed := testMatchHub(t)
	a, b := testClient(h, 1, "Alice"), testClient(h, 2, "Bob")
	h.onJoin(a)
	h.onJoin(b)

	now := time.Now()
	h.watchMatch(now)
	h.watchMatch(now.Add(2 * MatchWaitWindow))
	if *closed != "" {
		t.Error("a match with both players must keep running")
	}
}

// A big lobby must not turn into a duel just because two players got there first.
func TestBigLobbyWaitsBeforeTheFirstRound(t *testing.T) {
	h, _ := testMatchHub(t)
	h.maxPlayers = 8
	h.onJoin(testClient(h, 1, "One"))
	h.onJoin(testClient(h, 2, "Two"))

	now := time.Now()
	h.roundTick(now)
	if h.roundState != roundWaiting {
		t.Fatal("an 8-player lobby should wait for more players")
	}

	h.roundTick(now.Add(LobbyFillWait - time.Second))
	if h.roundState != roundWaiting {
		t.Fatal("the lobby gave up waiting too early")
	}

	h.roundTick(now.Add(LobbyFillWait + time.Second))
	if h.roundState != roundLive {
		t.Fatalf("two players are enough once the wait is over, state=%d", h.roundState)
	}
}

func TestFullLobbyStartsAtOnce(t *testing.T) {
	h, _ := testMatchHub(t)
	h.maxPlayers = 4
	for i := int64(1); i <= 4; i++ {
		h.allow(i)
		h.onJoin(testClient(h, i, "P"))
	}

	h.roundTick(time.Now())
	if h.roundState != roundLive {
		t.Fatalf("a full lobby should not wait, state=%d", h.roundState)
	}
}

func TestDuelStillStartsImmediately(t *testing.T) {
	h, _ := testMatchHub(t) // maxPlayers = 2
	h.onJoin(testClient(h, 1, "One"))
	h.onJoin(testClient(h, 2, "Two"))

	h.roundTick(time.Now())
	if h.roundState != roundLive {
		t.Fatalf("a duel is full at two players, state=%d", h.roundState)
	}
}

// An evicted socket never reaches onLeave, so the room has to notice by itself
// that it is empty: otherwise its ticker outlives the game.
func TestEvictedLastPlayerHandsBackTheRoom(t *testing.T) {
	h, closed := testMatchHub(t)
	c := testClient(h, 1, "Alice")
	h.onJoin(c)

	h.onEvict(1) // the account showed up on another map

	if len(h.players) != 0 {
		t.Fatalf("%d players left after eviction", len(h.players))
	}
	if *closed == "" {
		t.Error("the emptied room was never handed back to the arena")
	}
}

func TestClosedRoomReleasesItsPlayers(t *testing.T) {
	h, _ := testMatchHub(t)
	presence := h.presence
	a := testClient(h, 1, "Alice")
	h.onJoin(a)
	presence.Enter(1, h)

	h.closeMatch("opponent_left")

	if presence.at[1] != nil {
		t.Error("a closed room still holds the account, so the next join is misrouted")
	}
	if !a.closing {
		t.Error("the connection was left open on a dead room")
	}
	// a second dismissal must not double-drop anyone
	h.closeMatch("opponent_left")
}
