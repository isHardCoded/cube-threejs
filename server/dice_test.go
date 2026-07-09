package main

import "testing"

func (o Orient) valid() bool {
	// all three visible faces distinct and not opposite pairs
	seen := map[int]bool{}
	for _, v := range []int{o.Top, o.East, o.South} {
		if v < 1 || v > 6 || seen[v] || seen[7-v] {
			return false
		}
		seen[v] = true
	}
	return true
}

func TestRollKeepsOrientationValid(t *testing.T) {
	o := StartOrient()
	dirs := [][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}}
	for i := 0; i < 1000; i++ {
		d := dirs[i%4]
		o = o.Roll(d[0], d[1])
		if !o.valid() {
			t.Fatalf("invalid orientation after %d rolls: %+v", i+1, o)
		}
	}
}

func TestRollRoundTrip(t *testing.T) {
	o := StartOrient()
	for _, d := range [][2]int{{1, 0}, {0, 1}, {-1, 0}, {0, -1}} {
		back := o.Roll(d[0], d[1]).Roll(-d[0], -d[1])
		if back != o {
			t.Fatalf("roll %v then back changed orientation: %+v -> %+v", d, o, back)
		}
	}
}

func TestFourRollsSameDirectionCycle(t *testing.T) {
	o := StartOrient()
	r := o
	for i := 0; i < 4; i++ {
		r = r.Roll(1, 0)
	}
	if r != o {
		t.Fatalf("4 rolls east should return to start: %+v -> %+v", o, r)
	}
}

func TestRollEastMovesTopToEast(t *testing.T) {
	o := StartOrient() // top=1 east=3 south=2
	r := o.Roll(1, 0)
	if r.East != 1 || r.Top != 4 || r.South != 2 {
		t.Fatalf("unexpected orientation after east roll: %+v", r)
	}
}

func TestFaceToward(t *testing.T) {
	o := StartOrient() // top=1 east=3 south=2
	cases := []struct{ dx, dz, want int }{
		{1, 0, 3},  // east face
		{-1, 0, 4}, // west = 7-east
		{0, 1, 2},  // south face
		{0, -1, 5}, // north = 7-south
	}
	for _, c := range cases {
		if got := o.FaceToward(c.dx, c.dz); got != c.want {
			t.Errorf("FaceToward(%d,%d) = %d, want %d", c.dx, c.dz, got, c.want)
		}
	}
}
