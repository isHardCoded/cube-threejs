package main

import "sync"

// Presence tracks which world each account is in. Without it an account could
// hold a cube on every map at once and farm all of them in parallel: the
// per-hub duplicate check only sees its own player list.
type Presence struct {
	mu sync.Mutex
	at map[int64]*Hub
}

func NewPresence() *Presence {
	return &Presence{at: make(map[int64]*Hub)}
}

// Enter claims the account for hub and asks the previous world to let it go.
// Same-hub reconnects are left to the hub itself, which already replaces the
// player in place.
func (p *Presence) Enter(userID int64, hub *Hub) {
	p.mu.Lock()
	prev, ok := p.at[userID]
	p.at[userID] = hub
	p.mu.Unlock()

	if ok && prev != nil && prev != hub {
		// hand it to the owning goroutine: player state is not ours to touch
		prev.evict <- userID
	}
}

// Leave forgets the account, unless it has already moved on to another world.
func (p *Presence) Leave(userID int64, hub *Hub) {
	p.mu.Lock()
	if p.at[userID] == hub {
		delete(p.at, userID)
	}
	p.mu.Unlock()
}

// Kick asks the hub holding this account to evict it (ban / admin).
func (p *Presence) Kick(userID int64) {
	p.mu.Lock()
	hub := p.at[userID]
	p.mu.Unlock()
	if hub != nil {
		hub.evict <- userID
	}
}
