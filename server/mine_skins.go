package main

// Mine cosmetics. Only the placer sees their own mines, so this is purely a
// local look — but the catalog still lives on the server so every client
// agrees on which ids exist.
type MineSkin struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Swatch string `json:"swatch"`
	Emoji  string `json:"emoji"`
}

const DefaultMineSkin = "classic"

var MineSkins = []MineSkin{
	{ID: "classic", Name: "Классика", Swatch: "#4a3a3a", Emoji: "💣"},
	{ID: "poop", Name: "Какашка", Swatch: "#8b5a2b", Emoji: "💩"},
}

func mineSkinExists(id string) bool {
	for _, s := range MineSkins {
		if s.ID == id {
			return true
		}
	}
	return false
}
