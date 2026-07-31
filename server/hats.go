package main

// Hat cosmetics catalog. Geometry is built on the client in Three.js;
// the server only stores ids so every peer renders the same accessory.
type Hat struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Swatch string `json:"swatch"`
	Emoji  string `json:"emoji"`
}

const DefaultHat = "none"

var Hats = []Hat{
	{ID: "none", Name: "Без шапки", Swatch: "#9aa3ad", Emoji: "⬜"},
	{ID: "santa", Name: "Санта", Swatch: "#e22b2b", Emoji: "🎅"},
	{ID: "cowboy", Name: "Ковбой", Swatch: "#8b5a2b", Emoji: "🤠"},
	{ID: "wizard", Name: "Волшебник", Swatch: "#5b3fd4", Emoji: "🧙"},
	{ID: "crown", Name: "Корона", Swatch: "#f0c14a", Emoji: "👑"},
	{ID: "hardhat", Name: "Каска", Swatch: "#f5c518", Emoji: "⛑️"},
}

func hatExists(id string) bool {
	for _, h := range Hats {
		if h.ID == id {
			return true
		}
	}
	return false
}
