package main

import (
	"context"
	"time"
)

// RatingEntry is one row on the cubes leaderboard.
type RatingEntry struct {
	Rank      int    `json:"rank"`
	ID        int64  `json:"id"`
	Username  string `json:"username"`
	Cubes     int    `json:"cubes"`
	AvatarURL string `json:"avatarUrl,omitempty"`
}

// TopByCubes returns the richest players, ties broken by earlier account id.
func (s *Store) TopByCubes(limit int) ([]RatingEntry, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	rows, err := s.pool.Query(ctx, `
		SELECT id, username, cubes, coalesce(avatar_url, '')
		FROM users
		ORDER BY cubes DESC, id ASC
		LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]RatingEntry, 0, limit)
	rank := 0
	for rows.Next() {
		rank++
		var e RatingEntry
		if err := rows.Scan(&e.ID, &e.Username, &e.Cubes, &e.AvatarURL); err != nil {
			return nil, err
		}
		e.Rank = rank
		out = append(out, e)
	}
	return out, rows.Err()
}

// RatingOf returns the caller's place on the cubes board (1-based).
func (s *Store) RatingOf(userID int64) (*RatingEntry, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	u, err := s.UserByID(userID)
	if err != nil {
		return nil, err
	}

	var ahead int
	err = s.pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM users
		WHERE cubes > $1 OR (cubes = $1 AND id < $2)`,
		u.Cubes, u.ID).Scan(&ahead)
	if err != nil {
		return nil, err
	}

	return &RatingEntry{
		Rank:      ahead + 1,
		ID:        u.ID,
		Username:  u.Username,
		Cubes:     u.Cubes,
		AvatarURL: u.AvatarURL,
	}, nil
}
