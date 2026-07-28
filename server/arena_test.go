package main

import "testing"

func TestMatchQueuePairsOnSharedMap(t *testing.T) {
	a := NewArena(nil, NewPresence())

	m1, err := a.Enqueue(1, []string{"lava", "cyberpunk"})
	if err != nil || m1 != nil {
		t.Fatalf("first enqueue: match=%v err=%v", m1, err)
	}
	state, _, maps := a.Status(1)
	if state != "searching" || len(maps) != 2 {
		t.Fatalf("want searching with 2 maps, got %s %v", state, maps)
	}

	m2, err := a.Enqueue(2, []string{"desert", "lava"})
	if err != nil {
		t.Fatal(err)
	}
	if m2 == nil || m2.MapID != "lava" {
		t.Fatalf("expected lava match, got %+v", m2)
	}

	s1, match1, _ := a.Status(1)
	s2, match2, _ := a.Status(2)
	if s1 != "matched" || s2 != "matched" {
		t.Fatalf("states %s / %s", s1, s2)
	}
	if match1.ID != match2.ID {
		t.Fatal("players got different matches")
	}
	if a.MatchHub(match1.ID) == nil {
		t.Fatal("hub missing")
	}
}

func TestMatchQueueNoIntersectionStaysSearching(t *testing.T) {
	a := NewArena(nil, NewPresence())
	_, _ = a.Enqueue(1, []string{"cyberpunk"})
	m, err := a.Enqueue(2, []string{"lava"})
	if err != nil || m != nil {
		t.Fatalf("should not match: %v %v", m, err)
	}
	if s, _, _ := a.Status(1); s != "searching" {
		t.Fatal(s)
	}
	if s, _, _ := a.Status(2); s != "searching" {
		t.Fatal(s)
	}
}
