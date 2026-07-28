package main

import (
	"testing"
	"time"
)

// place puts a mine under a player and clears their cooldown for the next one.
func place(t *testing.T, h *Hub, p *Player) *Mine {
	t.Helper()
	p.mineReadyAt = time.Time{}
	h.placeMine(p, time.Now())
	m := h.mineAt(p.Level, p.X, p.Z)
	if m == nil {
		t.Fatalf("no mine at L%d (%d,%d)", p.Level, p.X, p.Z)
	}
	return m
}

// plantMine arms a cell and walks the owner away from it: a victim rolling in
// would otherwise collide with the owner standing there instead of the mine.
func plantMine(t *testing.T, h *Hub, owner *Player, x, z int) *Mine {
	t.Helper()
	owner.X, owner.Z = x, z
	m := place(t, h, owner)
	owner.X, owner.Z = Half, Half // free corner on cyberpunk level 0
	return m
}

func TestMineDamagesTheOneWhoStepsOnIt(t *testing.T) {
	h := testHub()
	owner := addTestPlayer(h, "owner", 0, 0, 0)
	plantMine(t, h, owner, 0, 0)

	victim := addTestPlayer(h, "victim", 0, 0, 1)
	h.doRoll(victim, 0, -1, time.Now()) // rolls onto (0,0)

	if victim.HP != MaxHP-MineDamage {
		t.Errorf("victim has %d hp, want %d", victim.HP, MaxHP-MineDamage)
	}
	if h.mineAt(0, 0, 0) != nil {
		t.Error("a triggered mine should be gone")
	}
	if owner.damageDealt != MineDamage {
		t.Errorf("owner credited %d damage", owner.damageDealt)
	}
}

func TestOwnMineIsSafeToWalkOver(t *testing.T) {
	h := testHub()
	owner := addTestPlayer(h, "owner", 0, 0, 0)
	place(t, h, owner)

	// step off and back on
	h.doRoll(owner, 0, 1, time.Now())
	owner.nextMoveAt = time.Time{}
	h.doRoll(owner, 0, -1, time.Now())

	if owner.HP != MaxHP {
		t.Errorf("owner took %d damage from their own mine", MaxHP-owner.HP)
	}
	if h.mineAt(0, 0, 0) == nil {
		t.Error("the owner walking over it should leave the mine armed")
	}
}

// The point of routing every landing through Hub.landed: a mine cannot be
// jumped over, dashed past or pushed onto without going off.
func TestMineTriggersOnEveryKindOfArrival(t *testing.T) {
	cases := []struct {
		name string
		run  func(h *Hub, victim *Player)
	}{
		{"roll", func(h *Hub, v *Player) {
			v.X, v.Z = 0, 1
			h.doRoll(v, 0, -1, time.Now())
		}},
		{"jump", func(h *Hub, v *Player) {
			v.X, v.Z = 0, 2
			h.doJump(v, 0, -1, time.Now())
		}},
		{"dash", func(h *Hub, v *Player) {
			v.X, v.Z = 0, 2
			h.doDash(v, 0, -1, time.Now())
		}},
		{"knockback", func(h *Hub, v *Player) {
			v.X, v.Z = 0, 1
			if moved, _ := h.knockback(v, 0, -1); !moved {
				t.Fatal("knockback did not move the victim")
			}
			h.landed(v, time.Now())
		}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := testHub()
			// (0,0) and the cells used below are free on cyberpunk level 0
			owner := addTestPlayer(h, "owner", 0, 0, 0)
			plantMine(t, h, owner, 0, 0)

			victim := addTestPlayer(h, "victim", 0, 0, 1)
			tc.run(h, victim)

			if victim.X != 0 || victim.Z != 0 {
				t.Fatalf("victim ended at (%d,%d), not on the mine", victim.X, victim.Z)
			}
			if victim.HP != MaxHP-MineDamage {
				t.Errorf("%s onto a mine did nothing: %d hp", tc.name, victim.HP)
			}
		})
	}
}

func TestMineCanKillAndCreditsTheOwner(t *testing.T) {
	h := testHub()
	owner := addTestPlayer(h, "owner", 0, 0, 0)
	plantMine(t, h, owner, 0, 0)

	victim := addTestPlayer(h, "victim", 0, 0, 1)
	victim.HP = MineDamage - 1
	h.doRoll(victim, 0, -1, time.Now())

	if !victim.Dead {
		t.Fatalf("victim survived with %d hp", victim.HP)
	}
	if owner.kills != 1 || owner.roundKills != 1 {
		t.Errorf("owner kills=%d roundKills=%d", owner.kills, owner.roundKills)
	}
}

func TestMineLimitsAndCooldown(t *testing.T) {
	h := testHub()
	p := addTestPlayer(h, "p", 0, 0, 0)

	h.placeMine(p, time.Now())
	if len(h.minesOf("p")) != 1 {
		t.Fatal("first mine was not placed")
	}

	// same spot, cooldown ignored: stacking is refused
	p.mineReadyAt = time.Time{}
	h.placeMine(p, time.Now())
	if len(h.minesOf("p")) != 1 {
		t.Error("a second mine landed on the same cell")
	}

	// cooldown blocks the next one even from a fresh cell
	p.X, p.Z = 1, 1
	p.mineReadyAt = time.Now().Add(MineCooldown)
	h.placeMine(p, time.Now())
	if len(h.minesOf("p")) != 1 {
		t.Error("cooldown did not block the next mine")
	}

	// up to the limit, then no more
	for i := 0; i < MaxMinesAlive+2; i++ {
		p.X, p.Z = i, 2
		p.mineReadyAt = time.Time{}
		h.placeMine(p, time.Now())
	}
	if n := len(h.minesOf("p")); n != MaxMinesAlive {
		t.Errorf("player holds %d mines, limit is %d", n, MaxMinesAlive)
	}
}

func TestMinesExpireAndClearWithTheRound(t *testing.T) {
	h := testHub()
	p := addTestPlayer(h, "p", 0, 0, 0)
	m := place(t, h, p)

	h.expireMines(time.Now())
	if h.mineAt(0, 0, 0) == nil {
		t.Fatal("a fresh mine should not expire")
	}

	m.expires = time.Now().Add(-time.Second)
	h.expireMines(time.Now())
	if h.mineAt(0, 0, 0) != nil {
		t.Error("an expired mine should be gone")
	}

	place(t, h, p)
	h.resetRound()
	if len(h.mines) != 0 {
		t.Error("a new round should start without mines")
	}
}

func TestCrumbledTileTakesTheMineWithIt(t *testing.T) {
	h := testHub()
	p := addTestPlayer(h, "p", 0, 3, 1)
	place(t, h, p)

	h.destroyCell(0, 3, 1, time.Now())
	if h.mineAt(0, 3, 1) != nil {
		t.Error("the mine outlived the tile it sat on")
	}
}

func TestTrampolineCellRefusesMines(t *testing.T) {
	h := testHub()
	c := [2]int{0, 0}
	h.tramp[0] = &c
	p := addTestPlayer(h, "p", 0, 0, 0)

	h.placeMine(p, time.Now())
	if h.mineAt(0, 0, 0) != nil {
		t.Error("the escape route must not be mineable")
	}
}
