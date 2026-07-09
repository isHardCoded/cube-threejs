package main

// Orient tracks which die value faces each world direction.
// Bottom = 7-Top, West = 7-East, North = 7-South (opposite faces sum to 7).
// Must match the client's initial mesh: top=1, +x(east)=3, +z(south)=2.
type Orient struct {
	Top   int `json:"top"`
	East  int `json:"east"`
	South int `json:"south"`
}

func StartOrient() Orient { return Orient{Top: 1, East: 3, South: 2} }

// Roll returns the orientation after tipping one cell in (dx, dz).
func (o Orient) Roll(dx, dz int) Orient {
	switch {
	case dx == 1:
		return Orient{Top: 7 - o.East, East: o.Top, South: o.South}
	case dx == -1:
		return Orient{Top: o.East, East: 7 - o.Top, South: o.South}
	case dz == 1:
		return Orient{Top: 7 - o.South, East: o.East, South: o.Top}
	case dz == -1:
		return Orient{Top: o.South, East: o.East, South: 7 - o.Top}
	}
	return o
}

// FaceToward returns the value of the face pointing in direction (dx, dz).
func (o Orient) FaceToward(dx, dz int) int {
	switch {
	case dx == 1:
		return o.East
	case dx == -1:
		return 7 - o.East
	case dz == 1:
		return o.South
	case dz == -1:
		return 7 - o.South
	}
	return o.Top
}
