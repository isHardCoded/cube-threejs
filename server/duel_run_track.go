package main

import (
	"math"
	mrand "math/rand"
	"time"
)

// Segment kinds (TZ §7).
const (
	SegStraight         = "Straight"
	SegObstacleEasy     = "ObstacleEasy"
	SegObstacleMedium   = "ObstacleMedium"
	SegObstacleHard     = "ObstacleHard"
	SegJump             = "JumpSection"
	SegMovingObstacle   = "MovingObstacleSection"
	SegFallingTiles     = "FallingTilesSection"
	SegSplitPath        = "SplitPath"
	SegSpeed            = "SpeedSection"
	SegRecovery         = "RecoverySection"
	SegBattleApproach   = "BattleApproach"
	SegBattleArena      = "BattleArena"
)

type DRObstacleType string

const (
	ObsRock           DRObstacleType = "rock"
	ObsWall           DRObstacleType = "wall"
	ObsCrate          DRObstacleType = "crate"
	ObsHighBarrier    DRObstacleType = "high_barrier"
	ObsLowBarrier     DRObstacleType = "low_barrier"
	ObsPit            DRObstacleType = "pit"
	ObsMissingTile    DRObstacleType = "missing_tile"
	ObsSwingHammer    DRObstacleType = "swing_hammer"
	ObsSpinBeam       DRObstacleType = "spin_beam"
	ObsMovingBlock    DRObstacleType = "moving_block"
	ObsFallingObject  DRObstacleType = "falling_object"
	ObsSpikes         DRObstacleType = "spikes"
	ObsMovingPlatform DRObstacleType = "moving_platform"
	ObsLava           DRObstacleType = "lava"
	ObsPiranhaWater   DRObstacleType = "piranha_water"
	ObsAbyss          DRObstacleType = "abyss"
	ObsElectric       DRObstacleType = "electric"
	ObsCrumble        DRObstacleType = "crumble"
)

type DRObstacleSpec struct {
	ID              string         `json:"obstacleId"`
	Type            DRObstacleType `json:"type"`
	Damage          int            `json:"damage"`
	CollisionType   string         `json:"collisionType"` // solid | hazard | gap | jumpable | slideable
	ActiveDuration  float64        `json:"activeDuration"`
	Cooldown         float64        `json:"cooldown"`
	TelegraphTime   float64        `json:"telegraphTime"`
	LaneMask        int            `json:"laneMask"` // bit0=L bit1=C bit2=R
	DifficultyRating int           `json:"difficultyRating"`
	Z               float64        `json:"z"` // local offset within segment
	Critical        bool           `json:"critical"`
}

type DRPickupSpec struct {
	ID   string  `json:"id"`
	Kind string  `json:"kind"`
	Z    float64 `json:"z"`
	Lane int     `json:"lane"`
}

type DRSegment struct {
	ID       string           `json:"id"`
	Kind     string           `json:"kind"`
	Length   float64          `json:"length"`
	StartZ   float64          `json:"startZ"`
	Obstacles []DRObstacleSpec `json:"obstacles"`
	Pickups  []DRPickupSpec   `json:"pickups"`
	Safe     bool             `json:"safe"`
}

type drRng struct {
	r *mrand.Rand
}

func newDRRng(seed uint64) *drRng {
	return &drRng{r: mrand.New(mrand.NewSource(int64(seed)))} //nolint:gosec
}

func (g *drRng) Float64() float64 { return g.r.Float64() }
func (g *drRng) Intn(n int) int {
	if n <= 0 {
		return 0
	}
	return g.r.Intn(n)
}
func (g *drRng) FloatRange(a, b float64) float64 {
	return a + g.Float64()*(b-a)
}

var drTransition = map[string][]string{
	SegStraight:       {SegObstacleEasy, SegJump, SegSpeed, SegObstacleMedium, SegMovingObstacle, SegFallingTiles},
	SegObstacleEasy:   {SegObstacleMedium, SegObstacleEasy, SegJump, SegMovingObstacle, SegFallingTiles},
	SegObstacleMedium: {SegJump, SegObstacleHard, SegMovingObstacle, SegFallingTiles, SegSplitPath, SegObstacleMedium},
	SegObstacleHard:   {SegJump, SegSplitPath, SegFallingTiles, SegMovingObstacle, SegRecovery},
	SegJump:           {SegObstacleEasy, SegObstacleMedium, SegSpeed, SegFallingTiles, SegMovingObstacle},
	SegMovingObstacle: {SegObstacleMedium, SegJump, SegFallingTiles, SegObstacleHard},
	SegFallingTiles:   {SegObstacleMedium, SegJump, SegObstacleEasy, SegMovingObstacle},
	SegSplitPath:      {SegObstacleMedium, SegObstacleEasy, SegJump, SegSpeed},
	SegSpeed:          {SegObstacleEasy, SegJump, SegObstacleMedium, SegFallingTiles},
	SegRecovery:       {SegObstacleEasy, SegJump, SegObstacleMedium, SegMovingObstacle, SegSpeed},
	SegBattleApproach: {SegBattleArena},
	SegBattleArena:    {SegObstacleEasy, SegRecovery},
}

func (h *Hub) drBuildInitialTrack() {
	h.drSegments = nil
	h.drTrackEnd = 0
	h.drLastKind = SegRecovery
	for i := 0; i < DRPreSpawnSegments; i++ {
		kind := SegStraight
		if i == 0 {
			kind = SegRecovery
		} else {
			kind = h.drPickNextKind(false)
		}
		h.drAppendSegment(kind)
	}
}

func (h *Hub) drPickNextKind(forceBattleApproach bool) string {
	if forceBattleApproach {
		return SegBattleApproach
	}
	pool := drTransition[h.drLastKind]
	if len(pool) == 0 {
		pool = []string{SegStraight, SegRecovery}
	}
	_, density, _, _ := drDifficultyTier(h.drLeadDistance())
	// Bias toward harder segments as density rises.
	weighted := make([]string, 0, len(pool)*2)
	for _, k := range pool {
		w := 1
		switch k {
		case SegObstacleHard, SegFallingTiles, SegMovingObstacle:
			if density > 0.5 {
				w = 2
			}
		case SegRecovery, SegStraight:
			if density < 0.4 {
				w = 2
			}
		}
		for i := 0; i < w; i++ {
			weighted = append(weighted, k)
		}
	}
	// Anti-repeat: avoid same kind thrice in a row.
	for tries := 0; tries < 8; tries++ {
		pick := weighted[h.drRng.Intn(len(weighted))]
		if pick != h.drLastKind || h.drRng.Float64() < 0.35 {
			return pick
		}
	}
	return SegStraight
}

func (h *Hub) drLeadDistance() float64 {
	lead := 0.0
	for _, rp := range h.drRunners {
		if rp != nil && rp.Distance > lead {
			lead = rp.Distance
		}
	}
	return lead
}

// Trailing cube distance — despawn must not eat the track out from under anyone.
func (h *Hub) drTrailDistance() float64 {
	trail := -1.0
	for _, rp := range h.drRunners {
		if rp == nil || rp.Lives <= 0 {
			continue
		}
		if trail < 0 || rp.Distance < trail {
			trail = rp.Distance
		}
	}
	if trail < 0 {
		return h.drLeadDistance()
	}
	return trail
}

func (h *Hub) drMaintainTrack() {
	lead := h.drLeadDistance()
	trail := h.drTrailDistance()
	// Spawn ahead of the leader
	for h.drTrackEnd < lead+140 {
		forceBattle := false
		if h.drState == DRBattleApproach || h.drState == DRBattleIntro {
			forceBattle = h.drLastKind != SegBattleApproach && h.drLastKind != SegBattleArena
		}
		kind := h.drPickNextKind(forceBattle)
		if h.drState == DRBattleApproach && h.drLastKind != SegBattleApproach {
			kind = SegBattleApproach
		}
		h.drAppendSegment(kind)
	}
	// Despawn only behind the trailing player (never the leader's view).
	keepBehind := trail - DRDespawnBehind
	if keepBehind < 0 {
		keepBehind = 0
	}
	cut := 0
	for cut < len(h.drSegments) {
		seg := h.drSegments[cut]
		if seg.StartZ+seg.Length >= keepBehind {
			break
		}
		cut++
	}
	if cut > 0 {
		removed := h.drSegments[:cut]
		h.drSegments = h.drSegments[cut:]
		ids := make([]string, len(removed))
		for i, s := range removed {
			ids[i] = s.ID
		}
		h.broadcast(map[string]any{"t": "dr_despawn", "ids": ids})
	}
}

func (h *Hub) drAppendSegment(kind string) *DRSegment {
	lenZ := 24.0 // cells along Z
	safe := false
	switch kind {
	case SegStraight:
		lenZ = 20
	case SegObstacleEasy:
		lenZ = 24
	case SegObstacleMedium:
		lenZ = 28
	case SegObstacleHard:
		lenZ = 30
	case SegJump:
		lenZ = 22
	case SegMovingObstacle:
		lenZ = 26
	case SegFallingTiles:
		lenZ = 24
	case SegSplitPath:
		lenZ = 28
	case SegSpeed:
		lenZ = 32
	case SegRecovery, SegBattleApproach:
		lenZ = 22
		safe = true
	case SegBattleArena:
		lenZ = 16
		safe = true
	}
	// Integer cells only — float StartZ/Length caused client round gaps.
	lenZ = float64(int(lenZ))
	startZ := float64(int(math.Round(h.drTrackEnd)))
	seg := &DRSegment{
		ID:     "seg-" + itoa(len(h.drSegments)) + "-" + kind,
		Kind:   kind,
		Length: lenZ,
		StartZ: startZ,
		Safe:   safe,
	}
	if !safe {
		seg.Obstacles = h.drGenObstacles(kind, seg)
		seg.Pickups = h.drGenPickups(seg)
	}
	// Guarantee at least one clear lane path for static obstacles.
	h.drEnsurePassable(seg)
	h.drSegments = append(h.drSegments, seg)
	h.drTrackEnd = startZ + lenZ
	h.drLastKind = kind
	h.broadcast(map[string]any{"t": "dr_segment", "segment": seg})
	return seg
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [16]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

func (h *Hub) drGenObstacles(kind string, seg *DRSegment) []DRObstacleSpec {
	out := []DRObstacleSpec{}
	n := 3
	switch kind {
	case SegObstacleEasy:
		n = 4
	case SegObstacleMedium:
		n = 5
	case SegObstacleHard:
		n = 6
	case SegJump:
		n = 4
	case SegMovingObstacle, SegFallingTiles:
		n = 4
	case SegSplitPath:
		n = 4
	case SegSpeed:
		n = 3
	case SegStraight:
		n = 2
	default:
		n = 3
	}
	types := obstaclePoolFor(kind)
	spacing := (int(seg.Length) - 6) / (n + 1)
	if spacing < 2 {
		spacing = 2
	}
	used := map[int]bool{} // packed key: (z<<3)|laneBit
	for i := 0; i < n; i++ {
		ot := types[h.drRng.Intn(len(types))]
		lane := 1 << h.drRng.Intn(DRLaneCount)
		// Rare two-lane cover — always leave at least one lane open on that row.
		if h.drRng.Float64() < 0.22 && ot != ObsPit && ot != ObsAbyss && ot != ObsMissingTile {
			lane |= 1 << h.drRng.Intn(DRLaneCount)
			if lane == 7 {
				lane = 3
			}
		}
		z := 3 + (i+1)*spacing
		if z < 3 {
			z = 3
		}
		if z > int(seg.Length)-3 {
			z = int(seg.Length) - 3
		}
		for tries := 0; tries < 8; tries++ {
			conflict := false
			for bit := 1; bit <= 4; bit <<= 1 {
				if lane&bit == 0 {
					continue
				}
				if used[(z<<3)|bit] {
					conflict = true
					break
				}
			}
			if !conflict {
				break
			}
			z += spacing
			if z > int(seg.Length)-3 {
				z = 3 + h.drRng.Intn(max(1, int(seg.Length)-6))
			}
		}
		for bit := 1; bit <= 4; bit <<= 1 {
			if lane&bit != 0 {
				used[(z<<3)|bit] = true
			}
		}
		crit := ot == ObsPit || ot == ObsAbyss || ot == ObsMissingTile || ot == ObsLava || ot == ObsPiranhaWater
		coll := "solid"
		switch ot {
		case ObsLowBarrier, ObsRock, ObsCrate, ObsSpikes, ObsCrumble, ObsMovingPlatform,
			ObsSwingHammer, ObsSpinBeam, ObsMovingBlock, ObsFallingObject:
			coll = "jumpable"
		case ObsHighBarrier:
			coll = "slideable"
		case ObsPit, ObsMissingTile, ObsAbyss:
			coll = "gap"
		case ObsLava, ObsPiranhaWater, ObsElectric:
			coll = "hazard"
		case ObsWall:
			coll = "solid"
		}
		dmg := 1
		if crit {
			dmg = 99
		}
		out = append(out, DRObstacleSpec{
			ID: seg.ID + "-o" + itoa(i), Type: ot, Damage: dmg,
			CollisionType: coll, ActiveDuration: 1.2, Cooldown: 0.8,
			TelegraphTime: 0.45, LaneMask: lane, DifficultyRating: n,
			Z: float64(z), Critical: crit,
		})
	}
	return out
}

func obstaclePoolFor(kind string) []DRObstacleType {
	switch kind {
	case SegObstacleEasy:
		return []DRObstacleType{ObsRock, ObsCrate, ObsLowBarrier, ObsSpikes, ObsMissingTile, ObsCrumble}
	case SegObstacleMedium:
		return []DRObstacleType{ObsWall, ObsHighBarrier, ObsCrate, ObsSpikes, ObsElectric, ObsLowBarrier, ObsPit, ObsRock, ObsSwingHammer}
	case SegObstacleHard:
		return []DRObstacleType{ObsWall, ObsPit, ObsAbyss, ObsLava, ObsHighBarrier, ObsCrumble, ObsElectric, ObsSpinBeam, ObsPiranhaWater, ObsFallingObject, ObsRock, ObsCrate}
	case SegJump:
		return []DRObstacleType{ObsLowBarrier, ObsMissingTile, ObsPit, ObsRock, ObsCrate, ObsSpikes}
	case SegMovingObstacle:
		return []DRObstacleType{ObsSwingHammer, ObsSpinBeam, ObsMovingBlock, ObsFallingObject, ObsHighBarrier, ObsCrate}
	case SegFallingTiles:
		return []DRObstacleType{ObsCrumble, ObsMissingTile, ObsFallingObject, ObsPit, ObsRock}
	case SegSplitPath:
		return []DRObstacleType{ObsWall, ObsRock, ObsCrate, ObsHighBarrier, ObsSpikes, ObsLowBarrier}
	case SegSpeed:
		return []DRObstacleType{ObsLowBarrier, ObsCrate, ObsMovingPlatform, ObsRock, ObsSpikes, ObsMissingTile}
	case SegStraight:
		return []DRObstacleType{ObsRock, ObsCrate, ObsLowBarrier, ObsSpikes}
	default:
		return []DRObstacleType{ObsRock, ObsCrate, ObsLowBarrier, ObsSpikes}
	}
}

func (h *Hub) drGenPickups(seg *DRSegment) []DRPickupSpec {
	if h.drRng.Float64() > 0.35 {
		return nil
	}
	kinds := []string{"shield", "speed_boost", "double_jump", "dash_recharge", "battle_damage", "battle_health"}
	lane := h.drRng.Intn(DRLaneCount)
	z := int(seg.Length * 0.55)
	if z < 2 {
		z = 2
	}
	if z > int(seg.Length)-2 {
		z = int(seg.Length) - 2
	}
	return []DRPickupSpec{{
		ID: seg.ID + "-p0", Kind: kinds[h.drRng.Intn(len(kinds))],
		Z: float64(z), Lane: lane,
	}}
}

func (h *Hub) drEnsurePassable(seg *DRSegment) {
	if seg.Safe || len(seg.Obstacles) == 0 {
		return
	}
	// Per integer Z-row: never block all three lanes.
	byZ := map[int]int{}
	for _, o := range seg.Obstacles {
		zi := int(math.Round(o.Z))
		byZ[zi] |= o.LaneMask
	}
	for zi, mask := range byZ {
		if mask&7 != 7 {
			continue
		}
		for i := range seg.Obstacles {
			if int(math.Round(seg.Obstacles[i].Z)) != zi {
				continue
			}
			seg.Obstacles[i].LaneMask &^= 2 // free center
			if seg.Obstacles[i].LaneMask == 0 {
				seg.Obstacles[i].LaneMask = 1
			}
		}
	}
}

func (h *Hub) drSegmentAt(z float64) *DRSegment {
	for _, s := range h.drSegments {
		if z >= s.StartZ && z < s.StartZ+s.Length {
			return s
		}
	}
	return nil
}

func (h *Hub) drScheduleNextBattle() {
	span := DRNextBattleDistMin + h.drRng.Float64()*(DRNextBattleDistMax-DRNextBattleDistMin)
	lead := h.drLeadDistance()
	h.drNextBattleAt = lead + span
}

func (h *Hub) drCheckBattleTrigger() bool {
	// Solo dev: no mini-battles (need a second cube). Corridor + obstacles only.
	if duelRunSoloDev() && h.drReadyPlayers() < 2 {
		return false
	}
	return h.drLeadDistance() >= h.drNextBattleAt
}

func (h *Hub) drPrepareReturnToRun(_ time.Time) {
	h.drAppendSegment(SegRecovery)
	for _, rp := range h.drRunners {
		if rp == nil {
			continue
		}
		rp.BattleHP = DRBattleHealth
		rp.RunX = 0
		rp.Lane = 1
		rp.LaneF = 1
		rp.Speed += DRSpeedBumpAfterBattle
		if rp.Speed > DRMaxSpeed {
			rp.Speed = DRMaxSpeed
		}
		if len(h.drSegments) > 0 {
			last := h.drSegments[len(h.drSegments)-1]
			rp.RunZ = int(last.StartZ) + 4
			rp.Distance = float64(rp.RunZ)
		}
		if p := h.players[rp.PlayerID]; p != nil {
			p.X, p.Z = rp.RunX, rp.RunZ
		}
	}
}

func (h *Hub) drTrackSnapshot() []map[string]any {
	out := make([]map[string]any, 0, len(h.drSegments))
	for _, s := range h.drSegments {
		out = append(out, map[string]any{
			"id": s.ID, "kind": s.Kind, "length": s.Length, "startZ": s.StartZ,
			"obstacles": s.Obstacles, "pickups": s.Pickups, "safe": s.Safe,
		})
	}
	return out
}
