package main

import (
	"encoding/json"
	"testing"
	"time"
)

// A client with a buffered channel and no socket: enough for the hub to run its
// full join/broadcast path, and it lets tests read the actual wire messages.
func testClient(h *Hub, userID int64, name string) *Client {
	return &Client{
		send: make(chan []byte, 64), hub: h,
		userID: userID, name: name, skinID: DefaultSkin,
	}
}

func drain(c *Client) []map[string]any {
	var out []map[string]any
	for {
		select {
		case data, ok := <-c.send:
			// a retired connection has a closed channel: everything it was told
			// is already in the buffer
			if !ok {
				return out
			}
			var m map[string]any
			if json.Unmarshal(data, &m) == nil {
				out = append(out, m)
			}
		default:
			return out
		}
	}
}

// findMsg returns the newest message of the given type.
func findMsg(msgs []map[string]any, t string) map[string]any {
	for i := len(msgs) - 1; i >= 0; i-- {
		if msgs[i]["t"] == t {
			return msgs[i]
		}
	}
	return nil
}

func liveRound(t *testing.T) (*Hub, *Client, *Client) {
	t.Helper()
	h := testHub()
	a, b := testClient(h, 1, "Alice"), testClient(h, 2, "Bob")
	h.onJoin(a)
	h.onJoin(b)
	h.roundTick(time.Now())
	if h.roundState != roundLive {
		t.Fatalf("round should be live with %d players", len(h.players))
	}
	return h, a, b
}

// eliminate burns every life the player has, which is what it now takes to put
// someone out of a round.
func eliminate(h *Hub, p *Player, now time.Time) {
	for i := 0; i < MaxLives && !p.Spectating; i++ {
		h.kill(p, now)
	}
}

func TestDeathCostsALifeNotTheRound(t *testing.T) {
	h, _, b := liveRound(t)
	now := time.Now()

	h.kill(b.player, now)
	if b.player.Lives != MaxLives-1 {
		t.Errorf("lives after one death: %d, want %d", b.player.Lives, MaxLives-1)
	}
	if b.player.Spectating {
		t.Fatal("one death must not end the round for a player with lives left")
	}
	if h.aliveCount() != 2 {
		t.Errorf("a respawning player is still in the round, alive=%d", h.aliveCount())
	}

	b.player.respawnAt = now.Add(-time.Second)
	h.onTick()
	if b.player.Dead {
		t.Error("a player with lives left should come back")
	}
	if b.player.HP != MaxHP {
		t.Errorf("respawn should restore hp, got %d", b.player.HP)
	}
	if h.roundState != roundLive {
		t.Error("the round should still be running")
	}

	// the death message has to carry the new count, or the HUD cannot show it
	death := findMsg(drain(b), "death")
	if death == nil || death["lives"] != float64(MaxLives-1) {
		t.Errorf("death message lives: %v", death)
	}
	if death["eliminated"] == true {
		t.Error("this death was not an elimination")
	}
}

func TestLastLifeEliminates(t *testing.T) {
	h, _, b := liveRound(t)
	now := time.Now()

	for i := 1; i <= MaxLives; i++ {
		h.kill(b.player, now)
		out := b.player.Spectating
		if want := i == MaxLives; out != want {
			t.Fatalf("after %d/%d deaths spectating=%v", i, MaxLives, out)
		}
	}

	b.player.respawnAt = now.Add(-time.Second)
	h.onTick()
	if !b.player.Dead {
		t.Error("a player out of lives must not respawn")
	}
	death := findMsg(drain(b), "death")
	if death["eliminated"] != true || death["lives"] != float64(0) {
		t.Errorf("final death message: %v", death)
	}
}

func TestPracticeDeathsAreFree(t *testing.T) {
	h := testHub()
	c := testClient(h, 1, "Solo")
	h.onJoin(c)
	h.roundTick(time.Now())

	for i := 0; i < MaxLives+3; i++ {
		h.kill(c.player, time.Now())
		c.player.respawnAt = time.Now().Add(-time.Second)
		h.onTick()
	}
	if c.player.Lives != MaxLives {
		t.Errorf("practice spent %d lives", MaxLives-c.player.Lives)
	}
	if c.player.Spectating {
		t.Error("practice must never eliminate")
	}
}

func TestAloneIsPracticeWithRespawns(t *testing.T) {
	h := testHub()
	c := testClient(h, 1, "Solo")
	h.onJoin(c)
	h.roundTick(time.Now())

	if h.roundState != roundWaiting {
		t.Fatal("a single player must not start a match")
	}
	if c.player.Spectating {
		t.Error("a practising player should be on the board")
	}

	h.kill(c.player, time.Now())
	if c.player.Spectating {
		t.Error("practice death must not eliminate")
	}

	c.player.respawnAt = time.Now().Add(-time.Second)
	h.onTick()
	if c.player.Dead {
		t.Error("practice death should respawn")
	}
}

func TestRoundStartsAndAnnouncesItself(t *testing.T) {
	h, a, _ := liveRound(t)
	if h.aliveCount() != 2 {
		t.Fatalf("expected 2 alive, got %d", h.aliveCount())
	}

	reset := findMsg(drain(a), "reset")
	if reset == nil {
		t.Fatal("round start should reset the world")
	}
	round, _ := reset["round"].(map[string]any)
	if round == nil || round["state"] != "live" {
		t.Errorf("reset should say the round is live, got %v", reset["round"])
	}
	if round["alive"] != float64(2) {
		t.Errorf("alive count in reset: %v", round["alive"])
	}
}

func TestDeathEliminatesAndPaysTheWinner(t *testing.T) {
	h, a, b := liveRound(t)
	now := time.Now()
	h.roundStartedAt = now.Add(-MinRewardedRound) // a real fight, long enough to pay
	a.player.roundKills = 2

	eliminate(h, b.player, now)
	if !b.player.Spectating {
		t.Fatal("running out of lives must eliminate")
	}
	b.player.respawnAt = now.Add(-time.Second)
	h.onTick()
	if !b.player.Dead {
		t.Error("eliminated players must not respawn mid-round")
	}

	h.roundTick(now)
	if h.roundState != roundOver {
		t.Fatal("last survivor should end the round")
	}

	over := findMsg(drain(a), "roundOver")
	if over == nil {
		t.Fatal("no roundOver broadcast")
	}
	if over["winnerId"] != a.player.ID {
		t.Errorf("winner is %v, want %s", over["winnerId"], a.player.ID)
	}
	want := float64(CubesForWin + 2*CubesPerKill)
	if over["reward"] != want {
		t.Errorf("reward is %v, want %v", over["reward"], want)
	}
}

func TestQuickWinPaysNothing(t *testing.T) {
	h, a, b := liveRound(t)
	now := time.Now() // round just started

	eliminate(h, b.player, now)
	h.roundTick(now)

	over := findMsg(drain(a), "roundOver")
	if over == nil {
		t.Fatal("no roundOver broadcast")
	}
	if over["reward"] != float64(0) {
		t.Errorf("a round this short should pay nothing, got %v", over["reward"])
	}
	if over["tooShort"] != true {
		t.Error("the client needs to know why the win paid nothing")
	}
}

func TestMutualKillIsADraw(t *testing.T) {
	h, a, b := liveRound(t)
	now := time.Now()
	eliminate(h, a.player, now)
	eliminate(h, b.player, now)
	h.roundTick(now)

	over := findMsg(drain(a), "roundOver")
	if over == nil || over["draw"] != true {
		t.Errorf("no survivors should be a draw, got %v", over)
	}
	if _, paid := over["reward"]; paid {
		t.Error("a draw must not pay anyone")
	}
}

func TestJoiningMidRoundOnlyWatches(t *testing.T) {
	h, _, _ := liveRound(t)
	late := testClient(h, 3, "Late")
	h.onJoin(late)

	if !late.player.Spectating {
		t.Fatal("a fight in progress is not joinable")
	}
	if h.aliveCount() != 2 {
		t.Errorf("spectator counted as alive: %d", h.aliveCount())
	}

	x, z := late.player.X, late.player.Z
	h.onCommand(command{client: late, msg: clientMsg{T: "move", DX: 1}})
	if late.player.X != x || late.player.Z != z {
		t.Error("spectators must not be able to move")
	}
}

func TestNextRoundRevivesEveryone(t *testing.T) {
	h, a, b := liveRound(t)
	now := time.Now()
	h.destroyCell(0, Half, Half, now) // some damage to the arena
	eliminate(h, b.player, now)
	h.roundTick(now)

	h.roundEndsAt = time.Now().Add(-time.Millisecond) // intermission is over
	h.roundTick(time.Now())

	if h.roundState != roundLive {
		t.Fatalf("expected a new round, state=%d", h.roundState)
	}
	if h.aliveCount() != 2 {
		t.Errorf("both players should be back, alive=%d", h.aliveCount())
	}
	if b.player.Spectating || b.player.Dead {
		t.Error("the eliminated player should be playing again")
	}
	if len(h.destroyed[0]) != 0 {
		t.Errorf("arena not rebuilt: %d tiles still gone", len(h.destroyed[0]))
	}
	for _, p := range h.players {
		if p.Level != 0 || p.HP != MaxHP || p.Lives != MaxLives {
			t.Errorf("%s starts at L%d with %d hp and %d lives",
				p.ID, p.Level, p.HP, p.Lives)
		}
	}
	drain(a)
}

func TestLastPlayerLeftDropsToPractice(t *testing.T) {
	h, _, b := liveRound(t)
	now := time.Now()
	eliminate(h, b.player, now)
	h.roundTick(now)
	h.dropPlayer(b.player) // the loser closed the tab

	h.roundEndsAt = time.Now().Add(-time.Millisecond)
	h.roundTick(time.Now())

	if h.roundState != roundWaiting {
		t.Fatalf("one player left should mean practice, state=%d", h.roundState)
	}
}

func TestWalkoverEndsTheRound(t *testing.T) {
	h, _, b := liveRound(t)
	h.dropPlayer(b.player) // opponent disconnects instead of dying
	h.roundTick(time.Now())

	if h.roundState != roundOver {
		t.Fatal("a lone survivor should end the round")
	}
}
