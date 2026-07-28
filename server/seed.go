package main

import (
	"context"
	"log"
	"time"
)

// Demo bots for the local leaderboard. Idempotent: insert if missing, else
// refresh cubes so the podium stays interesting after restarts.
var demoPlayers = []struct {
	Username string
	Cubes    int
	SkinID   string
}{
	{"Goldie", 1280, "chrome-yellow"},
	{"SilverFox", 980, "cyan-glass"},
	{"Bronzie", 760, "lava-rock"},
	{"NeonDash", 540, "magenta-neon"},
	{"SandKing", 410, "sand-matte"},
	{"CubeCat", 320, "chrome-yellow"},
	{"PixelHop", 210, "cyan-glass"},
	{"LavaPup", 140, "lava-rock"},
	{"MintRoll", 90, "cyan-glass"},
	{"TinyDie", 40, "sand-matte"},
}

const demoPassword = "demo1234"

// SeedDemoPlayers fills a local DB with ranked fake accounts.
func (s *Store) SeedDemoPlayers() error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	hash, err := hashPassword(demoPassword)
	if err != nil {
		return err
	}

	n := 0
	for _, d := range demoPlayers {
		skin := d.SkinID
		if skin == "" {
			skin = DefaultSkin
		}

		u, findErr := s.UserByUsername(d.Username)
		if findErr == ErrNoUser {
			created, createErr := s.CreateUser(d.Username, hash)
			if createErr != nil {
				log.Println("seed: create", d.Username, createErr)
				continue
			}
			u = created
		} else if findErr != nil {
			log.Println("seed:", d.Username, findErr)
			continue
		}

		if _, err := s.pool.Exec(ctx,
			`UPDATE users SET cubes = $2, skin_id = $3 WHERE id = $1`,
			u.ID, d.Cubes, skin); err != nil {
			log.Println("seed: update", d.Username, err)
			continue
		}
		_ = s.grantAllSkins(ctx, u.ID)
		_ = s.grantAllMineSkins(ctx, u.ID)
		n++
	}
	log.Printf("seed: demo players ready (%d)", n)
	return nil
}
