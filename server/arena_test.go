package main

import (
	"testing"
	"time"
)

// testArena has a usable (empty) store, so hubs can accept joins.
func testArena() *Arena {
	return NewArena(&Store{}, NewPresence())
}

// duel queues for the default two-player room.
func duel(a *Arena, userID int64, maps ...string) (*PendingMatch, error) {
	return a.Enqueue(userID, maps, 2)
}

func TestMatchQueuePairsOnSharedMap(t *testing.T) {
	a := NewArena(nil, NewPresence())

	m1, err := duel(a, 1, "lava", "cyberpunk")
	if err != nil || m1 != nil {
		t.Fatalf("first enqueue: match=%v err=%v", m1, err)
	}
	s := a.Status(1)
	if s.State != "searching" || len(s.Maps) != 2 {
		t.Fatalf("want searching with 2 maps, got %s %v", s.State, s.Maps)
	}

	m2, err := duel(a, 2, "desert", "lava")
	if err != nil {
		t.Fatal(err)
	}
	if m2 == nil || m2.MapID != "lava" {
		t.Fatalf("expected lava match, got %+v", m2)
	}

	s1, s2 := a.Status(1), a.Status(2)
	if s1.State != "matched" || s2.State != "matched" {
		t.Fatalf("states %s / %s", s1.State, s2.State)
	}
	if s1.Match.ID != s2.Match.ID {
		t.Fatal("players got different matches")
	}
	if a.MatchHub(s1.Match.ID) == nil {
		t.Fatal("hub missing")
	}
}

func TestMatchQueueNoIntersectionStaysSearching(t *testing.T) {
	a := NewArena(nil, NewPresence())
	_, _ = duel(a, 1, "cyberpunk")
	m, err := duel(a, 2, "lava")
	if err != nil || m != nil {
		t.Fatalf("should not match: %v %v", m, err)
	}
	if s := a.Status(1); s.State != "searching" {
		t.Fatal(s.State)
	}
	if s := a.Status(2); s.State != "searching" {
		t.Fatal(s.State)
	}
}

// The whole point of the heartbeat: a tab that stopped polling must not be handed
// out as an opponent, or the player who paired with it waits in an empty arena.
func TestStaleSearcherIsNotAnOpponent(t *testing.T) {
	a := testArena()
	if _, err := duel(a, 1, "lava"); err != nil {
		t.Fatal(err)
	}
	a.queue[0].Seen = time.Now().Add(-queueTTL - time.Second) // gave up polling

	m, err := duel(a, 2, "lava")
	if err != nil {
		t.Fatal(err)
	}
	if m != nil {
		t.Fatalf("paired with a ghost: %+v", m)
	}
	if s := a.Status(1); s.State != "idle" {
		t.Errorf("stale slot survived, state=%s", s.State)
	}
	if s := a.Status(2); s.State != "searching" {
		t.Errorf("second player should be searching, state=%s", s.State)
	}
}

func TestStatusPollKeepsTheSlotAlive(t *testing.T) {
	a := testArena()
	if _, err := duel(a, 1, "lava"); err != nil {
		t.Fatal(err)
	}
	a.queue[0].Seen = time.Now().Add(-queueTTL + time.Second)
	if s := a.Status(1); s.State != "searching" {
		t.Fatalf("state=%s", s.State)
	}

	// the poll refreshed the slot, so it is still there a moment later
	if s := a.Status(1); s.State != "searching" {
		t.Fatalf("poll did not refresh the slot, state=%s", s.State)
	}
	if m, err := duel(a, 2, "lava"); err != nil || m == nil {
		t.Fatalf("a live searcher should be pairable: %v %v", m, err)
	}
}

// Giving up a seat nobody else has taken has to close the room, otherwise it sits
// there empty holding a map slot.
func TestCancelGivesTheSeatBack(t *testing.T) {
	a := testArena()
	_, _ = duel(a, 1, "lava")
	m, err := duel(a, 2, "lava")
	if err != nil || m == nil {
		t.Fatalf("expected a match: %v %v", m, err)
	}

	a.Dequeue(2) // second player hit cancel before connecting
	if s := a.Status(2); s.State != "idle" {
		t.Errorf("canceller state=%s, want idle", s.State)
	}
	if a.MatchHub(m.ID) == nil {
		t.Fatal("the room was closed while a seat was still reserved")
	}

	a.Dequeue(1) // now nobody is left holding a seat
	if a.MatchHub(m.ID) != nil {
		t.Error("an empty room should be closed")
	}
	if s := a.Status(1); s.State != "idle" {
		t.Errorf("state=%s, want idle", s.State)
	}
}

// A ticket must never outlive its room: handing one out sends the player to a
// match the socket answers with 404.
func TestTicketDiesWithItsRoom(t *testing.T) {
	a := testArena()
	_, _ = duel(a, 1, "lava")
	m, _ := duel(a, 2, "lava")
	if m == nil {
		t.Fatal("expected a match")
	}

	a.removeRoom(m.ID) // the room reaped itself: nobody ever joined

	for _, uid := range []int64{1, 2} {
		s := a.Status(uid)
		if s.State != "idle" || s.Match != nil {
			t.Errorf("player %d was offered a dead room: %s %+v", uid, s.State, s.Match)
		}
	}
	// and the search recovers instead of dead-ending
	if _, err := duel(a, 1, "lava"); err != nil {
		t.Fatalf("re-search after a dead room: %v", err)
	}
	if s := a.Status(1); s.State != "searching" {
		t.Errorf("state=%s, want searching", s.State)
	}
}

// An unclaimed seat has to time out, or one no-show blocks the lobby for everyone.
func TestUnclaimedSeatFreesUp(t *testing.T) {
	a := testArena()
	_, _ = a.Enqueue(1, []string{"lava"}, 4)
	m, _ := a.Enqueue(2, []string{"lava"}, 4)
	if m == nil {
		t.Fatal("expected a lobby")
	}
	l := a.lobbies[m.ID]
	if len(l.members) != 2 {
		t.Fatalf("lobby holds %d seats, want 2", len(l.members))
	}

	a.pending[2].Expires = time.Now().Add(-time.Second)
	if s := a.Status(2); s.State != "idle" {
		t.Fatalf("an expired ticket should not be offered, state=%s", s.State)
	}
	if len(l.members) != 1 {
		t.Errorf("the expired seat is still reserved: %d members", len(l.members))
	}
}

func TestQueueRefusesUnknownMaps(t *testing.T) {
	a := testArena()
	if _, err := duel(a, 1, "atlantis", ""); err == nil {
		t.Fatal("unknown maps should be refused, not silently replaced")
	}
	if s := a.Status(1); s.State != "idle" {
		t.Errorf("a refused request must not queue anyone, state=%s", s.State)
	}

	// a valid id among the junk still counts, and only the valid one
	if _, err := duel(a, 1, "atlantis", "lava", "lava"); err != nil {
		t.Fatal(err)
	}
	s := a.Status(1)
	if len(s.Maps) != 1 || s.Maps[0] != "lava" {
		t.Errorf("queued maps: %v", s.Maps)
	}
}

func TestQueueRefusesOddRoomSizes(t *testing.T) {
	a := testArena()
	// size 0 is quick-search ("any"); other odd values stay refused
	for _, size := range []int{1, 3, 7, 11, 100, -2} {
		if _, err := a.Enqueue(1, []string{"lava"}, size); err == nil {
			t.Errorf("room size %d should be refused", size)
		}
	}
	for _, size := range RoomSizes {
		if _, err := a.Enqueue(int64(size), []string{"lava"}, size); err != nil {
			t.Errorf("room size %d should be allowed: %v", size, err)
		}
	}
	if _, err := a.Enqueue(99, []string{"lava"}, 0); err != nil {
		t.Errorf("size 0 (quick search) should be allowed: %v", err)
	}
}

func TestCreateLobbyAlone(t *testing.T) {
	a := testArena()
	m, err := a.CreateLobby(1, "lava", 8)
	if err != nil {
		t.Fatal(err)
	}
	if m == nil || m.MapID != "lava" || m.Size != 8 {
		t.Fatalf("bad ticket: %+v", m)
	}
	list := a.ListLobbies()
	if len(list) != 1 || list[0].Players != 1 || list[0].HostID != 1 {
		t.Fatalf("list: %+v", list)
	}
	m2, err := a.JoinLobby(2, m.ID)
	if err != nil || m2 == nil || m2.ID != m.ID {
		t.Fatalf("join: %+v %v", m2, err)
	}
}

func TestQuickSearchJoinsAnyLobby(t *testing.T) {
	a := testArena()
	m, err := a.CreateLobby(1, "desert", 4)
	if err != nil || m == nil {
		t.Fatalf("create: %v %v", m, err)
	}
	got, err := a.QuickEnqueue(2)
	if err != nil || got == nil || got.ID != m.ID {
		t.Fatalf("quick should join open lobby: %+v %v", got, err)
	}
	if got.MapID != "desert" || got.Size != 4 {
		t.Fatalf("should inherit lobby map/size: %+v", got)
	}
}

func TestQuickSearchPairsTwoSearchers(t *testing.T) {
	a := testArena()
	m1, err := a.QuickEnqueue(1)
	if err != nil || m1 != nil {
		t.Fatalf("first quick should wait: %v %v", m1, err)
	}
	m2, err := a.QuickEnqueue(2)
	if err != nil || m2 == nil {
		t.Fatalf("second quick should open a room: %v %v", m2, err)
	}
	if m2.Size != DefaultQuickRoom {
		t.Errorf("want default room %d, got %d", DefaultQuickRoom, m2.Size)
	}
}

// Re-queueing is how the client repairs a slot the server forgot, so it must not
// cost the player their place in line.
func TestResearchKeepsQueuePosition(t *testing.T) {
	a := testArena()
	_, _ = duel(a, 1, "lava")
	_, _ = duel(a, 2, "desert")
	_, _ = duel(a, 1, "lava", "ocean") // same player, wider search

	if len(a.queue) != 2 {
		t.Fatalf("queue holds %d entries, want 2", len(a.queue))
	}
	if a.queue[0].UserID != 1 {
		t.Errorf("player 1 lost their place, head is %d", a.queue[0].UserID)
	}
}

// --- lobby sizes ------------------------------------------------------------

// Players who asked for different room sizes are not in the same pool, however
// well their maps overlap.
func TestSizesDoNotMixInTheQueue(t *testing.T) {
	a := testArena()
	if _, err := a.Enqueue(1, []string{"lava"}, 8); err != nil {
		t.Fatal(err)
	}
	m, err := a.Enqueue(2, []string{"lava"}, 4)
	if err != nil {
		t.Fatal(err)
	}
	if m != nil {
		t.Fatalf("a 4-player search must not join an 8-player one: %+v", m)
	}
	if s := a.Status(1); s.State != "searching" || s.Size != 8 {
		t.Errorf("player 1: %s size=%d", s.State, s.Size)
	}
}

// The third and later players must land in the lobby that is already filling,
// instead of each opening a room of their own and waiting alone.
func TestLaterPlayersFillTheSameLobby(t *testing.T) {
	a := testArena()
	_, _ = a.Enqueue(1, []string{"lava"}, 8)
	m2, _ := a.Enqueue(2, []string{"lava"}, 8)
	if m2 == nil {
		t.Fatal("the first pair should open a lobby")
	}

	for uid := int64(3); uid <= 8; uid++ {
		m, err := a.Enqueue(uid, []string{"lava"}, 8)
		if err != nil {
			t.Fatal(err)
		}
		if m == nil || m.ID != m2.ID {
			t.Fatalf("player %d did not join the open lobby: %+v", uid, m)
		}
		if m.Size != 8 {
			t.Errorf("player %d got size %d", uid, m.Size)
		}
	}
	if n := len(a.lobbies); n != 1 {
		t.Errorf("%d lobbies opened, want 1", n)
	}

	// full: the ninth player has to wait for a new one
	m9, err := a.Enqueue(9, []string{"lava"}, 8)
	if err != nil {
		t.Fatal(err)
	}
	if m9 != nil {
		t.Fatalf("a full lobby must not take a ninth player: %+v", m9)
	}
	if s := a.Status(9); s.State != "searching" {
		t.Errorf("state=%s, want searching", s.State)
	}
}

// A seat freed by someone leaving has to become available again.
func TestFreedSeatIsRefilled(t *testing.T) {
	a := testArena()
	_, _ = duel(a, 1, "lava")
	m, _ := duel(a, 2, "lava")
	if m == nil {
		t.Fatal("expected a duel room")
	}
	if _, err := duel(a, 3, "lava"); err != nil {
		t.Fatal(err)
	}
	if s := a.Status(3); s.State != "searching" {
		t.Fatalf("a full room must not take a third player, state=%s", s.State)
	}

	a.releaseSlot(m.ID, 2) // player 2 disconnected

	got, err := duel(a, 3, "lava")
	if err != nil {
		t.Fatal(err)
	}
	if got == nil || got.ID != m.ID {
		t.Fatalf("the freed seat was not offered: %+v", got)
	}
}

// A lobby only takes players who picked its map, whatever else they picked.
func TestLobbyOnlyTakesPlayersWhoPickedItsMap(t *testing.T) {
	a := testArena()
	_, _ = a.Enqueue(1, []string{"lava"}, 4)
	m, _ := a.Enqueue(2, []string{"lava"}, 4)
	if m == nil || m.MapID != "lava" {
		t.Fatalf("expected a lava lobby: %+v", m)
	}

	wrong, err := a.Enqueue(3, []string{"ocean", "desert"}, 4)
	if err != nil {
		t.Fatal(err)
	}
	if wrong != nil {
		t.Fatalf("player 3 does not want lava: %+v", wrong)
	}

	right, err := a.Enqueue(4, []string{"ocean", "lava"}, 4)
	if err != nil {
		t.Fatal(err)
	}
	if right == nil || right.ID != m.ID {
		t.Fatalf("player 4 picked lava and should be seated: %+v", right)
	}
}
