package main

import (
	"errors"
	"fmt"
	"time"
)

const (
	questPeriodDaily  = "daily"
	questPeriodWeekly = "weekly"

	questMetricPlay  = "play"
	questMetricKills = "kills"
	questMetricWin   = "win"
)

var (
	ErrUnknownQuest    = errors.New("unknown quest")
	ErrQuestIncomplete = errors.New("quest incomplete")
	ErrQuestClaimed    = errors.New("quest already claimed")
)

// QuestDef is a fixed catalog entry. Progress lives in quest_progress; the
// definitions themselves stay in code so a deploy can change targets safely.
type QuestDef struct {
	ID     string `json:"id"`
	Period string `json:"period"`
	Metric string `json:"metric"`
	Target int    `json:"target"`
	Reward int    `json:"reward"`
}

// QuestCatalog is the live set of daily and weekly quests.
var QuestCatalog = []QuestDef{
	{ID: "daily_play", Period: questPeriodDaily, Metric: questMetricPlay, Target: 3, Reward: 5},
	{ID: "daily_kills", Period: questPeriodDaily, Metric: questMetricKills, Target: 5, Reward: 8},
	{ID: "daily_win", Period: questPeriodDaily, Metric: questMetricWin, Target: 1, Reward: 15},
	{ID: "weekly_play", Period: questPeriodWeekly, Metric: questMetricPlay, Target: 15, Reward: 25},
	{ID: "weekly_kills", Period: questPeriodWeekly, Metric: questMetricKills, Target: 25, Reward: 40},
	{ID: "weekly_win", Period: questPeriodWeekly, Metric: questMetricWin, Target: 5, Reward: 60},
}

func questByID(id string) (QuestDef, bool) {
	for _, q := range QuestCatalog {
		if q.ID == id {
			return q, true
		}
	}
	return QuestDef{}, false
}

// periodKeyUTC returns the bucket key for a quest period at the given instant.
func periodKeyUTC(period string, now time.Time) string {
	now = now.UTC()
	switch period {
	case questPeriodWeekly:
		y, w := now.ISOWeek()
		return fmt.Sprintf("%04d-W%02d", y, w)
	default:
		return now.Format("2006-01-02")
	}
}

func nextDailyResetUTC(now time.Time) time.Time {
	now = now.UTC()
	tomorrow := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, time.UTC)
	return tomorrow
}

func nextWeeklyResetUTC(now time.Time) time.Time {
	now = now.UTC()
	// ISO week starts Monday; weekday Sunday=0 in Go → shift so Monday=0.
	wd := int(now.Weekday())
	if wd == 0 {
		wd = 7
	}
	daysUntilMonday := 8 - wd
	if daysUntilMonday == 7 {
		daysUntilMonday = 0
	}
	next := time.Date(now.Year(), now.Month(), now.Day()+daysUntilMonday, 0, 0, 0, 0, time.UTC)
	if !next.After(now) {
		next = next.AddDate(0, 0, 7)
	}
	return next
}

// QuestView is one quest as the API returns it.
type QuestView struct {
	ID        string `json:"id"`
	Period    string `json:"period"`
	Progress  int    `json:"progress"`
	Target    int    `json:"target"`
	Reward    int    `json:"reward"`
	Claimed   bool   `json:"claimed"`
	Claimable bool   `json:"claimable"`
}

// AddQuestProgress bumps every catalog quest that tracks the given metric for
// the current UTC periods. Failures are logged by the caller; the game loop
// must not stall on a slow write.
func (s *Store) AddQuestProgress(userID int64, metric string, delta int) error {
	if s.pool == nil || delta == 0 || userID == 0 {
		return nil
	}
	now := time.Now()
	ctx, cancel := dbCtx()
	defer cancel()

	for _, q := range QuestCatalog {
		if q.Metric != metric {
			continue
		}
		key := periodKeyUTC(q.Period, now)
		if _, err := s.pool.Exec(ctx, `
			INSERT INTO quest_progress (user_id, quest_id, period_key, value)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (user_id, quest_id, period_key)
			DO UPDATE SET value = quest_progress.value + EXCLUDED.value`,
			userID, q.ID, key, delta); err != nil {
			return err
		}
	}
	return nil
}

// ListQuests returns the current-period view of the catalog for one account.
func (s *Store) ListQuests(userID int64) (daily, weekly []QuestView, claimable int, err error) {
	now := time.Now()
	dailyKey := periodKeyUTC(questPeriodDaily, now)
	weeklyKey := periodKeyUTC(questPeriodWeekly, now)

	progress := map[string]struct {
		value   int
		claimed bool
	}{}
	if s.pool != nil {
		ctx, cancel := dbCtx()
		defer cancel()
		rows, qerr := s.pool.Query(ctx, `
			SELECT quest_id, value, claimed_at IS NOT NULL
			FROM quest_progress
			WHERE user_id = $1 AND (period_key = $2 OR period_key = $3)`,
			userID, dailyKey, weeklyKey)
		if qerr != nil {
			return nil, nil, 0, qerr
		}
		defer rows.Close()
		for rows.Next() {
			var id string
			var value int
			var claimed bool
			if err := rows.Scan(&id, &value, &claimed); err != nil {
				return nil, nil, 0, err
			}
			progress[id] = struct {
				value   int
				claimed bool
			}{value, claimed}
		}
		if err := rows.Err(); err != nil {
			return nil, nil, 0, err
		}
	}

	daily = make([]QuestView, 0, 3)
	weekly = make([]QuestView, 0, 3)
	for _, q := range QuestCatalog {
		p := progress[q.ID]
		value := p.value
		if value > q.Target {
			value = q.Target
		}
		view := QuestView{
			ID:       q.ID,
			Period:   q.Period,
			Progress: value,
			Target:   q.Target,
			Reward:   q.Reward,
			Claimed:  p.claimed,
		}
		view.Claimable = !p.claimed && p.value >= q.Target
		if view.Claimable {
			claimable++
		}
		if q.Period == questPeriodDaily {
			daily = append(daily, view)
		} else {
			weekly = append(weekly, view)
		}
	}
	return daily, weekly, claimable, nil
}

// ClaimableQuestCount is the menu badge number: completed, not yet claimed.
func (s *Store) ClaimableQuestCount(userID int64) (int, error) {
	_, _, n, err := s.ListQuests(userID)
	return n, err
}

// ClaimQuest marks a completed quest claimed and grants its cubes in one TX.
func (s *Store) ClaimQuest(userID int64, questID string) (reward int, balance int, err error) {
	def, ok := questByID(questID)
	if !ok {
		return 0, 0, ErrUnknownQuest
	}
	if s.pool == nil {
		return 0, 0, ErrNoStore
	}
	now := time.Now()
	key := periodKeyUTC(def.Period, now)

	ctx, cancel := dbCtx()
	defer cancel()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, 0, err
	}
	defer tx.Rollback(ctx)

	var value int
	var claimed bool
	err = tx.QueryRow(ctx, `
		SELECT value, claimed_at IS NOT NULL
		FROM quest_progress
		WHERE user_id = $1 AND quest_id = $2 AND period_key = $3
		FOR UPDATE`, userID, questID, key).Scan(&value, &claimed)
	if err != nil {
		// no row yet → progress is zero
		return 0, 0, ErrQuestIncomplete
	}
	if claimed {
		return 0, 0, ErrQuestClaimed
	}
	if value < def.Target {
		return 0, 0, ErrQuestIncomplete
	}
	if _, err := tx.Exec(ctx, `
		UPDATE quest_progress SET claimed_at = now()
		WHERE user_id = $1 AND quest_id = $2 AND period_key = $3 AND claimed_at IS NULL`,
		userID, questID, key); err != nil {
		return 0, 0, err
	}
	if err := tx.QueryRow(ctx,
		`UPDATE users SET cubes = cubes + $2 WHERE id = $1 RETURNING cubes`,
		userID, def.Reward).Scan(&balance); err != nil {
		return 0, 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, 0, err
	}
	return def.Reward, balance, nil
}

// CountIncomingFriendRequests powers the friends menu badge.
func (s *Store) CountIncomingFriendRequests(userID int64) (int, error) {
	if s.pool == nil {
		return 0, nil
	}
	ctx, cancel := dbCtx()
	defer cancel()
	var n int
	err := s.pool.QueryRow(ctx, `
		SELECT count(*)
		FROM friend_requests r
		WHERE r.to_id = $1
		  AND NOT EXISTS (
			SELECT 1 FROM user_blocks b
			WHERE (b.blocker_id = $1 AND b.blocked_id = r.from_id)
			   OR (b.blocker_id = r.from_id AND b.blocked_id = $1)
		  )`, userID).Scan(&n)
	return n, err
}
