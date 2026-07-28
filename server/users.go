package main

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var (
	ErrNoUser        = errors.New("user not found")
	ErrUsernameTaken = errors.New("username taken")
	ErrNoStore       = errors.New("no database")
)

type User struct {
	ID          int64     `json:"id"`
	Username    string    `json:"username"`
	Cubes       int       `json:"cubes"`
	SkinID      string    `json:"skinId"`
	ClassID     string    `json:"classId"`
	AvatarURL   string    `json:"avatarUrl,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
	ViaTelegram bool      `json:"viaTelegram"`

	passwordHash  string
	avatarCustom  bool
}

const userCols = `id, username, coalesce(password_hash, ''), cubes, skin_id, class_id,
	coalesce(avatar_url, ''), avatar_custom, created_at, (telegram_id IS NOT NULL)`

func scanUser(row pgx.Row) (*User, error) {
	var u User
	err := row.Scan(
		&u.ID, &u.Username, &u.passwordHash, &u.Cubes, &u.SkinID, &u.ClassID,
		&u.AvatarURL, &u.avatarCustom, &u.CreatedAt, &u.ViaTelegram,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoUser
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func dbCtx() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 5*time.Second)
}

func (s *Store) CreateUser(username, passwordHash string) (*User, error) {
	ctx, cancel := dbCtx()
	defer cancel()

	u, err := scanUser(s.pool.QueryRow(ctx,
		`INSERT INTO users (username, password_hash, skin_id) VALUES ($1, $2, $3)
		 RETURNING `+userCols, username, passwordHash, DefaultSkin))
	if isUniqueViolation(err) {
		return nil, ErrUsernameTaken
	}
	if err != nil {
		return nil, err
	}
	if err := s.grantAllSkins(ctx, u.ID); err != nil {
		return nil, err
	}
	return u, nil
}

// Every skin is free during the MVP; paid cosmetics come later.
func (s *Store) grantAllSkins(ctx context.Context, userID int64) error {
	for _, skin := range Skins {
		if _, err := s.pool.Exec(ctx,
			`INSERT INTO user_skins (user_id, skin_id) VALUES ($1, $2)
			 ON CONFLICT DO NOTHING`, userID, skin.ID); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) UserByUsername(username string) (*User, error) {
	ctx, cancel := dbCtx()
	defer cancel()
	return scanUser(s.pool.QueryRow(ctx,
		`SELECT `+userCols+` FROM users WHERE lower(username) = lower($1)`, username))
}

func (s *Store) UserByID(id int64) (*User, error) {
	ctx, cancel := dbCtx()
	defer cancel()
	return scanUser(s.pool.QueryRow(ctx, `SELECT `+userCols+` FROM users WHERE id = $1`, id))
}

// UserByTelegram finds or creates the account bound to a Telegram id.
// photoURL from initData is kept in sync until the user uploads a custom avatar.
func (s *Store) UserByTelegram(telegramID int64, name, photoURL string) (*User, error) {
	ctx, cancel := dbCtx()
	defer cancel()

	u, err := scanUser(s.pool.QueryRow(ctx,
		`SELECT `+userCols+` FROM users WHERE telegram_id = $1`, telegramID))
	if err == nil {
		_ = s.grantAllSkins(ctx, u.ID)
		if photoURL != "" && !u.avatarCustom && u.AvatarURL != photoURL {
			if _, err := s.pool.Exec(ctx,
				`UPDATE users SET avatar_url = $2 WHERE id = $1 AND avatar_custom = false`,
				u.ID, photoURL); err == nil {
				u.AvatarURL = photoURL
			}
		}
		return u, nil
	}
	if !errors.Is(err, ErrNoUser) {
		return nil, err
	}

	// first login from Telegram: claim a free nickname derived from the profile
	for attempt := 0; attempt < 20; attempt++ {
		candidate := name
		if attempt > 0 {
			candidate = uniqueSuffix(name, attempt)
		}
		var avatar any
		if photoURL != "" {
			avatar = photoURL
		}
		u, err := scanUser(s.pool.QueryRow(ctx,
			`INSERT INTO users (username, telegram_id, skin_id, avatar_url) VALUES ($1, $2, $3, $4)
			 RETURNING `+userCols, candidate, telegramID, DefaultSkin, avatar))
		if isUniqueViolation(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if err := s.grantAllSkins(ctx, u.ID); err != nil {
			return nil, err
		}
		return u, nil
	}
	return nil, errors.New("could not allocate a nickname")
}

func (s *Store) SetAvatar(userID int64, avatarURL string) (*User, error) {
	ctx, cancel := dbCtx()
	defer cancel()
	return scanUser(s.pool.QueryRow(ctx,
		`UPDATE users SET avatar_url = $2, avatar_custom = true WHERE id = $1
		 RETURNING `+userCols, userID, avatarURL))
}

func (s *Store) SetSkin(userID int64, skinID string) error {
	ctx, cancel := dbCtx()
	defer cancel()
	tag, err := s.pool.Exec(ctx,
		`UPDATE users SET skin_id = $2 WHERE id = $1
		 AND EXISTS (SELECT 1 FROM user_skins WHERE user_id = $1 AND skin_id = $2)`,
		userID, skinID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("skin not owned")
	}
	return nil
}

func (s *Store) OwnedSkins(userID int64) ([]string, error) {
	ctx, cancel := dbCtx()
	defer cancel()
	rows, err := s.pool.Query(ctx, `SELECT skin_id FROM user_skins WHERE user_id = $1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	owned := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		owned = append(owned, id)
	}
	return owned, rows.Err()
}

// AwardCubes credits a match win and returns the new balance. One transaction
// so a crash can never hand out currency without recording the win.
func (s *Store) AwardCubes(userID int64, mapID string, amount int) (int, error) {
	if s.pool == nil { // tests run the game rules without a database
		return 0, ErrNoStore
	}
	ctx, cancel := dbCtx()
	defer cancel()

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	var balance int
	if err := tx.QueryRow(ctx,
		`UPDATE users SET cubes = cubes + $2 WHERE id = $1 RETURNING cubes`,
		userID, amount).Scan(&balance); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO match_wins (user_id, map_id, cubes) VALUES ($1, $2, $3)`,
		userID, mapID, amount); err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return balance, nil
}
