package main

import (
	"sort"
	"sync"
	"time"
)

// How long a heartbeat keeps an account "in the app". The client pings every
// few seconds while logged in (menu, search, or match).
const onlineTTL = 20 * time.Second

// OnlineUser is one row on the live-players card.
type OnlineUser struct {
	ID        int64  `json:"id"`
	Username  string `json:"username"`
	AvatarURL string `json:"avatarUrl,omitempty"`
	Status    string `json:"status"` // app | search | game
}

// Online tracks who currently has the app open via heartbeats.
type Online struct {
	mu   sync.Mutex
	seen map[int64]time.Time
}

func NewOnline() *Online {
	return &Online{seen: make(map[int64]time.Time)}
}

func (o *Online) Touch(userID int64) {
	o.mu.Lock()
	o.seen[userID] = time.Now()
	o.mu.Unlock()
}

// IDs returns accounts that heartbeated recently, oldest first pruned.
func (o *Online) IDs() []int64 {
	o.mu.Lock()
	defer o.mu.Unlock()
	cutoff := time.Now().Add(-onlineTTL)
	out := make([]int64, 0, len(o.seen))
	for id, t := range o.seen {
		if t.Before(cutoff) {
			delete(o.seen, id)
			continue
		}
		out = append(out, id)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}
