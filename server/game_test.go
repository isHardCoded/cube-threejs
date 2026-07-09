package main

import "testing"

func TestKnockbackFenceStopsPlayer(t *testing.T) {
	h := NewHub(&Store{})
	p := &Player{ID: "p", X: Half, Z: 0, client: nil}
	h.players["p"] = p
	if h.knockback(p, 1, 0) {
		t.Fatal("knockback over the edge should be stopped by the fence")
	}
	if p.X != Half || p.Z != 0 {
		t.Fatalf("player moved: (%d,%d)", p.X, p.Z)
	}
}

func TestKnockbackBouncesOffObstacle(t *testing.T) {
	h := NewHub(&Store{})
	// (4,1) is a blocked crate cell; knocking from (4,0) toward it bounces to (4,-1)
	p := &Player{ID: "p", X: Half, Z: 0}
	h.players["p"] = p
	if !h.knockback(p, 0, 1) {
		t.Fatal("expected a bounce move")
	}
	if p.X != Half || p.Z != -1 {
		t.Fatalf("expected bounce to (4,-1), got (%d,%d)", p.X, p.Z)
	}
}

func TestKnockbackBouncesOffPlayer(t *testing.T) {
	h := NewHub(&Store{})
	p := &Player{ID: "p", X: 0, Z: 0}
	other := &Player{ID: "o", X: 1, Z: 0}
	h.players["p"] = p
	h.players["o"] = other
	if !h.knockback(p, 1, 0) {
		t.Fatal("expected a bounce move")
	}
	if p.X != -1 || p.Z != 0 {
		t.Fatalf("expected bounce to (-1,0), got (%d,%d)", p.X, p.Z)
	}
}

func TestKnockbackNormal(t *testing.T) {
	h := NewHub(&Store{})
	p := &Player{ID: "p", X: 0, Z: 0}
	h.players["p"] = p
	if !h.knockback(p, 0, -1) {
		t.Fatal("expected knockback to move")
	}
	if p.X != 0 || p.Z != -1 {
		t.Fatalf("expected (0,-1), got (%d,%d)", p.X, p.Z)
	}
}
