package main

import (
	"context"
	"errors"
	"strings"
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
	ID          int64      `json:"id"`
	Username    string     `json:"username"`
	Cubes       int        `json:"cubes"`
	SkinID      string     `json:"skinId"`
	MineSkinID  string     `json:"mineSkinId"`
	HatID       string     `json:"hatId"`
	ClassID     string     `json:"classId"`
	AvatarURL   string     `json:"avatarUrl,omitempty"`
	CreatedAt   time.Time  `json:"createdAt"`
	ViaTelegram bool       `json:"viaTelegram"`
	IsAdmin     bool       `json:"isAdmin"`
	BannedAt    *time.Time `json:"bannedAt,omitempty"`
	BanReason   string     `json:"banReason,omitempty"`

	passwordHash string
	avatarCustom bool
}

const userCols = `id, username, coalesce(password_hash, ''), cubes, skin_id,
	coalesce(nullif(mine_skin_id, ''), 'classic'),
	coalesce(nullif(hat_id, ''), 'none'), class_id,
	coalesce(avatar_url, ''), avatar_custom, created_at, (telegram_id IS NOT NULL),
	coalesce(is_admin, false), banned_at, coalesce(ban_reason, '')`

func scanUser(row pgx.Row) (*User, error) {
	var u User
	err := row.Scan(
		&u.ID, &u.Username, &u.passwordHash, &u.Cubes, &u.SkinID, &u.MineSkinID, &u.HatID, &u.ClassID,
		&u.AvatarURL, &u.avatarCustom, &u.CreatedAt, &u.ViaTelegram,
		&u.IsAdmin, &u.BannedAt, &u.BanReason,
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
	if err := s.grantAllMineSkins(ctx, u.ID); err != nil {
		return nil, err
	}
	if err := s.grantAllHats(ctx, u.ID); err != nil {
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

func (s *Store) grantAllMineSkins(ctx context.Context, userID int64) error {
	for _, skin := range MineSkins {
		if _, err := s.pool.Exec(ctx,
			`INSERT INTO user_mine_skins (user_id, mine_skin_id) VALUES ($1, $2)
			 ON CONFLICT DO NOTHING`, userID, skin.ID); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) grantAllHats(ctx context.Context, userID int64) error {
	for _, hat := range Hats {
		if _, err := s.pool.Exec(ctx,
			`INSERT INTO user_hats (user_id, hat_id) VALUES ($1, $2)
			 ON CONFLICT DO NOTHING`, userID, hat.ID); err != nil {
			return err
		}
	}
	return nil
}

// EnsureMineSkins backfills cosmetics for accounts created before mine skins existed.
func (s *Store) EnsureMineSkins(userID int64) {
	ctx, cancel := dbCtx()
	defer cancel()
	_ = s.grantAllMineSkins(ctx, userID)
	// Drop retired cosmetics so equipped id stays valid.
	_, _ = s.pool.Exec(ctx,
		`UPDATE users SET mine_skin_id = $2
		 WHERE id = $1 AND mine_skin_id = 'banana'`, userID, DefaultMineSkin)
	_, _ = s.pool.Exec(ctx,
		`DELETE FROM user_mine_skins WHERE user_id = $1 AND mine_skin_id = 'banana'`, userID)
}

// EnsureHats backfills hat cosmetics for accounts created before hats existed.
func (s *Store) EnsureHats(userID int64) {
	ctx, cancel := dbCtx()
	defer cancel()
	_ = s.grantAllHats(ctx, userID)
	_, _ = s.pool.Exec(ctx,
		`UPDATE users SET hat_id = $2
		 WHERE id = $1 AND (hat_id IS NULL OR hat_id = '')`, userID, DefaultHat)
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

// UsersPublicByIDs returns id/username/avatar for the given accounts (any order).
func (s *Store) UsersPublicByIDs(ids []int64) ([]OnlineUser, error) {
	if len(ids) == 0 {
		return []OnlineUser{}, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	rows, err := s.pool.Query(ctx, `
		SELECT id, username, coalesce(avatar_url, '')
		FROM users
		WHERE id = ANY($1)`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]OnlineUser, 0, len(ids))
	for rows.Next() {
		var u OnlineUser
		if err := rows.Scan(&u.ID, &u.Username, &u.AvatarURL); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
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
		_ = s.grantAllMineSkins(ctx, u.ID)
		_ = s.grantAllHats(ctx, u.ID)
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
		if err := s.grantAllMineSkins(ctx, u.ID); err != nil {
			return nil, err
		}
		if err := s.grantAllHats(ctx, u.ID); err != nil {
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

func (s *Store) SetMineSkin(userID int64, skinID string) error {
	ctx, cancel := dbCtx()
	defer cancel()
	tag, err := s.pool.Exec(ctx,
		`UPDATE users SET mine_skin_id = $2 WHERE id = $1
		 AND EXISTS (SELECT 1 FROM user_mine_skins WHERE user_id = $1 AND mine_skin_id = $2)`,
		userID, skinID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("mine skin not owned")
	}
	return nil
}

func (s *Store) SetHat(userID int64, hatID string) error {
	ctx, cancel := dbCtx()
	defer cancel()
	tag, err := s.pool.Exec(ctx,
		`UPDATE users SET hat_id = $2 WHERE id = $1
		 AND EXISTS (SELECT 1 FROM user_hats WHERE user_id = $1 AND hat_id = $2)`,
		userID, hatID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("hat not owned")
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

func (s *Store) OwnedMineSkins(userID int64) ([]string, error) {
	ctx, cancel := dbCtx()
	defer cancel()
	rows, err := s.pool.Query(ctx, `SELECT mine_skin_id FROM user_mine_skins WHERE user_id = $1`, userID)
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

func (s *Store) OwnedHats(userID int64) ([]string, error) {
	ctx, cancel := dbCtx()
	defer cancel()
	rows, err := s.pool.Query(ctx, `SELECT hat_id FROM user_hats WHERE user_id = $1`, userID)
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

// GrantCubes adds currency without a match_wins row — quests and other
// non-match sources use this so the rating ledger stays about wins only.
func (s *Store) GrantCubes(userID int64, amount int) (int, error) {
	if s.pool == nil {
		return 0, ErrNoStore
	}
	if amount <= 0 {
		u, err := s.UserByID(userID)
		if err != nil {
			return 0, err
		}
		return u.Cubes, nil
	}
	ctx, cancel := dbCtx()
	defer cancel()
	var balance int
	err := s.pool.QueryRow(ctx,
		`UPDATE users SET cubes = cubes + $2 WHERE id = $1 RETURNING cubes`,
		userID, amount).Scan(&balance)
	return balance, err
}

// SyncAdminUsernames marks listed usernames as admin (case-insensitive).
// Existing admins not in the list are left alone so DB grants survive.
func (s *Store) SyncAdminUsernames(names []string) error {
	if s.pool == nil || len(names) == 0 {
		return nil
	}
	ctx, cancel := dbCtx()
	defer cancel()
	for _, raw := range names {
		name := strings.TrimSpace(raw)
		if name == "" {
			continue
		}
		if _, err := s.pool.Exec(ctx,
			`UPDATE users SET is_admin = true WHERE lower(username) = lower($1)`, name); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) IsBanned(u *User) bool {
	return u != nil && u.BannedAt != nil
}

// AdminListUsers returns a page of accounts for the admin panel.
func (s *Store) AdminListUsers(q string, limit, offset int) ([]User, int, error) {
	if s.pool == nil {
		return nil, 0, ErrNoStore
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	ctx, cancel := dbCtx()
	defer cancel()

	q = strings.TrimSpace(q)
	var total int
	var rows pgx.Rows
	var err error
	if q == "" {
		err = s.pool.QueryRow(ctx, `SELECT count(*) FROM users`).Scan(&total)
		if err != nil {
			return nil, 0, err
		}
		rows, err = s.pool.Query(ctx,
			`SELECT `+userCols+` FROM users ORDER BY id DESC LIMIT $1 OFFSET $2`, limit, offset)
	} else {
		like := "%" + strings.ToLower(q) + "%"
		err = s.pool.QueryRow(ctx,
			`SELECT count(*) FROM users WHERE lower(username) LIKE $1`, like).Scan(&total)
		if err != nil {
			return nil, 0, err
		}
		rows, err = s.pool.Query(ctx,
			`SELECT `+userCols+` FROM users WHERE lower(username) LIKE $1
			 ORDER BY id DESC LIMIT $2 OFFSET $3`, like, limit, offset)
	}
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := make([]User, 0, limit)
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *u)
	}
	return out, total, rows.Err()
}

type UserStats struct {
	Kills   int `json:"kills"`
	Deaths  int `json:"deaths"`
	Damage  int `json:"damage"`
	Wins    int `json:"wins"`
	Sessions int `json:"sessions"`
}

func (s *Store) UserStats(userID int64) (UserStats, error) {
	var st UserStats
	if s.pool == nil {
		return st, ErrNoStore
	}
	ctx, cancel := dbCtx()
	defer cancel()
	err := s.pool.QueryRow(ctx, `
		SELECT
			coalesce(sum(kills), 0),
			coalesce(sum(deaths), 0),
			coalesce(sum(damage_dealt), 0),
			count(*)
		FROM sessions WHERE user_id = $1`, userID).Scan(&st.Kills, &st.Deaths, &st.Damage, &st.Sessions)
	if err != nil {
		return st, err
	}
	err = s.pool.QueryRow(ctx,
		`SELECT count(*) FROM match_wins WHERE user_id = $1`, userID).Scan(&st.Wins)
	return st, err
}

type AdminUserPatch struct {
	Username *string `json:"username"`
	Cubes    *int    `json:"cubes"`
	SkinID   *string `json:"skinId"`
	HatID    *string `json:"hatId"`
	ClassID  *string `json:"classId"`
	IsAdmin  *bool   `json:"isAdmin"`
}

func (s *Store) AdminPatchUser(userID int64, patch AdminUserPatch) (*User, error) {
	if s.pool == nil {
		return nil, ErrNoStore
	}
	u, err := s.UserByID(userID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := dbCtx()
	defer cancel()

	if patch.Username != nil {
		name, err := validateNickname(*patch.Username)
		if err != nil {
			return nil, err
		}
		_, err = s.pool.Exec(ctx, `UPDATE users SET username = $2 WHERE id = $1`, userID, name)
		if isUniqueViolation(err) {
			return nil, ErrUsernameTaken
		}
		if err != nil {
			return nil, err
		}
		u.Username = name
	}
	if patch.Cubes != nil {
		cubes := *patch.Cubes
		if cubes < 0 {
			cubes = 0
		}
		if _, err := s.pool.Exec(ctx, `UPDATE users SET cubes = $2 WHERE id = $1`, userID, cubes); err != nil {
			return nil, err
		}
	}
	if patch.SkinID != nil && *patch.SkinID != "" {
		if _, err := s.pool.Exec(ctx, `UPDATE users SET skin_id = $2 WHERE id = $1`, userID, *patch.SkinID); err != nil {
			return nil, err
		}
	}
	if patch.HatID != nil && *patch.HatID != "" {
		if _, err := s.pool.Exec(ctx, `UPDATE users SET hat_id = $2 WHERE id = $1`, userID, *patch.HatID); err != nil {
			return nil, err
		}
	}
	if patch.ClassID != nil && *patch.ClassID != "" {
		if _, err := s.pool.Exec(ctx, `UPDATE users SET class_id = $2 WHERE id = $1`, userID, *patch.ClassID); err != nil {
			return nil, err
		}
	}
	if patch.IsAdmin != nil {
		if _, err := s.pool.Exec(ctx, `UPDATE users SET is_admin = $2 WHERE id = $1`, userID, *patch.IsAdmin); err != nil {
			return nil, err
		}
	}
	return s.UserByID(userID)
}

func (s *Store) BanUser(userID int64, reason string) (*User, error) {
	if s.pool == nil {
		return nil, ErrNoStore
	}
	ctx, cancel := dbCtx()
	defer cancel()
	reason = strings.TrimSpace(reason)
	return scanUser(s.pool.QueryRow(ctx,
		`UPDATE users SET banned_at = now(), ban_reason = $2 WHERE id = $1
		 RETURNING `+userCols, userID, reason))
}

func (s *Store) UnbanUser(userID int64) (*User, error) {
	if s.pool == nil {
		return nil, ErrNoStore
	}
	ctx, cancel := dbCtx()
	defer cancel()
	return scanUser(s.pool.QueryRow(ctx,
		`UPDATE users SET banned_at = NULL, ban_reason = NULL WHERE id = $1
		 RETURNING `+userCols, userID))
}

// ListTelegramIDs returns chat ids for bot broadcast.
func (s *Store) ListTelegramIDs() ([]int64, error) {
	if s.pool == nil {
		return nil, ErrNoStore
	}
	ctx, cancel := dbCtx()
	defer cancel()
	rows, err := s.pool.Query(ctx, `
		SELECT telegram_id FROM users
		WHERE telegram_id IS NOT NULL AND banned_at IS NULL`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
