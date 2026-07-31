package main

import (
	"testing"
	"time"
)

func testArenaHub(t *testing.T) *Hub {
	t.Helper()
	h := NewHub(nil, MapByID(ArenaMapID), nil)
	h.mode = ModeArena
	h.gridHalf = ArenaHalf
	h.maxPlayers = 1
	h.mobs = make(map[string]*ArenaMob)
	return h
}

func TestArenaSurviveWin(t *testing.T) {
	h := testArenaHub(t)
	p := &Player{
		ID: "1", Name: "Hero", Level: 0, X: 0, Z: 0,
		Orient: StartOrient(), HP: MaxHP, Lives: 1, userID: 1,
	}
	h.players[p.ID] = p

	now := time.Now()
	h.startArena(now)
	if h.roundState != roundLive {
		t.Fatalf("expected live, got %d", h.roundState)
	}
	if h.arenaEndsAt.IsZero() {
		t.Fatal("survive deadline missing")
	}

	h.arenaEndsAt = now.Add(-time.Second)
	h.arenaTick(now)
	if h.roundState != roundOver {
		t.Fatalf("expected over after survive, got %d", h.roundState)
	}
}

func TestArenaKillGoalWin(t *testing.T) {
	h := testArenaHub(t)
	p := &Player{
		ID: "1", Name: "Hero", Level: 0, X: 0, Z: 0,
		Orient: StartOrient(), HP: MaxHP, Lives: 1, userID: 1,
	}
	h.players[p.ID] = p
	h.startArena(time.Now())

	m := &ArenaMob{
		ID: "m1", Kind: "small", X: 1, Z: 0,
		HP: 1, MaxHP: 6, Damage: 1, Scale: 0.55,
	}
	h.mobs[m.ID] = m
	h.arenaKills = ArenaKillGoal - 1
	h.killArenaMob(m, p)
	if h.roundState != roundOver {
		t.Fatalf("expected over after kill goal, got %d", h.roundState)
	}
	if h.arenaKills != ArenaKillGoal {
		t.Fatalf("kills=%d", h.arenaKills)
	}
}

func TestArenaMobDamageLow(t *testing.T) {
	for kind, spec := range arenaKinds {
		if spec.Damage > 3 {
			t.Fatalf("%s damage too high for test balance: %d", kind, spec.Damage)
		}
	}
}

func TestArenaPlayerHitsMob(t *testing.T) {
	h := testArenaHub(t)
	p := &Player{
		ID: "1", Name: "Hero", Level: 0, X: 0, Z: 0,
		Orient: StartOrient(), HP: ArenaMaxHP, Lives: 1, userID: 1,
	}
	h.players[p.ID] = p
	h.startArena(time.Now())

	nx, nz := p.X+1, p.Z
	if !h.inBounds(nx, nz) {
		nx, nz = p.X-1, p.Z
	}
	m := &ArenaMob{
		ID: "m1", Kind: "small", X: nx, Z: nz,
		HP: 6, MaxHP: 6, Damage: 1, Scale: 0.55,
		Orient: StartOrient(),
		landAt: time.Now().Add(-time.Second),
	}
	h.mobs[m.ID] = m

	dx := nx - p.X
	dz := nz - p.Z
	h.doRoll(p, dx, dz, time.Now())
	if h.mobs[m.ID] != nil && m.HP >= 6 {
		t.Fatalf("expected mob to take damage, hp=%d still present=%v", m.HP, h.mobs[m.ID] != nil)
	}
}

func TestArenaMutualBumpDamage(t *testing.T) {
	h := testArenaHub(t)
	p := &Player{
		ID: "1", Name: "Hero", Level: 0, X: 0, Z: 0,
		Orient: StartOrient(), HP: ArenaMaxHP, Lives: 1, userID: 1,
	}
	h.players[p.ID] = p
	h.startArena(time.Now())

	m := &ArenaMob{
		ID: "m1", Kind: "medium", X: 1, Z: 0,
		HP: 14, MaxHP: 14, Damage: 2, Scale: 0.85,
		Orient: StartOrient(),
		landAt: time.Now().Add(-time.Second),
	}
	h.mobs[m.ID] = m

	beforeP, beforeM := p.HP, m.HP
	h.mobBumpPlayer(m, p, -1, 0, time.Now())
	if p.HP >= beforeP {
		t.Fatalf("player should take face damage, hp %d → %d", beforeP, p.HP)
	}
	if m.HP >= beforeM {
		t.Fatalf("mob should take mutual face damage, hp %d → %d", beforeM, m.HP)
	}
	// Mob should be knocked away from the player (opposite of bump dx=-1 → +x).
	if m.X <= 1 {
		t.Fatalf("expected mob knockback past x=1, got x=%d", m.X)
	}
}

func TestArenaHitKnocksMob(t *testing.T) {
	h := testArenaHub(t)
	p := &Player{
		ID: "1", Name: "Hero", Level: 0, X: 0, Z: 0,
		Orient: StartOrient(), HP: ArenaMaxHP, Lives: 1, userID: 1,
	}
	h.players[p.ID] = p
	h.startArena(time.Now())

	m := &ArenaMob{
		ID: "m1", Kind: "small", X: 1, Z: 0,
		HP: 20, MaxHP: 20, Damage: 1, Scale: 0.55,
		Orient: StartOrient(),
		landAt: time.Now().Add(-time.Second),
	}
	h.mobs[m.ID] = m
	h.doRoll(p, 1, 0, time.Now())
	if m.HP >= 20 {
		t.Fatalf("mob should take damage, hp=%d", m.HP)
	}
	if m.HP > 0 && m.X <= 1 {
		t.Fatalf("expected knock along +x, got x=%d hp=%d", m.X, m.HP)
	}
}
