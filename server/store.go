package main

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Store owns the Postgres pool. Account and currency queries are synchronous
// (see users.go); match statistics are fire-and-forget so a slow database
// never stalls the game loop.
type Store struct {
	pool *pgxpool.Pool
}

const schema = `
CREATE TABLE IF NOT EXISTS users (
	id            BIGSERIAL PRIMARY KEY,
	username      TEXT NOT NULL,
	password_hash TEXT,
	telegram_id   BIGINT UNIQUE,
	cubes         INT NOT NULL DEFAULT 0,
	skin_id       TEXT NOT NULL DEFAULT 'chrome-yellow',
	class_id      TEXT NOT NULL DEFAULT 'universal',
	avatar_url    TEXT,
	avatar_custom BOOLEAN NOT NULL DEFAULT false,
	created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users (lower(username));

ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_custom BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS user_skins (
	user_id  BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
	skin_id  TEXT NOT NULL,
	owned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	PRIMARY KEY (user_id, skin_id)
);

CREATE TABLE IF NOT EXISTS match_wins (
	id      BIGSERIAL PRIMARY KEY,
	user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
	map_id  TEXT NOT NULL,
	cubes   INT NOT NULL,
	at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS match_wins_user_idx ON match_wins (user_id);

CREATE TABLE IF NOT EXISTS sessions (
	id           BIGSERIAL PRIMARY KEY,
	player_id    TEXT,
	started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
	ended_at     TIMESTAMPTZ,
	kills        INT NOT NULL DEFAULT 0,
	deaths       INT NOT NULL DEFAULT 0,
	damage_dealt INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS sessions_player_idx ON sessions (player_id);

-- sessions used to be keyed by an ephemeral connection id; they belong to accounts now
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_id BIGINT;
ALTER TABLE sessions ALTER COLUMN player_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
`

// NewStore fails instead of degrading: accounts and Cubes are meaningless
// without persistence.
func NewStore(dsn string) (*Store, error) {
	if dsn == "" {
		return nil, errors.New("DATABASE_URL is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	if _, err := pool.Exec(ctx, schema); err != nil {
		pool.Close()
		return nil, err
	}
	log.Println("store: connected to Postgres")
	return &Store{pool: pool}, nil
}

func (s *Store) Close() {
	if s.pool != nil {
		s.pool.Close()
	}
}

// exec runs a statistics write in the background; failures are logged only.
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

func (s *Store) SessionStarted(userID int64) {
	s.exec(`INSERT INTO sessions (user_id) VALUES ($1)`, userID)
}

func (s *Store) SessionEnded(userID int64, kills, deaths, damage int) {
	s.exec(`UPDATE sessions SET ended_at = now(), kills = $2, deaths = $3, damage_dealt = $4
	        WHERE id = (SELECT id FROM sessions WHERE user_id = $1 ORDER BY started_at DESC LIMIT 1)`,
		userID, kills, deaths, damage)
}

func (s *Store) Death(userID int64) {
	s.exec(`UPDATE sessions SET deaths = deaths + 1
	        WHERE id = (SELECT id FROM sessions WHERE user_id = $1 ORDER BY started_at DESC LIMIT 1)`,
		userID)
}
