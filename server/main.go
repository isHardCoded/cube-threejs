package main

import (
	"log"
	"net/http"
	"os"
	"strings"
)

func main() {
	addr := os.Getenv("ADDR")
	if addr == "" {
		// PaaS platforms (Koyeb, Railway, ...) inject PORT
		if p := os.Getenv("PORT"); p != "" {
			addr = ":" + p
		} else {
			addr = ":8090"
		}
	}

	initAuth()

	store, err := NewStore(os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatalln("store:", err)
	}
	defer store.Close()

	if names := parseAdminUsernames(os.Getenv("ADMIN_USERNAMES")); len(names) > 0 {
		if err := store.SyncAdminUsernames(names); err != nil {
			log.Println("admin sync:", err)
		} else {
			log.Println("admin: synced", len(names), "username(s) from ADMIN_USERNAMES")
		}
	}

	if shouldSeedDemo() {
		if err := store.SeedDemoPlayers(); err != nil {
			log.Println("seed:", err)
		}
	}

	presence := NewPresence()
	online := NewOnline()
	arena := NewArena(store, presence)
	log.Println("arena ready (training + pvp matchmaking + pve arena)")

	api := NewAPI(store, arena, online)
	http.Handle("/api/", api.Handler())
	http.HandleFunc("/avatars/", serveAvatars)
	http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		serveWS(arena, store, w, r)
	})
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	_ = ensureAvatarDir()
	_ = ensureBotPostsDir()

	log.Println("cube game server listening on", addr)
	log.Fatal(http.ListenAndServe(addr, nil))
}

func shouldSeedDemo() bool {
	if v := strings.TrimSpace(os.Getenv("SEED_DEMO")); v == "1" || strings.EqualFold(v, "true") {
		return true
	}
	// local docker-compose sets JWT_SECRET to something containing "local"
	return strings.Contains(strings.ToLower(os.Getenv("JWT_SECRET")), "local")
}

func parseAdminUsernames(raw string) []string {
	var out []string
	for _, p := range strings.Split(raw, ",") {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}
