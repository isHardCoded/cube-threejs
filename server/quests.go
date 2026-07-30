package main

import (
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
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
	ErrQuestIDTaken    = errors.New("quest id taken")
)

// QuestDef is a catalog entry. Live definitions live in the quests table;
// DefaultQuestCatalog seeds an empty DB and backs tests without Postgres.
type QuestDef struct {
	ID        string `json:"id"`
	Period    string `json:"period"`
	Metric    string `json:"metric"`
	Target    int    `json:"target"`
	Reward    int    `json:"reward"`
	TitleRU   string `json:"titleRu"`
	TitleEN   string `json:"titleEn"`
	Enabled   bool   `json:"enabled"`
	SortOrder int    `json:"sortOrder"`
}

// DefaultQuestCatalog is the initial set seeded into Postgres.
var DefaultQuestCatalog = []QuestDef{
	{ID: "daily_play", Period: questPeriodDaily, Metric: questMetricPlay, Target: 3, Reward: 5,
		TitleRU: "Сыграть 3 матча", TitleEN: "Play 3 matches", Enabled: true, SortOrder: 1},
	{ID: "daily_kills", Period: questPeriodDaily, Metric: questMetricKills, Target: 5, Reward: 8,
		TitleRU: "Сделать 5 киллов", TitleEN: "Get 5 kills", Enabled: true, SortOrder: 2},
	{ID: "daily_win", Period: questPeriodDaily, Metric: questMetricWin, Target: 1, Reward: 15,
		TitleRU: "Выиграть 1 матч", TitleEN: "Win 1 match", Enabled: true, SortOrder: 3},
	{ID: "weekly_play", Period: questPeriodWeekly, Metric: questMetricPlay, Target: 15, Reward: 25,
		TitleRU: "Сыграть 15 матчей", TitleEN: "Play 15 matches", Enabled: true, SortOrder: 4},
	{ID: "weekly_kills", Period: questPeriodWeekly, Metric: questMetricKills, Target: 25, Reward: 40,
		TitleRU: "Сделать 25 киллов", TitleEN: "Get 25 kills", Enabled: true, SortOrder: 5},
	{ID: "weekly_win", Period: questPeriodWeekly, Metric: questMetricWin, Target: 5, Reward: 60,
		TitleRU: "Выиграть 5 матчей", TitleEN: "Win 5 matches", Enabled: true, SortOrder: 6},
}

// QuestCatalog kept as alias for older test helpers.
var QuestCatalog = DefaultQuestCatalog

func questByID(id string) (QuestDef, bool) {
	for _, q := range DefaultQuestCatalog {
		if q.ID == id {
			return q, true
		}
	}
	return QuestDef{}, false
}

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

type QuestView struct {
	ID        string `json:"id"`
	Period    string `json:"period"`
	Progress  int    `json:"progress"`
	Target    int    `json:"target"`
	Reward    int    `json:"reward"`
	TitleRU   string `json:"titleRu,omitempty"`
	TitleEN   string `json:"titleEn,omitempty"`
	Claimed   bool   `json:"claimed"`
	Claimable bool   `json:"claimable"`
}

func (s *Store) SeedDefaultQuests() error {
	if s.pool == nil {
		return nil
	}
	ctx, cancel := dbCtx()
	defer cancel()
	var n int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM quests`).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	for _, q := range DefaultQuestCatalog {
		if _, err := s.pool.Exec(ctx, `
			INSERT INTO quests (id, period, metric, target, reward, title_ru, title_en, enabled, sort_order)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
			ON CONFLICT (id) DO NOTHING`,
			q.ID, q.Period, q.Metric, q.Target, q.Reward, q.TitleRU, q.TitleEN, q.Enabled, q.SortOrder); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) loadQuestDefs(enabledOnly bool) ([]QuestDef, error) {
	if s.pool == nil {
		out := make([]QuestDef, 0, len(DefaultQuestCatalog))
		for _, q := range DefaultQuestCatalog {
			if !enabledOnly || q.Enabled {
				out = append(out, q)
			}
		}
		return out, nil
	}
	ctx, cancel := dbCtx()
	defer cancel()
	sql := `SELECT id, period, metric, target, reward, title_ru, title_en, enabled, sort_order
		FROM quests`
	if enabledOnly {
		sql += ` WHERE enabled = true`
	}
	sql += ` ORDER BY sort_order, id`
	rows, err := s.pool.Query(ctx, sql)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []QuestDef
	for rows.Next() {
		var q QuestDef
		if err := rows.Scan(&q.ID, &q.Period, &q.Metric, &q.Target, &q.Reward,
			&q.TitleRU, &q.TitleEN, &q.Enabled, &q.SortOrder); err != nil {
			return nil, err
		}
		out = append(out, q)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(out) == 0 && !enabledOnly {
		return append([]QuestDef(nil), DefaultQuestCatalog...), nil
	}
	return out, nil
}

func (s *Store) QuestByID(id string) (QuestDef, bool, error) {
	if s.pool == nil {
		q, ok := questByID(id)
		return q, ok, nil
	}
	ctx, cancel := dbCtx()
	defer cancel()
	var q QuestDef
	err := s.pool.QueryRow(ctx, `
		SELECT id, period, metric, target, reward, title_ru, title_en, enabled, sort_order
		FROM quests WHERE id = $1`, id).Scan(
		&q.ID, &q.Period, &q.Metric, &q.Target, &q.Reward,
		&q.TitleRU, &q.TitleEN, &q.Enabled, &q.SortOrder)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return QuestDef{}, false, nil
		}
		return QuestDef{}, false, err
	}
	return q, true, nil
}

func (s *Store) ListAllQuestsAdmin() ([]QuestDef, error) {
	return s.loadQuestDefs(false)
}

func (s *Store) CreateQuest(q QuestDef) (QuestDef, error) {
	if s.pool == nil {
		return q, ErrNoStore
	}
	if q.ID == "" || q.Period == "" || q.Metric == "" || q.Target <= 0 || q.Reward < 0 {
		return q, errors.New("invalid quest")
	}
	if q.Period != questPeriodDaily && q.Period != questPeriodWeekly {
		return q, errors.New("invalid period")
	}
	if q.Metric != questMetricPlay && q.Metric != questMetricKills && q.Metric != questMetricWin {
		return q, errors.New("invalid metric")
	}
	ctx, cancel := dbCtx()
	defer cancel()
	_, err := s.pool.Exec(ctx, `
		INSERT INTO quests (id, period, metric, target, reward, title_ru, title_en, enabled, sort_order)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		q.ID, q.Period, q.Metric, q.Target, q.Reward, q.TitleRU, q.TitleEN, q.Enabled, q.SortOrder)
	if isUniqueViolation(err) {
		return q, ErrQuestIDTaken
	}
	return q, err
}

func (s *Store) UpdateQuest(id string, q QuestDef) (QuestDef, error) {
	if s.pool == nil {
		return q, ErrNoStore
	}
	ctx, cancel := dbCtx()
	defer cancel()
	tag, err := s.pool.Exec(ctx, `
		UPDATE quests SET period=$2, metric=$3, target=$4, reward=$5,
			title_ru=$6, title_en=$7, enabled=$8, sort_order=$9
		WHERE id=$1`,
		id, q.Period, q.Metric, q.Target, q.Reward, q.TitleRU, q.TitleEN, q.Enabled, q.SortOrder)
	if err != nil {
		return q, err
	}
	if tag.RowsAffected() == 0 {
		return q, ErrUnknownQuest
	}
	q.ID = id
	return q, nil
}

func (s *Store) DeleteQuest(id string) error {
	if s.pool == nil {
		return ErrNoStore
	}
	ctx, cancel := dbCtx()
	defer cancel()
	tag, err := s.pool.Exec(ctx, `DELETE FROM quests WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrUnknownQuest
	}
	return nil
}

func (s *Store) AddQuestProgress(userID int64, metric string, delta int) error {
	if s.pool == nil || delta == 0 || userID == 0 {
		return nil
	}
	now := time.Now()
	defs, err := s.loadQuestDefs(true)
	if err != nil {
		return err
	}
	ctx, cancel := dbCtx()
	defer cancel()

	for _, q := range defs {
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

func (s *Store) ListQuests(userID int64) (daily, weekly []QuestView, claimable int, err error) {
	now := time.Now()
	dailyKey := periodKeyUTC(questPeriodDaily, now)
	weeklyKey := periodKeyUTC(questPeriodWeekly, now)

	defs, err := s.loadQuestDefs(true)
	if err != nil {
		return nil, nil, 0, err
	}

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
	for _, q := range defs {
		p := progress[q.ID]
		value := p.value
		if value > q.Target {
			value = q.Target
		}
		view := QuestView{
			ID: q.ID, Period: q.Period, Progress: value, Target: q.Target, Reward: q.Reward,
			TitleRU: q.TitleRU, TitleEN: q.TitleEN, Claimed: p.claimed,
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

func (s *Store) ClaimableQuestCount(userID int64) (int, error) {
	_, _, n, err := s.ListQuests(userID)
	return n, err
}

func (s *Store) ClaimQuest(userID int64, questID string) (reward int, balance int, err error) {
	def, ok, err := s.QuestByID(questID)
	if err != nil {
		return 0, 0, err
	}
	if !ok || !def.Enabled {
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
