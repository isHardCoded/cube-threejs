# Cube 2077 — game server

Go WebSocket server: authoritative game state (positions, dice faces, HP, dash/jump cooldowns), combat resolution, respawns, and the round cycle (three stacked platforms, timed destruction waves, trampolines). Stats are persisted to PostgreSQL (optional — the game runs fine without it).

## Round cycle

- 3 platforms (levels 0..2), each 9x9 with its own obstacle layout.
- Every 60s the current platform starts crumbling tile by tile from the rim inward (one tile per 400ms).
- When crumbling starts on levels 0/1, a trampoline spawns on a random free cell of the central 3x3; stepping on it launches the cube to the next level.
- Standing on (or moving into) a destroyed tile = fall = death. Knockback into a hole kills too.
- Level 2 has no trampoline: once it fully crumbles, everything resets — all platforms restored, everyone back on level 0 with 100 HP.
- Jump (`space`): a 2-cell leap in the last movement direction that clears the fence — you can jump off the platform and die.

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

Client -> server: `{"t":"move","dx":1,"dz":0}`, `{"t":"dash","dx":0,"dz":-1}`, `{"t":"jump","dx":1,"dz":0}`

Server -> client:
- `welcome {id, players[], dashCooldownMs, jumpCooldownMs, destroyed[3][], tramps[3], phase}` — on connect, includes the full world snapshot
- `join {p}` / `leave {id}` — roster changes
- `move {p, dash?, cells?, knock?, jump?}` — a player moved (roll, dash, knockback, or jump)
- `hit {a, d, dmgToD, dmgToA, hpA, hpD, dx, dz}` — collision, mutual damage; both survivors are then knocked one cell apart (the perimeter fence stops them at the edge, obstacles bounce them back one cell)
- `death {id, cause: "hit"|"fall", respawnMs}` / `respawn {p}`
- `phase {mode: "calm"|"crumble", level, remainMs?}` — round phase changes
- `tiles {level, cells[]}` — tiles destroyed
- `tramp {level, x, z}` — trampoline spawned
- `launch {p}` — player launched to the next level
- `reset {players[], phase}` — full round reset back to level 0
- `denied {reason}` — e.g. dash/jump on cooldown

## Tests

```powershell
go test ./...
```
