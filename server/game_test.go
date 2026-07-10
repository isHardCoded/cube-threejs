package main

import (
	"testing"
	"time"
)

// test hub without network: broadcast to nobody
func testHub() *Hub {
	return NewHub(&Store{})
}

func addTestPlayer(h *Hub, id string, l, x, z int) *Player {
	p := &Player{ID: id, Level: l, X: x, Z: z, Orient: StartOrient(), HP: MaxHP}
	h.players[id] = p
	return p
}

func TestKnockbackFenceStopsPlayer(t *testing.T) {
	h := testHub()
	p := addTestPlayer(h, "p", 0, Half, 0)
	if moved, _ := h.knockback(p, 1, 0); moved {
		t.Fatal("knockback over the edge should be stopped by the fence")
	}
	if p.X != Half || p.Z != 0 {
		t.Fatalf("player moved: (%d,%d)", p.X, p.Z)
	}
}

func TestKnockbackBouncesOffObstacle(t *testing.T) {
	h := testHub()
	// (4,1) is a blocked crate cell on level 0
	p := addTestPlayer(h, "p", 0, Half, 0)
	moved, fell := h.knockback(p, 0, 1)
	if !moved || fell {
		t.Fatalf("expected clean bounce, got moved=%v fell=%v", moved, fell)
	}
	if p.X != Half || p.Z != -1 {
		t.Fatalf("expected bounce to (4,-1), got (%d,%d)", p.X, p.Z)
	}
}

func TestKnockbackIntoHoleFalls(t *testing.T) {
	h := testHub()
	p := addTestPlayer(h, "p", 0, 0, 0)
	h.destroyed[0][[2]int{1, 0}] = true
	moved, fell := h.knockback(p, 1, 0)
	if !moved || !fell {
		t.Fatalf("expected fall into hole, got moved=%v fell=%v", moved, fell)
	}
}

func TestJumpOverFenceIsLethal(t *testing.T) {
	h := testHub()
	p := addTestPlayer(h, "p", 0, Half, 0)
	h.doJump(p, 1, 0, time.Now())
	if !p.Dead {
		t.Fatal("jumping over the fence should kill")
	}
}

func TestJumpTwoCells(t *testing.T) {
	h := testHub()
	p := addTestPlayer(h, "p", 0, 0, 0)
	h.doJump(p, 0, -1, time.Now())
	if p.Dead || p.X != 0 || p.Z != -2 {
		t.Fatalf("expected (0,-2) alive, got (%d,%d) dead=%v", p.X, p.Z, p.Dead)
	}
	// orientation must be unchanged by a jump
	if p.Orient != StartOrient() {
		t.Fatalf("jump changed orientation: %+v", p.Orient)
	}
}

func TestJumpIntoHoleFalls(t *testing.T) {
	h := testHub()
	p := addTestPlayer(h, "p", 0, 0, 0)
	h.destroyed[0][[2]int{0, -2}] = true
	h.doJump(p, 0, -1, time.Now())
	if !p.Dead {
		t.Fatal("landing in a hole should kill")
	}
}

func TestTrampolineLaunchesToNextLevel(t *testing.T) {
	h := testHub()
	p := addTestPlayer(h, "p", 0, 1, 0)
	c := [2]int{1, 1}
	h.tramp[0] = &c
	h.doRoll(p, 0, 1, time.Now())
	if p.Level != 1 {
		t.Fatalf("expected launch to level 1, got level %d", p.Level)
	}
}

func TestCrumbleKillsStandingPlayer(t *testing.T) {
	h := testHub()
	p := addTestPlayer(h, "p", 0, 3, 3)
	h.destroyCell(0, 3, 3, time.Now())
	if !p.Dead {
		t.Fatal("player standing on a destroyed tile should fall")
	}
	if !h.isHole(0, 3, 3) {
		t.Fatal("cell should be a hole")
	}
}

func TestFullCrumbleAdvancesPhase(t *testing.T) {
	h := testHub()
	h.phaseLevel = 0
	h.startCrumble()
	if h.tramp[0] == nil {
		t.Fatal("trampoline should spawn on level 0")
	}
	now := time.Now()
	for i := 0; i < 90 && h.phaseMode == modeCrumble; i++ {
		h.nextTileAt = now
		h.crumbleTick(now)
	}
	if h.phaseMode != modeCalm || h.phaseLevel != 1 {
		t.Fatalf("expected calm on level 1, got mode=%d level=%d", h.phaseMode, h.phaseLevel)
	}
}

func TestLevel2CrumbleResets(t *testing.T) {
	h := testHub()
	p := addTestPlayer(h, "p", 2, 2, 2)
	p.HP = 40
	h.phaseLevel = 2
	h.startCrumble()
	if h.tramp[2] != nil {
		t.Fatal("no trampoline on the last level")
	}
	now := time.Now()
	for i := 0; i < 90 && h.phaseMode == modeCrumble; i++ {
		h.nextTileAt = now
		h.crumbleTick(now)
	}
	if h.phaseMode != modeCalm || h.phaseLevel != 0 {
		t.Fatalf("expected reset to calm level 0, got mode=%d level=%d", h.phaseMode, h.phaseLevel)
	}
	if p.Level != 0 || p.HP != MaxHP || p.Dead {
		t.Fatalf("player not reset: level=%d hp=%d dead=%v", p.Level, p.HP, p.Dead)
	}
	for l := 0; l < Levels; l++ {
		if len(h.destroyed[l]) != 0 {
			t.Fatalf("level %d still has destroyed tiles after reset", l)
		}
	}
}

func TestLevelsIsolated(t *testing.T) {
	h := testHub()
	addTestPlayer(h, "a", 0, 1, 0)
	b := addTestPlayer(h, "b", 1, 1, 0)
	if h.playerAt(0, 1, 0) == b {
		t.Fatal("players on different levels must not collide")
	}
}
