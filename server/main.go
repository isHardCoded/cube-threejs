package main

import (
	"log"
	"net/http"
	"os"
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

	// One world per map, each with its own round timer and player list.
	// Presence is shared so an account can only hold a cube on one of them.
	presence := NewPresence()
	hubs := make(map[string]*Hub, len(MapOrder))
	for _, id := range MapOrder {
		hub := NewHub(store, GameMaps[id], presence)
		hubs[id] = hub
		go hub.Run()
	}
	log.Println("hubs running:", MapOrder)

	api := NewAPI(store)
	http.Handle("/api/", api.Handler())
	http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		serveWS(hubs[MapByID(r.URL.Query().Get("map")).ID], store, w, r)
	})
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	log.Println("cube game server listening on", addr)
	log.Fatal(http.ListenAndServe(addr, nil))
}
