# Cube 2077 — game server

Go WebSocket server: authoritative game state (positions, dice faces, HP, dash cooldowns), combat resolution, respawns. Stats are persisted to PostgreSQL (optional — the game runs fine without it).

## Run locally

```powershell
# 1. Postgres (from repo root)
docker compose up -d

# 2. Server
cd server
$env:DATABASE_URL = "postgres://cube:cube2077@localhost:5434/cube2077"
go run .
```

Server listens on `:8090` (`ADDR` env var to change). WebSocket endpoint: `/ws`, health check: `/health`.
Ports 5434/8090 are used because 5432/5433 and 8080 are already taken on this machine.

## Frontend

The client connects to `ws://localhost:8080/ws` by default. For production (Vercel) set the WS URL at build time:

```
VITE_WS_URL=wss://your-server.example.com/ws npm run build
```

## Protocol (JSON over WS)

Client -> server: `{"t":"move","dx":1,"dz":0}` or `{"t":"dash","dx":0,"dz":-1}`

Server -> client:
- `welcome {id, players[], dashCooldownMs}` — on connect
- `join {p}` / `leave {id}` — roster changes
- `move {p, dash, cells?}` — a player moved (roll or dash); `{p, knock: true}` — knocked back after a collision
- `hit {a, d, dmgToD, dmgToA, hpA, hpD, dx, dz}` — collision, mutual damage; both survivors are then knocked one cell apart (the perimeter fence stops them at the edge, obstacles bounce them back one cell)
- `death {id, respawnMs}` / `respawn {p}`
- `denied {reason}` — e.g. dash on cooldown

## Tests

```powershell
go test ./...
```
