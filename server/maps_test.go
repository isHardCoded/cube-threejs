package main

import "testing"

// Layouts are hand-authored data, and a typo in them is invisible until someone
// spawns inside a wall or a whole corner turns out to be unreachable. These
// checks run over every map so a new one cannot ship broken.

func eachLevel(t *testing.T, f func(t *testing.T, m *GameMap, l int)) {
	t.Helper()
	for _, id := range MapOrder {
		m := GameMaps[id]
		if m == nil {
			t.Fatalf("map %q listed in MapOrder but not defined", id)
		}
		for l := 0; l < Levels; l++ {
			f(t, m, l)
		}
	}
}

func TestObstaclesAreInBoundsAndUnique(t *testing.T) {
	eachLevel(t, func(t *testing.T, m *GameMap, l int) {
		seen := map[[2]int]bool{}
		for _, o := range m.Levels[l].Obstacles {
			if !inBounds(o.X, o.Z) {
				t.Errorf("%s level %d: obstacle out of bounds at (%d,%d)", m.ID, l, o.X, o.Z)
			}
			if o.Kind == "" {
				t.Errorf("%s level %d: obstacle at (%d,%d) has no kind", m.ID, l, o.X, o.Z)
			}
			c := [2]int{o.X, o.Z}
			if seen[c] {
				t.Errorf("%s level %d: two obstacles share cell (%d,%d)", m.ID, l, o.X, o.Z)
			}
			seen[c] = true
		}
	})
}

func TestDecalsNeverSitOnObstacles(t *testing.T) {
	eachLevel(t, func(t *testing.T, m *GameMap, l int) {
		for _, d := range m.Levels[l].Decals {
			if !inBounds(d[0], d[1]) {
				t.Errorf("%s level %d: decal out of bounds at (%d,%d)", m.ID, l, d[0], d[1])
			}
			if m.blocked[l][[2]int{d[0], d[1]}] {
				t.Errorf("%s level %d: decal at (%d,%d) is hidden under an obstacle", m.ID, l, d[0], d[1])
			}
		}
	})
}

// startCrumble looks for the trampoline in the central 3x3 only. If a layout
// filled that block, the level would have no way out and everyone would die.
func TestTrampolineHasSomewhereToSpawn(t *testing.T) {
	eachLevel(t, func(t *testing.T, m *GameMap, l int) {
		if l == Levels-1 {
			return // last level has no trampoline by design
		}
		free := 0
		for x := -1; x <= 1; x++ {
			for z := -1; z <= 1; z++ {
				if !m.blocked[l][[2]int{x, z}] {
					free++
				}
			}
		}
		if free < 4 {
			t.Errorf("%s level %d: only %d free cells in the central 3x3, the trampoline needs room", m.ID, l, free)
		}
	})
}

// A cube can only roll orthogonally, so every walkable cell has to be reachable
// from every other one: a sealed-off pocket is a spawn that cannot fight.
func TestEveryWalkableCellIsReachable(t *testing.T) {
	eachLevel(t, func(t *testing.T, m *GameMap, l int) {
		walkable := func(x, z int) bool {
			return inBounds(x, z) && !m.blocked[l][[2]int{x, z}]
		}

		var start [2]int
		total := 0
		for x := -Half; x <= Half; x++ {
			for z := -Half; z <= Half; z++ {
				if walkable(x, z) {
					if total == 0 {
						start = [2]int{x, z}
					}
					total++
				}
			}
		}

		seen := map[[2]int]bool{start: true}
		queue := [][2]int{start}
		for len(queue) > 0 {
			c := queue[0]
			queue = queue[1:]
			for _, d := range [][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
				n := [2]int{c[0] + d[0], c[1] + d[1]}
				if walkable(n[0], n[1]) && !seen[n] {
					seen[n] = true
					queue = append(queue, n)
				}
			}
		}
		if len(seen) != total {
			t.Errorf("%s level %d: %d of %d walkable cells are cut off", m.ID, l, total-len(seen), total)
		}
	})
}
