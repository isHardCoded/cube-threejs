package main

import (
	"context"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Store persists sessions and combat stats. All writes are fire-and-forget:
// the game must keep running even if Postgres is down.
type Store struct {
	pool *pgxpool.Pool
}

const schema = `
CREATE TABLE IF NOT EXISTS sessions (
	id           BIGSERIAL PRIMARY KEY,
	player_id    TEXT NOT NULL,
	started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
	ended_at     TIMESTAMPTZ,
	kills        INT NOT NULL DEFAULT 0,
	deaths       INT NOT NULL DEFAULT 0,
	damage_dealt INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS sessions_player_idx ON sessions (player_id);
`

func NewStore(dsn string) *Store {
	if dsn == "" {
		log.Println("store: no DATABASE_URL, stats persistence disabled")
		return &Store{}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		log.Println("store: connect failed, persistence disabled:", err)
		return &Store{}
	}
	if _, err := pool.Exec(ctx, schema); err != nil {
		log.Println("store: migration failed, persistence disabled:", err)
		pool.Close()
		return &Store{}
	}
	log.Println("store: connected to Postgres")
	return &Store{pool: pool}
}

func (s *Store) exec(sql string, args ...any) {
	if s.pool == nil {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := s.pool.Exec(ctx, sql, args...); err != nil {
			log.Println("store:", err)
		}
	}()
}

func (s *Store) SessionStarted(playerID string) {
	s.exec(`INSERT INTO sessions (player_id) VALUES ($1)`, playerID)
}

func (s *Store) SessionEnded(playerID string, kills, deaths, damage int) {
	s.exec(`UPDATE sessions SET ended_at = now(), kills = $2, deaths = $3, damage_dealt = $4
	        WHERE id = (SELECT id FROM sessions WHERE player_id = $1 ORDER BY started_at DESC LIMIT 1)`,
		playerID, kills, deaths, damage)
}

func (s *Store) Death(playerID string) {
	s.exec(`UPDATE sessions SET deaths = deaths + 1
	        WHERE id = (SELECT id FROM sessions WHERE player_id = $1 ORDER BY started_at DESC LIMIT 1)`,
		playerID)
}
