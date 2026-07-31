package main

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 4096,
	// Identity comes from the JWT in the query string, not from the origin,
	// so the Vercel frontend and local dev can both connect.
	CheckOrigin: func(r *http.Request) bool { return true },
}

type Client struct {
	conn   *websocket.Conn
	send   chan []byte
	hub    *Hub
	player *Player

	// resolved from the ?token= JWT before the upgrade
	userID     int64
	name       string
	skinID     string
	mineSkinID string
	hatID      string
	classID    string

	closing bool // set by the hub goroutine when this connection is being retired
}

// trySend drops the message if the client's buffer is full (slow consumer).
// Only the hub goroutine calls this, so the closing check needs no lock.
func (c *Client) trySend(data []byte) {
	if c.closing {
		return
	}
	select {
	case c.send <- data:
	default:
	}
}

// closeAfterFlush stops accepting new messages and lets writeLoop deliver
// what is already queued before the connection drops. Closing the socket
// directly would race with the write and swallow the last message.
func (c *Client) closeAfterFlush() {
	if c.closing {
		return
	}
	c.closing = true
	close(c.send)
}

func serveWS(arena *Arena, store *Store, w http.ResponseWriter, r *http.Request) {
	// authenticate before upgrading so the client gets a real 401
	userID, err := userIDFromToken(r.URL.Query().Get("token"))
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	u, err := store.UserByID(userID)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if store.IsBanned(u) {
		http.Error(w, "banned", http.StatusForbidden)
		return
	}
	store.EnsureMineSkins(u.ID)
	store.EnsureHats(u.ID)
	// reload so MineSkinID / HatID are valid if they were empty/legacy
	if refreshed, err := store.UserByID(u.ID); err == nil {
		u = refreshed
	}
	if u.MineSkinID == "" || !mineSkinExists(u.MineSkinID) {
		u.MineSkinID = DefaultMineSkin
	}
	if u.HatID == "" || !hatExists(u.HatID) {
		u.HatID = DefaultHat
	}

	q := r.URL.Query()
	var hub *Hub
	if matchID := strings.TrimSpace(q.Get("match")); matchID != "" {
		hub = arena.MatchHub(matchID)
		if hub == nil {
			http.Error(w, "match not found", http.StatusNotFound)
			return
		}
	} else if q.Get("mode") == ModeTraining {
		hub = arena.TrainingHub(q.Get("map"), u.ID)
	} else {
		http.Error(w, "mode required", http.StatusBadRequest)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("upgrade:", err)
		return
	}
	c := &Client{
		conn: conn, send: make(chan []byte, 64), hub: hub,
		userID: u.ID, name: u.Username, skinID: u.SkinID, mineSkinID: u.MineSkinID,
		hatID: u.HatID, classID: u.ClassID,
	}
	// claim the account for this world before joining, so a cube on another
	// map is released instead of running in parallel
	hub.presence.Enter(u.ID, hub)
	// the room can be reaped between the lookup and the join
	if !hub.enqueueClient(c) {
		hub.presence.Leave(u.ID, hub)
		conn.Close()
		return
	}
	go c.writeLoop()
	go c.readLoop()
}

func (c *Client) readLoop() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()
	c.conn.SetReadLimit(512)
	c.conn.SetReadDeadline(time.Now().Add(70 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(70 * time.Second))
		return nil
	})
	for {
		_, data, err := c.conn.ReadMessage()
		if err != nil {
			return
		}
		var msg clientMsg
		if json.Unmarshal(data, &msg) != nil {
			continue
		}
		// Latency probe: answer immediately so RTT is not queued behind gameplay.
		if msg.T == "ping" {
			c.hub.sendRaw(c, map[string]any{"t": "pong", "ts": msg.Ts})
			continue
		}
		select {
		case c.hub.commands <- command{client: c, msg: msg}:
		default: // command queue full: drop input rather than block
		}
	}
}

func (c *Client) writeLoop() {
	ping := time.NewTicker(30 * time.Second)
	defer func() {
		ping.Stop()
		c.conn.Close()
	}()
	for {
		select {
		case data, ok := <-c.send:
			if !ok {
				return
			}
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if c.conn.WriteMessage(websocket.TextMessage, data) != nil {
				return
			}
		case <-ping.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if c.conn.WriteMessage(websocket.PingMessage, nil) != nil {
				return
			}
		}
	}
}
