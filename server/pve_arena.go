package main

import (
	"log"
	mrand "math/rand"
	"strconv"
	"time"
)

// Arena PvE: flat sector floor, hostile cubes drop from the sky and chase the
// player. Win by surviving ArenaSurviveFor or scoring ArenaKillGoal kills.
const (
	ModeArena = "arena"

	ArenaMapID = "arena"

	// 27×27 cells ≈ 3× the normal 9×9 board (Half=4 → span 9).
	ArenaHalf = 13

	ArenaMaxHP = 100

	ArenaSurviveFor = 60 * time.Second
	ArenaKillGoal   = 100
	ArenaWinReward  = 15 // Cubes for a clear — tuned for testing

	ArenaMaxMobs     = 28
	ArenaSpawnStart  = 1600 * time.Millisecond
	ArenaSpawnFloor  = 750 * time.Millisecond
	ArenaLandDelay   = 700 * time.Millisecond // falling; cannot bump yet
	ArenaBumpCD      = 700 * time.Millisecond // mob contact spam gate
)

// Hostile cube sizes. Face damage still applies; Damage is a floor on contact.
var arenaKinds = map[string]struct {
	HP     int
	Damage int
	Scale  float64
	Step   time.Duration
	Weight int
}{
	"small":  {HP: 8, Damage: 1, Scale: 0.55, Step: 280 * time.Millisecond, Weight: 50},
	"medium": {HP: 14, Damage: 2, Scale: 0.85, Step: 400 * time.Millisecond, Weight: 35},
	"large":  {HP: 24, Damage: 3, Scale: 1.2, Step: 550 * time.Millisecond, Weight: 15},
}

type ArenaMob struct {
	ID     string  `json:"id"`
	Kind   string  `json:"kind"`
	X      int     `json:"x"`
	Z      int     `json:"z"`
	HP     int     `json:"hp"`
	MaxHP  int     `json:"maxHp"`
	Damage int     `json:"damage"`
	Scale  float64 `json:"scale"`
	Orient

	landAt     time.Time
	nextMoveAt time.Time
	bumpReady  time.Time
}

func (m *ArenaMob) snapshot() map[string]any {
	return map[string]any{
		"id": m.ID, "kind": m.Kind, "x": m.X, "z": m.Z,
		"hp": m.HP, "maxHp": m.MaxHP, "damage": m.Damage, "scale": m.Scale,
		"top": m.Top, "east": m.East, "south": m.South,
	}
}

func (a *Arena) ArenaHub(userID int64) *Hub {
	gm := MapByID(ArenaMapID)
	id := "arena-" + strconv.FormatInt(userID, 10)

	a.mu.Lock()
	defer a.mu.Unlock()
	if h := a.rooms[id]; h != nil {
		return h
	}
	h := NewHub(a.store, gm, a.presence)
	h.id = id
	h.mode = ModeArena
	h.gridHalf = ArenaHalf
	h.maxPlayers = 1
	h.allowed = map[int64]bool{userID: true}
	h.mobs = make(map[string]*ArenaMob)
	h.onEmpty = func(hub *Hub) { a.removeRoom(hub.id) }
	a.rooms[id] = h
	a.startHub(h)
	log.Println("arena: pve room", id)
	return h
}

func (h *Hub) isArena() bool { return h.mode == ModeArena }

func (h *Hub) clearMobs() {
	if h.mobs == nil {
		h.mobs = make(map[string]*ArenaMob)
		return
	}
	for id := range h.mobs {
		delete(h.mobs, id)
	}
}

func (h *Hub) mobList() []map[string]any {
	out := make([]map[string]any, 0, len(h.mobs))
	for _, m := range h.mobs {
		out = append(out, m.snapshot())
	}
	return out
}

func (h *Hub) mobAt(x, z int) *ArenaMob {
	for _, m := range h.mobs {
		if m.X == x && m.Z == z {
			return m
		}
	}
	return nil
}

func (h *Hub) arenaInfo(now time.Time) map[string]any {
	remain := int64(0)
	if h.roundState == roundLive && !h.arenaEndsAt.IsZero() {
		remain = time.Until(h.arenaEndsAt).Milliseconds()
		if remain < 0 {
			remain = 0
		}
	}
	return map[string]any{
		"kills":     h.arenaKills,
		"killGoal":  ArenaKillGoal,
		"remainMs":  remain,
		"surviveMs": ArenaSurviveFor.Milliseconds(),
	}
}

// prepareArena arms a live wave without broadcasting — used so welcome already
// carries round=live / arena timer for a joining client.
func (h *Hub) prepareArena(now time.Time) {
	h.clearMobs()
	h.arenaKills = 0
	h.nextMobSeq = 0
	h.arenaEndsAt = now.Add(ArenaSurviveFor)
	h.nextMobSpawn = now.Add(1200 * time.Millisecond)
	h.roundState = roundLive
	h.roundStartedAt = now
	h.readySince = time.Time{}

	for l := 0; l < Levels; l++ {
		h.destroyed[l] = make(map[[2]int]bool)
		h.tramp[l] = nil
	}
	h.clearMines()
	h.phaseMode = modeCalm
	h.phaseLevel = 0
	h.phaseEndsAt = now.Add(24 * time.Hour) // never crumble

	for _, p := range h.players {
		p.Level = 0
		p.HP = ArenaMaxHP
		p.Lives = 1 // one life: death = lose
		p.Dead = false
		p.Spectating = false
		p.roundKills = 0
		p.foughtRound = true
		p.Orient = StartOrient()
		p.nextMoveAt = now
		p.X, p.Z = 0, 0
	}
	log.Printf("%s: arena wave started", h.id)
}

func (h *Hub) startArena(now time.Time) {
	h.prepareArena(now)
	list := make([]*Player, 0, len(h.players))
	for _, p := range h.players {
		list = append(list, p)
	}
	h.broadcast(map[string]any{
		"t": "reset", "players": list,
		"phase": h.phaseInfo(), "round": h.roundInfo(),
		"arena": h.arenaInfo(now), "mobs": []any{},
	})
	h.broadcast(map[string]any{"t": "mobsClear"})
	h.broadcast(map[string]any{"t": "arena", "arena": h.arenaInfo(now)})
}

func (h *Hub) endArena(won bool, now time.Time) {
	if h.roundState != roundLive {
		return
	}
	h.roundState = roundOver
	h.roundEndsAt = now.Add(IntermissionTime)
	h.clearMobs()
	h.broadcast(map[string]any{"t": "mobsClear"})

	msg := map[string]any{
		"t": "roundOver", "nextInMs": IntermissionTime.Milliseconds(),
		"mode": "arena", "kills": h.arenaKills,
	}
	var hero *Player
	for _, p := range h.players {
		if p.userID != 0 {
			hero = p
			break
		}
	}
	if won && hero != nil {
		reward := ArenaWinReward
		h.award(hero, reward)
		msg["winnerId"] = hero.ID
		msg["winnerName"] = hero.Name
		msg["reward"] = reward
		msg["mine"] = true // client shows local win banner
		log.Printf("%s: arena win kills=%d reward=%d", h.id, h.arenaKills, reward)
	} else {
		msg["lose"] = true
		msg["draw"] = true
		log.Printf("%s: arena lose kills=%d", h.id, h.arenaKills)
	}
	h.broadcast(msg)
}

func (h *Hub) pickArenaKind() string {
	total := 0
	for _, k := range arenaKinds {
		total += k.Weight
	}
	roll := mrand.Intn(total)
	acc := 0
	for name, k := range arenaKinds {
		acc += k.Weight
		if roll < acc {
			return name
		}
	}
	return "small"
}

func (h *Hub) freeMobCell(avoidX, avoidZ int) (int, int, bool) {
	hh := h.gridSpan()
	// Prefer the rim so drops read as coming in from the sky edge.
	var rim [][2]int
	var any [][2]int
	for x := -hh; x <= hh; x++ {
		for z := -hh; z <= hh; z++ {
			if x == avoidX && z == avoidZ {
				continue
			}
			if h.isBlocked(0, x, z) || h.isHole(0, x, z) {
				continue
			}
			if h.playerAt(0, x, z) != nil || h.mobAt(x, z) != nil {
				continue
			}
			cell := [2]int{x, z}
			any = append(any, cell)
			if abs(x) == hh || abs(z) == hh {
				rim = append(rim, cell)
			}
		}
	}
	pool := rim
	if len(pool) == 0 {
		pool = any
	}
	if len(pool) == 0 {
		return 0, 0, false
	}
	c := pool[mrand.Intn(len(pool))]
	return c[0], c[1], true
}

func (h *Hub) spawnArenaMob(now time.Time) {
	if len(h.mobs) >= ArenaMaxMobs {
		return
	}
	px, pz := 0, 0
	if p := h.arenaHero(); p != nil {
		px, pz = p.X, p.Z
	}
	x, z, ok := h.freeMobCell(px, pz)
	if !ok {
		return
	}
	kind := h.pickArenaKind()
	spec := arenaKinds[kind]
	h.nextMobSeq++
	id := "m" + strconv.Itoa(h.nextMobSeq)
	m := &ArenaMob{
		ID: id, Kind: kind, X: x, Z: z,
		HP: spec.HP, MaxHP: spec.HP, Damage: spec.Damage, Scale: spec.Scale,
		Orient:     StartOrient(),
		landAt:     now.Add(ArenaLandDelay),
		nextMoveAt: now.Add(ArenaLandDelay + spec.Step),
	}
	h.mobs[id] = m
	snap := m.snapshot()
	snap["fall"] = true
	h.broadcast(map[string]any{"t": "mobSpawn", "mob": snap})
}

func (h *Hub) arenaHero() *Player {
	for _, p := range h.players {
		if !p.Dead && !p.Spectating {
			return p
		}
	}
	return nil
}

func (h *Hub) arenaSpawnInterval(now time.Time) time.Duration {
	elapsed := now.Sub(h.roundStartedAt)
	// Ease spawn rate from start toward floor over the minute.
	t := float64(elapsed) / float64(ArenaSurviveFor)
	if t > 1 {
		t = 1
	}
	start := float64(ArenaSpawnStart)
	floor := float64(ArenaSpawnFloor)
	return time.Duration(start + (floor-start)*t)
}

func (h *Hub) stepArenaMob(m *ArenaMob, hero *Player, now time.Time) {
	if now.Before(m.landAt) || now.Before(m.nextMoveAt) {
		return
	}
	spec := arenaKinds[m.Kind]
	m.nextMoveAt = now.Add(spec.Step)

	dx, dz := 0, 0
	if hero.X > m.X {
		dx = 1
	} else if hero.X < m.X {
		dx = -1
	}
	if hero.Z > m.Z {
		dz = 1
	} else if hero.Z < m.Z {
		dz = -1
	}
	// Prefer the longer axis so pathing is less diagonal-jittery.
	dirs := make([][2]int, 0, 4)
	if abs(hero.X-m.X) >= abs(hero.Z-m.Z) {
		if dx != 0 {
			dirs = append(dirs, [2]int{dx, 0})
		}
		if dz != 0 {
			dirs = append(dirs, [2]int{0, dz})
		}
	} else {
		if dz != 0 {
			dirs = append(dirs, [2]int{0, dz})
		}
		if dx != 0 {
			dirs = append(dirs, [2]int{dx, 0})
		}
	}
	// Side steps if blocked.
	dirs = append(dirs, [2]int{1, 0}, [2]int{-1, 0}, [2]int{0, 1}, [2]int{0, -1})

	for _, d := range dirs {
		nx, nz := m.X+d[0], m.Z+d[1]
		if !h.inBounds(nx, nz) || h.isBlocked(0, nx, nz) || h.isHole(0, nx, nz) {
			continue
		}
		if other := h.mobAt(nx, nz); other != nil && other != m {
			continue
		}
		if p := h.playerAt(0, nx, nz); p != nil {
			h.mobBumpPlayer(m, p, d[0], d[1], now)
			return
		}
		m.X, m.Z = nx, nz
		m.Orient = m.Orient.Roll(d[0], d[1])
		h.broadcast(map[string]any{
			"t": "mobMove", "id": m.ID, "x": m.X, "z": m.Z,
			"top": m.Top, "east": m.East, "south": m.South,
			"dx": d[0], "dz": d[1],
		})
		return
	}
}

// knockMob pushes a hostile cube one cell in (dx, dz). Skips occupied / OOB cells.
func (h *Hub) knockMob(m *ArenaMob, dx, dz int) bool {
	if dx == 0 && dz == 0 {
		return false
	}
	nx, nz := m.X+dx, m.Z+dz
	if !h.inBounds(nx, nz) || h.isBlocked(0, nx, nz) || h.isHole(0, nx, nz) {
		return false
	}
	if h.playerAt(0, nx, nz) != nil {
		return false
	}
	if other := h.mobAt(nx, nz); other != nil && other != m {
		return false
	}
	m.X, m.Z = nx, nz
	m.Orient = m.Orient.Roll(dx, dz)
	return true
}

func (h *Hub) mobBumpPlayer(m *ArenaMob, p *Player, dx, dz int, now time.Time) {
	if now.Before(m.bumpReady) || p.Dead {
		return
	}
	m.bumpReady = now.Add(ArenaBumpCD)
	// Mutual face damage, same idea as cube-vs-cube — with kind damage as a floor.
	dmgToPlayer := m.Orient.FaceToward(dx, dz)
	if dmgToPlayer < m.Damage {
		dmgToPlayer = m.Damage
	}
	dmgToMob := p.FaceToward(-dx, -dz)
	if dmgToMob < 1 {
		dmgToMob = 1
	}

	p.HP -= dmgToPlayer
	m.HP -= dmgToMob
	p.damageDealt += dmgToMob

	mobKnock := false
	if m.HP > 0 {
		mobKnock = h.knockMob(m, -dx, -dz)
	}
	playerKnock := false
	if !p.Dead && p.HP > 0 {
		if moved, fell := h.knockback(p, dx, dz); moved {
			playerKnock = true
			if fell {
				h.kill(p, now)
			} else {
				h.landed(p, now)
			}
		}
	}

	hit := map[string]any{
		"t": "mobHit", "id": m.ID, "hp": m.HP,
		"dmgToMob": dmgToMob, "dmgToPlayer": dmgToPlayer, "playerHp": p.HP,
		"dx": dx, "dz": dz, "playerId": p.ID,
		"top": m.Top, "east": m.East, "south": m.South,
		"x": m.X, "z": m.Z, "knock": mobKnock,
	}
	if playerKnock {
		hit["playerX"] = p.X
		hit["playerZ"] = p.Z
		hit["playerKnock"] = true
	}
	h.broadcast(hit)
	if playerKnock && !p.Dead {
		h.broadcast(map[string]any{"t": "move", "p": p, "knock": true})
	}
	if m.HP <= 0 {
		h.killArenaMob(m, p)
	}
	if p.HP <= 0 && !p.Dead {
		h.kill(p, now)
	}
}

// resolveMobHit: player rolls/dashes/stomps into a hostile cube.
func (h *Hub) resolveMobHit(p *Player, m *ArenaMob, dx, dz int, now time.Time, stomp bool) {
	dmgToMob := p.FaceToward(dx, dz)
	if stomp {
		dmgToMob = 7 - p.Top
		if dmgToMob < 1 {
			dmgToMob = 1
		}
	}
	dmgToPlayer := 0
	if !now.Before(m.landAt) {
		dmgToPlayer = m.Orient.FaceToward(-dx, -dz)
		if dmgToPlayer < m.Damage {
			dmgToPlayer = m.Damage
		}
	}

	m.HP -= dmgToMob
	p.damageDealt += dmgToMob
	if dmgToPlayer > 0 {
		p.HP -= dmgToPlayer
	}

	mobKnock := false
	if m.HP > 0 {
		// Push the enemy away along the attack; stomp still knocks off the tile.
		mobKnock = h.knockMob(m, dx, dz)
	}

	h.broadcast(map[string]any{
		"t": "mobHit", "id": m.ID, "hp": m.HP,
		"dmgToMob": dmgToMob, "dmgToPlayer": dmgToPlayer, "playerHp": p.HP,
		"dx": dx, "dz": dz, "playerId": p.ID, "stomp": stomp,
		"top": m.Top, "east": m.East, "south": m.South,
		"x": m.X, "z": m.Z, "knock": mobKnock,
	})

	if m.HP <= 0 {
		h.killArenaMob(m, p)
	}
	if p.HP <= 0 && !p.Dead {
		h.kill(p, now)
	}
}

func (h *Hub) killArenaMob(m *ArenaMob, by *Player) {
	delete(h.mobs, m.ID)
	h.arenaKills++
	if by != nil {
		by.kills++
		by.roundKills++
	}
	h.broadcast(map[string]any{
		"t": "mobDie", "id": m.ID, "kills": h.arenaKills,
	})
	h.broadcast(map[string]any{"t": "arena", "arena": h.arenaInfo(time.Now())})
	if h.arenaKills >= ArenaKillGoal && h.roundState == roundLive {
		h.endArena(true, time.Now())
	}
}

func (h *Hub) arenaTick(now time.Time) {
	if !h.isArena() || h.closing {
		return
	}
	switch h.roundState {
	case roundWaiting:
		if len(h.players) >= 1 {
			h.startArena(now)
		}
	case roundLive:
		hero := h.arenaHero()
		if hero == nil {
			// Fighter left the socket — tear the room down, don't award a "lose".
			if len(h.players) == 0 {
				return
			}
			h.endArena(false, now)
			return
		}
		if !h.arenaEndsAt.IsZero() && !now.Before(h.arenaEndsAt) {
			h.endArena(true, now)
			return
		}
		if !h.nextMobSpawn.IsZero() && !now.Before(h.nextMobSpawn) {
			h.spawnArenaMob(now)
			h.nextMobSpawn = now.Add(h.arenaSpawnInterval(now))
		}
		for _, m := range h.mobs {
			h.stepArenaMob(m, hero, now)
			if h.roundState != roundLive {
				return
			}
		}
		// Keep HUD timer in sync roughly once a second via arena messages is enough
		// from spawn/kill; also nudge on spawn cadence.
	case roundOver:
		// handled in roundTick — restart or close
	}
}
