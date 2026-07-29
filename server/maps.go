package main

// Map layouts live here and nowhere else. The client used to keep its own copy
// of the obstacle cells, which is exactly how a platform ends up walkable on
// one side and solid on the other; now the server ships the layout in `welcome`
// and the client only decides how each kind is drawn.
//
// Kinds are visual hints. Gameplay-wise every obstacle blocks its cell, so a
// kind the client does not know still plays correctly — it just draws a generic
// prop. That is why each map has its own vocabulary instead of one shared set.
const (
	// cyberpunk
	KindPylon   = "pylon"
	KindCrate   = "crate"
	KindBarrel  = "barrel"
	KindColumn  = "column"
	KindAntenna = "antenna"

	// lava
	KindSpire   = "spire"
	KindBoulder = "boulder"
	KindVent    = "vent"
	KindBasalt  = "basalt"

	// desert
	KindCactus = "cactus"
	KindPalm   = "palm"
	KindRock   = "rock"
	KindRuin   = "ruin"

	// kawaii
	KindBow   = "bow"
	KindGift  = "gift"
	KindHeart = "heart"
	KindCloud = "cloud"

	// jungle
	KindTree  = "tree"
	KindVine  = "vine"
	KindStump = "stump"
	KindFern  = "fern"

	// ocean (underwater)
	KindCoral   = "coral"
	KindKelp    = "kelp"
	KindSeRock  = "serock"
	KindAnemone = "anemone"
)

type Obstacle struct {
	X    int    `json:"x"`
	Z    int    `json:"z"`
	Kind string `json:"kind"`
}

type LevelLayout struct {
	Obstacles []Obstacle `json:"obstacles"`
	Decals    [][2]int   `json:"decals"` // cosmetic floor marks, never block
}

type GameMap struct {
	ID      string              `json:"id"`
	Levels  [Levels]LevelLayout `json:"levels"`
	blocked [Levels]map[[2]int]bool
}

// MapOrder keeps hub creation and logging deterministic.
var MapOrder = []string{"cyberpunk", "lava", "desert", "kawaii", "jungle", "ocean"}

const DefaultMapID = "cyberpunk"

func obs(kind string, cells ...[2]int) []Obstacle {
	out := make([]Obstacle, 0, len(cells))
	for _, c := range cells {
		out = append(out, Obstacle{X: c[0], Z: c[1], Kind: kind})
	}
	return out
}

func join(groups ...[]Obstacle) []Obstacle {
	var out []Obstacle
	for _, g := range groups {
		out = append(out, g...)
	}
	return out
}

var GameMaps = map[string]*GameMap{
	"cyberpunk": {
		ID: "cyberpunk",
		Levels: [Levels]LevelLayout{
			{ // level 0: the junkyard arena
				Obstacles: join(
					obs(KindPylon, [2]int{-4, 0}, [2]int{-4, 2}, [2]int{4, -2}, [2]int{2, -4}, [2]int{-2, 4}, [2]int{4, 3}),
					obs(KindCrate, [2]int{0, -4}, [2]int{4, 1}, [2]int{-3, 4}, [2]int{-4, -2}),
					obs(KindBarrel, [2]int{2, 2}),
					obs(KindColumn, [2]int{-2, -2}),
					obs(KindAntenna, [2]int{0, 3}),
				),
				Decals: [][2]int{{3, -1}, {-1, 2}, {1, -2}},
			},
			{ // level 1: tighter maze around the middle
				Obstacles: join(
					obs(KindPylon, [2]int{3, 3}, [2]int{-3, -3}, [2]int{0, -3}, [2]int{3, 0}),
					obs(KindCrate, [2]int{-1, -1}, [2]int{1, 3}, [2]int{-3, 1}),
					obs(KindBarrel, [2]int{-1, 2}, [2]int{2, -2}),
					obs(KindColumn, [2]int{2, 0}),
					obs(KindAntenna, [2]int{-3, -1}),
				),
				Decals: [][2]int{{0, 2}, {-2, 0}, {2, -3}},
			},
			{ // level 2: sparse rooftop with a central obelisk, no trampoline here
				Obstacles: join(
					obs(KindPylon, [2]int{0, 0}, [2]int{2, 3}, [2]int{-2, -3}),
					obs(KindCrate, [2]int{3, -3}, [2]int{-3, 3}),
					obs(KindBarrel, [2]int{1, -1}),
					obs(KindColumn, [2]int{-1, 1}),
				),
				Decals: [][2]int{{2, 0}, {-2, 2}, {0, -2}},
			},
		},
	},

	// The trampoline can only appear on a free cell of the central 3x3, so every
	// level below keeps that block clear except for a deliberate centre landmark.
	"lava": {
		ID: "lava",
		Levels: [Levels]LevelLayout{
			{ // level 0: open magma field with basalt clusters in the corners
				Obstacles: join(
					obs(KindBasalt, [2]int{-3, -3}, [2]int{3, 3}, [2]int{-3, 3}, [2]int{3, -3}),
					obs(KindBoulder, [2]int{-2, -1}, [2]int{2, 1}, [2]int{1, -3}, [2]int{-1, 3}),
					obs(KindVent, [2]int{0, -2}, [2]int{0, 2}, [2]int{-4, 1}, [2]int{4, -1}),
					obs(KindSpire, [2]int{-4, -4}, [2]int{4, 4}),
				),
				Decals: [][2]int{{2, -2}, {-2, 2}, {0, 4}},
			},
			{ // level 1: diagonal corridors around a central obsidian spire
				Obstacles: join(
					obs(KindSpire, [2]int{0, 0}),
					obs(KindBasalt, [2]int{-2, -2}, [2]int{2, 2}, [2]int{-2, 2}, [2]int{2, -2}),
					obs(KindBoulder, [2]int{-4, 0}, [2]int{4, 0}, [2]int{0, -4}, [2]int{0, 4}),
					obs(KindVent, [2]int{-3, 1}, [2]int{3, -1}, [2]int{1, 3}, [2]int{-1, -3}),
				),
				Decals: [][2]int{{2, 0}, {-2, 0}, {0, 2}},
			},
			{ // level 2: narrow final ledge, no trampoline out of here
				Obstacles: join(
					obs(KindSpire, [2]int{0, 3}, [2]int{0, -3}),
					obs(KindBasalt, [2]int{-3, 0}, [2]int{3, 0}),
					obs(KindBoulder, [2]int{-2, 2}, [2]int{2, -2}, [2]int{2, 2}, [2]int{-2, -2}),
					obs(KindVent, [2]int{0, 0}, [2]int{-4, -4}, [2]int{4, 4}),
				),
				Decals: [][2]int{{1, 1}, {-1, -1}, {4, -4}},
			},
		},
	},

	"desert": {
		ID: "desert",
		Levels: [Levels]LevelLayout{
			{ // level 0: palms in the corners, cacti guarding the lanes
				Obstacles: join(
					obs(KindPalm, [2]int{-4, -4}, [2]int{4, 4}, [2]int{-4, 4}, [2]int{4, -4}),
					obs(KindCactus, [2]int{-2, 0}, [2]int{2, 0}, [2]int{0, -3}, [2]int{0, 3}),
					obs(KindRock, [2]int{-3, 2}, [2]int{3, -2}, [2]int{3, 2}, [2]int{-3, -2}),
					obs(KindRuin, [2]int{2, 3}, [2]int{-2, -3}),
				),
				Decals: [][2]int{{1, 1}, {-1, -1}, {0, 4}},
			},
			{ // level 1: staggered ruins around one giant saguaro
				Obstacles: join(
					obs(KindCactus, [2]int{0, 0}),
					obs(KindRuin, [2]int{-3, -1}, [2]int{3, 1}, [2]int{-1, 3}, [2]int{1, -3}),
					obs(KindRock, [2]int{-2, 2}, [2]int{2, -2}, [2]int{4, -4}, [2]int{-4, 4}),
					obs(KindPalm, [2]int{-4, -1}, [2]int{4, 1}),
				),
				Decals: [][2]int{{0, -2}, {2, 2}, {-2, -2}},
			},
			{ // level 2: symmetric ruin arena, everyone falls from here anyway
				Obstacles: join(
					obs(KindRuin, [2]int{2, 2}, [2]int{-2, -2}, [2]int{2, -2}, [2]int{-2, 2}),
					obs(KindCactus, [2]int{0, 4}, [2]int{0, -4}, [2]int{4, 0}, [2]int{-4, 0}),
					obs(KindRock, [2]int{1, 1}, [2]int{-1, -1}),
					obs(KindPalm, [2]int{3, -3}, [2]int{-3, 3}),
				),
				Decals: [][2]int{{0, 0}, {3, 3}, {-3, -3}},
			},
		},
	},

	"kawaii": {
		ID: "kawaii",
		Levels: [Levels]LevelLayout{
			{ // level 0: gifts in the corners, bows along the lanes; centre free for trampoline
				Obstacles: join(
					obs(KindGift, [2]int{-4, -4}, [2]int{4, 4}, [2]int{-4, 4}, [2]int{4, -4}),
					obs(KindBow, [2]int{-2, 0}, [2]int{2, 0}, [2]int{0, -3}, [2]int{0, 3}),
					obs(KindHeart, [2]int{-3, 2}, [2]int{3, -2}, [2]int{3, 2}, [2]int{-3, -2}),
					obs(KindCloud, [2]int{2, 3}, [2]int{-2, -3}),
				),
				Decals: [][2]int{{1, 1}, {-1, -1}, {0, 4}},
			},
			{ // level 1: big bow at centre, gifts and hearts around
				Obstacles: join(
					obs(KindBow, [2]int{0, 0}),
					obs(KindGift, [2]int{-3, -1}, [2]int{3, 1}, [2]int{-1, 3}, [2]int{1, -3}),
					obs(KindHeart, [2]int{-2, 2}, [2]int{2, -2}, [2]int{4, -4}, [2]int{-4, 4}),
					obs(KindCloud, [2]int{-4, -1}, [2]int{4, 1}),
				),
				Decals: [][2]int{{0, -2}, {2, 2}, {-2, -2}},
			},
			{ // level 2: heart bouquet arena, no trampoline out of here
				Obstacles: join(
					obs(KindHeart, [2]int{2, 2}, [2]int{-2, -2}, [2]int{2, -2}, [2]int{-2, 2}),
					obs(KindBow, [2]int{0, 4}, [2]int{0, -4}, [2]int{4, 0}, [2]int{-4, 0}),
					obs(KindGift, [2]int{1, 1}, [2]int{-1, -1}),
					obs(KindCloud, [2]int{3, -3}, [2]int{-3, 3}),
				),
				Decals: [][2]int{{0, 0}, {3, 3}, {-3, -3}},
			},
		},
	},

	"jungle": {
		ID: "jungle",
		Levels: [Levels]LevelLayout{
			{
				Obstacles: join(
					obs(KindTree, [2]int{-4, -4}, [2]int{4, 4}, [2]int{-4, 4}, [2]int{4, -4}),
					obs(KindVine, [2]int{-2, 0}, [2]int{2, 0}, [2]int{0, -3}, [2]int{0, 3}),
					obs(KindStump, [2]int{-3, 2}, [2]int{3, -2}, [2]int{3, 2}, [2]int{-3, -2}),
					obs(KindFern, [2]int{2, 3}, [2]int{-2, -3}),
				),
				Decals: [][2]int{{1, 1}, {-1, -1}, {0, 4}},
			},
			{
				Obstacles: join(
					obs(KindTree, [2]int{0, 0}),
					obs(KindFern, [2]int{-3, -1}, [2]int{3, 1}, [2]int{-1, 3}, [2]int{1, -3}),
					obs(KindStump, [2]int{-2, 2}, [2]int{2, -2}, [2]int{4, -4}, [2]int{-4, 4}),
					obs(KindVine, [2]int{-4, -1}, [2]int{4, 1}),
				),
				Decals: [][2]int{{0, -2}, {2, 2}, {-2, -2}},
			},
			{
				Obstacles: join(
					obs(KindStump, [2]int{2, 2}, [2]int{-2, -2}, [2]int{2, -2}, [2]int{-2, 2}),
					obs(KindTree, [2]int{0, 4}, [2]int{0, -4}, [2]int{4, 0}, [2]int{-4, 0}),
					obs(KindFern, [2]int{1, 1}, [2]int{-1, -1}),
					obs(KindVine, [2]int{3, -3}, [2]int{-3, 3}),
				),
				Decals: [][2]int{{0, 0}, {3, 3}, {-3, -3}},
			},
		},
	},

	"ocean": {
		ID: "ocean",
		Levels: [Levels]LevelLayout{
			{
				Obstacles: join(
					obs(KindCoral, [2]int{-4, -4}, [2]int{4, 4}, [2]int{-4, 4}, [2]int{4, -4}),
					obs(KindKelp, [2]int{-2, 0}, [2]int{2, 0}, [2]int{0, -3}, [2]int{0, 3}),
					obs(KindSeRock, [2]int{-3, 2}, [2]int{3, -2}, [2]int{3, 2}, [2]int{-3, -2}),
					obs(KindAnemone, [2]int{2, 3}, [2]int{-2, -3}),
				),
				Decals: [][2]int{{1, 1}, {-1, -1}, {0, 4}},
			},
			{
				Obstacles: join(
					obs(KindCoral, [2]int{0, 0}),
					obs(KindAnemone, [2]int{-3, -1}, [2]int{3, 1}, [2]int{-1, 3}, [2]int{1, -3}),
					obs(KindSeRock, [2]int{-2, 2}, [2]int{2, -2}, [2]int{4, -4}, [2]int{-4, 4}),
					obs(KindKelp, [2]int{-4, -1}, [2]int{4, 1}),
				),
				Decals: [][2]int{{0, -2}, {2, 2}, {-2, -2}},
			},
			{
				Obstacles: join(
					obs(KindAnemone, [2]int{2, 2}, [2]int{-2, -2}, [2]int{2, -2}, [2]int{-2, 2}),
					obs(KindCoral, [2]int{0, 4}, [2]int{0, -4}, [2]int{4, 0}, [2]int{-4, 0}),
					obs(KindSeRock, [2]int{1, 1}, [2]int{-1, -1}),
					obs(KindKelp, [2]int{3, -3}, [2]int{-3, 3}),
				),
				Decals: [][2]int{{0, 0}, {3, 3}, {-3, -3}},
			},
		},
	},
}

func init() {
	for _, m := range GameMaps {
		for l := 0; l < Levels; l++ {
			m.blocked[l] = make(map[[2]int]bool, len(m.Levels[l].Obstacles))
			for _, o := range m.Levels[l].Obstacles {
				m.blocked[l][[2]int{o.X, o.Z}] = true
			}
		}
	}
}

// MapByID falls back to the default map so a stale or hand-edited query
// parameter cannot keep a player out of the game.
func MapByID(id string) *GameMap {
	if m, ok := GameMaps[id]; ok {
		return m
	}
	return GameMaps[DefaultMapID]
}

// MapExists is the strict answer MapByID deliberately does not give, for callers
// like matchmaking where a silent fallback would pick a map for the players.
func MapExists(id string) bool {
	_, ok := GameMaps[id]
	return ok
}
