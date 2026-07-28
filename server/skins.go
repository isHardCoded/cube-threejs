package main

// Skin catalog. The server owns it so every client renders the same cubes;
// the frontend fetches it from GET /api/skins.
type Skin struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Body      string  `json:"body"`
	Pip       string  `json:"pip"`
	Metalness float64 `json:"metalness"`
	Roughness float64 `json:"roughness"`
}

const DefaultSkin = "chrome-yellow"

// Bright matte bodies with dark pips: the arena is cel shaded and deliberately
// low-contrast now, so the cubes are the saturated, readable thing on screen.
// Glossy near-black cubes (the old set) vanished against the tiles.
// IDs are persisted per account, so they never change — only the looks do.
var Skins = []Skin{
	{ID: "chrome-yellow", Name: "Лимон", Body: "#ffcf3f", Pip: "#3c3010", Metalness: 0.1, Roughness: 0.55},
	{ID: "cyan-glass", Name: "Мята", Body: "#54d8e8", Pip: "#0e3a44", Metalness: 0.1, Roughness: 0.55},
	{ID: "magenta-neon", Name: "Малина", Body: "#ff74a6", Pip: "#4a1330", Metalness: 0.1, Roughness: 0.55},
	{ID: "lava-rock", Name: "Лава", Body: "#ff8347", Pip: "#40160a", Metalness: 0.1, Roughness: 0.6},
	{ID: "sand-matte", Name: "Песок", Body: "#f2e2b6", Pip: "#6b4a20", Metalness: 0.05, Roughness: 0.75},
}

func skinExists(id string) bool {
	for _, s := range Skins {
		if s.ID == id {
			return true
		}
	}
	return false
}
