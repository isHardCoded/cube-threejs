package main

import (
	"context"
	"errors"
	"strings"
	"time"
)

var (
	ErrAlreadyFriends   = errors.New("уже в друзьях")
	ErrAlreadyRequested = errors.New("заявка уже отправлена")
	ErrNoFriendRequest  = errors.New("заявка не найдена")
	ErrNotFriends       = errors.New("не в друзьях")
	ErrBlocked          = errors.New("пользователь заблокирован")
	ErrCannotSelf       = errors.New("нельзя добавить себя")
)

// FriendUser is a compact public card for lists and search.
type FriendUser struct {
	ID        int64  `json:"id"`
	Username  string `json:"username"`
	Cubes     int    `json:"cubes"`
	AvatarURL string `json:"avatarUrl,omitempty"`
	CreatedAt string `json:"createdAt,omitempty"`
	Relation  string `json:"relation,omitempty"` // friends|incoming|outgoing|blocked|none|self
}

func pairIDs(a, b int64) (int64, int64) {
	if a < b {
		return a, b
	}
	return b, a
}

func (s *Store) blockExists(ctx context.Context, blockerID, blockedID int64) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx,
		`SELECT EXISTS(
			SELECT 1 FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2
		)`, blockerID, blockedID).Scan(&exists)
	return exists, err
}

func (s *Store) areFriends(ctx context.Context, a, b int64) (bool, error) {
	ua, ub := pairIDs(a, b)
	var exists bool
	err := s.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM friendships WHERE user_a = $1 AND user_b = $2)`,
		ua, ub).Scan(&exists)
	return exists, err
}

func (s *Store) requestExists(ctx context.Context, fromID, toID int64) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM friend_requests WHERE from_id = $1 AND to_id = $2)`,
		fromID, toID).Scan(&exists)
	return exists, err
}

// RelationBetween describes how viewer sees target.
func (s *Store) RelationBetween(viewerID, targetID int64) (string, error) {
	if viewerID == targetID {
		return "self", nil
	}
	ctx, cancel := dbCtx()
	defer cancel()

	if ok, err := s.blockExists(ctx, viewerID, targetID); err != nil {
		return "", err
	} else if ok {
		return "blocked", nil
	}
	if ok, err := s.blockExists(ctx, targetID, viewerID); err != nil {
		return "", err
	} else if ok {
		return "blocked_by", nil
	}
	if ok, err := s.areFriends(ctx, viewerID, targetID); err != nil {
		return "", err
	} else if ok {
		return "friends", nil
	}
	if ok, err := s.requestExists(ctx, targetID, viewerID); err != nil {
		return "", err
	} else if ok {
		return "incoming", nil
	}
	if ok, err := s.requestExists(ctx, viewerID, targetID); err != nil {
		return "", err
	} else if ok {
		return "outgoing", nil
	}
	return "none", nil
}

func scanFriendRows(rows interface {
	Next() bool
	Scan(dest ...any) error
	Err() error
	Close()
}, relation string) ([]FriendUser, error) {
	defer rows.Close()
	out := []FriendUser{}
	for rows.Next() {
		var u FriendUser
		if err := rows.Scan(&u.ID, &u.Username, &u.Cubes, &u.AvatarURL); err != nil {
			return nil, err
		}
		u.Relation = relation
		out = append(out, u)
	}
	return out, rows.Err()
}

func (s *Store) ListFriends(userID int64) ([]FriendUser, error) {
	ctx, cancel := dbCtx()
	defer cancel()
	rows, err := s.pool.Query(ctx, `
		SELECT u.id, u.username, u.cubes, coalesce(u.avatar_url, '')
		FROM friendships f
		JOIN users u ON u.id = CASE WHEN f.user_a = $1 THEN f.user_b ELSE f.user_a END
		WHERE f.user_a = $1 OR f.user_b = $1
		ORDER BY lower(u.username)`, userID)
	if err != nil {
		return nil, err
	}
	return scanFriendRows(rows, "friends")
}

func (s *Store) ListIncomingRequests(userID int64) ([]FriendUser, error) {
	ctx, cancel := dbCtx()
	defer cancel()
	rows, err := s.pool.Query(ctx, `
		SELECT u.id, u.username, u.cubes, coalesce(u.avatar_url, '')
		FROM friend_requests r
		JOIN users u ON u.id = r.from_id
		WHERE r.to_id = $1
		  AND NOT EXISTS (
			SELECT 1 FROM user_blocks b
			WHERE (b.blocker_id = $1 AND b.blocked_id = u.id)
			   OR (b.blocker_id = u.id AND b.blocked_id = $1)
		  )
		ORDER BY r.created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	return scanFriendRows(rows, "incoming")
}

func (s *Store) ListOutgoingRequests(userID int64) ([]FriendUser, error) {
	ctx, cancel := dbCtx()
	defer cancel()
	rows, err := s.pool.Query(ctx, `
		SELECT u.id, u.username, u.cubes, coalesce(u.avatar_url, '')
		FROM friend_requests r
		JOIN users u ON u.id = r.to_id
		WHERE r.from_id = $1
		ORDER BY r.created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	return scanFriendRows(rows, "outgoing")
}

func (s *Store) ListBlocked(userID int64) ([]FriendUser, error) {
	ctx, cancel := dbCtx()
	defer cancel()
	rows, err := s.pool.Query(ctx, `
		SELECT u.id, u.username, u.cubes, coalesce(u.avatar_url, '')
		FROM user_blocks b
		JOIN users u ON u.id = b.blocked_id
		WHERE b.blocker_id = $1
		ORDER BY lower(u.username)`, userID)
	if err != nil {
		return nil, err
	}
	return scanFriendRows(rows, "blocked")
}

// SearchUsers finds nicknames for the friends UI. Blocks (both ways) are hidden.
func (s *Store) SearchUsers(viewerID int64, query string, limit int) ([]FriendUser, error) {
	q := strings.TrimSpace(query)
	if len(q) < 1 {
		return []FriendUser{}, nil
	}
	if limit <= 0 || limit > 30 {
		limit = 20
	}
	ctx, cancel := dbCtx()
	defer cancel()

	rows, err := s.pool.Query(ctx, `
		SELECT u.id, u.username, u.cubes, coalesce(u.avatar_url, '')
		FROM users u
		WHERE u.id <> $1
		  AND lower(u.username) LIKE lower($2) || '%'
		  AND NOT EXISTS (
			SELECT 1 FROM user_blocks b
			WHERE (b.blocker_id = $1 AND b.blocked_id = u.id)
			   OR (b.blocker_id = u.id AND b.blocked_id = $1)
		  )
		ORDER BY lower(u.username)
		LIMIT $3`, viewerID, q, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []FriendUser{}
	for rows.Next() {
		var u FriendUser
		if err := rows.Scan(&u.ID, &u.Username, &u.Cubes, &u.AvatarURL); err != nil {
			return nil, err
		}
		rel, err := s.RelationBetween(viewerID, u.ID)
		if err != nil {
			return nil, err
		}
		u.Relation = rel
		out = append(out, u)
	}
	return out, rows.Err()
}

func (s *Store) PublicUser(viewerID, targetID int64) (*FriendUser, error) {
	u, err := s.UserByID(targetID)
	if err != nil {
		return nil, err
	}
	rel, err := s.RelationBetween(viewerID, targetID)
	if err != nil {
		return nil, err
	}
	if rel == "blocked_by" {
		return nil, ErrNoUser
	}
	return &FriendUser{
		ID: u.ID, Username: u.Username, Cubes: u.Cubes,
		AvatarURL: u.AvatarURL, CreatedAt: u.CreatedAt.UTC().Format(time.RFC3339),
		Relation: rel,
	}, nil
}

func (s *Store) SendFriendRequest(fromID, toID int64) error {
	if fromID == toID {
		return ErrCannotSelf
	}
	ctx, cancel := dbCtx()
	defer cancel()

	if ok, err := s.blockExists(ctx, fromID, toID); err != nil {
		return err
	} else if ok {
		return ErrBlocked
	}
	if ok, err := s.blockExists(ctx, toID, fromID); err != nil {
		return err
	} else if ok {
		return ErrBlocked
	}
	if ok, err := s.areFriends(ctx, fromID, toID); err != nil {
		return err
	} else if ok {
		return ErrAlreadyFriends
	}
	if ok, err := s.requestExists(ctx, fromID, toID); err != nil {
		return err
	} else if ok {
		return ErrAlreadyRequested
	}

	// They already asked us — accept instead of creating a second request.
	if ok, err := s.requestExists(ctx, toID, fromID); err != nil {
		return err
	} else if ok {
		return s.acceptFriendRequestTx(ctx, toID, fromID)
	}

	_, err := s.pool.Exec(ctx,
		`INSERT INTO friend_requests (from_id, to_id) VALUES ($1, $2)`,
		fromID, toID)
	if isUniqueViolation(err) {
		return ErrAlreadyRequested
	}
	return err
}

func (s *Store) acceptFriendRequestTx(ctx context.Context, fromID, toID int64) error {
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM friend_requests WHERE from_id = $1 AND to_id = $2`,
		fromID, toID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNoFriendRequest
	}
	ua, ub := pairIDs(fromID, toID)
	_, err = s.pool.Exec(ctx,
		`INSERT INTO friendships (user_a, user_b) VALUES ($1, $2)
		 ON CONFLICT DO NOTHING`, ua, ub)
	return err
}

func (s *Store) AcceptFriendRequest(userID, fromID int64) error {
	ctx, cancel := dbCtx()
	defer cancel()
	return s.acceptFriendRequestTx(ctx, fromID, userID)
}

func (s *Store) DeclineFriendRequest(userID, fromID int64) error {
	ctx, cancel := dbCtx()
	defer cancel()
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM friend_requests WHERE from_id = $1 AND to_id = $2`,
		fromID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNoFriendRequest
	}
	return nil
}

func (s *Store) CancelFriendRequest(userID, toID int64) error {
	ctx, cancel := dbCtx()
	defer cancel()
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM friend_requests WHERE from_id = $1 AND to_id = $2`,
		userID, toID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNoFriendRequest
	}
	return nil
}

func (s *Store) RemoveFriend(userID, otherID int64) error {
	ctx, cancel := dbCtx()
	defer cancel()
	ua, ub := pairIDs(userID, otherID)
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM friendships WHERE user_a = $1 AND user_b = $2`, ua, ub)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFriends
	}
	return nil
}

func (s *Store) BlockUser(blockerID, blockedID int64) error {
	if blockerID == blockedID {
		return ErrCannotSelf
	}
	ctx, cancel := dbCtx()
	defer cancel()

	ua, ub := pairIDs(blockerID, blockedID)
	_, _ = s.pool.Exec(ctx, `DELETE FROM friendships WHERE user_a = $1 AND user_b = $2`, ua, ub)
	_, _ = s.pool.Exec(ctx, `DELETE FROM friend_requests
		WHERE (from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1)`,
		blockerID, blockedID)

	_, err := s.pool.Exec(ctx,
		`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2)
		 ON CONFLICT DO NOTHING`, blockerID, blockedID)
	return err
}

func (s *Store) UnblockUser(blockerID, blockedID int64) error {
	ctx, cancel := dbCtx()
	defer cancel()
	_, err := s.pool.Exec(ctx,
		`DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2`,
		blockerID, blockedID)
	return err
}

// EnsureFriendship is used by the local seed (idempotent).
func (s *Store) EnsureFriendship(a, b int64) error {
	if a == b {
		return ErrCannotSelf
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	ua, ub := pairIDs(a, b)
	_, err := s.pool.Exec(ctx,
		`INSERT INTO friendships (user_a, user_b) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		ua, ub)
	return err
}

func (s *Store) EnsureFriendRequest(fromID, toID int64) error {
	if fromID == toID {
		return ErrCannotSelf
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err := s.pool.Exec(ctx,
		`INSERT INTO friend_requests (from_id, to_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		fromID, toID)
	return err
}

func (s *Store) EnsureBlock(blockerID, blockedID int64) error {
	if blockerID == blockedID {
		return ErrCannotSelf
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err := s.pool.Exec(ctx,
		`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		blockerID, blockedID)
	return err
}
