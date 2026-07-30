# Cube 2077 — game server

Go server with two surfaces:

- **REST API** (`/api/...`) — accounts, JWT sessions, skin catalog, Cubes balance.
- **WebSocket** (`/ws`) — authoritative game state (positions, dice faces, HP, dash/jump cooldowns), combat resolution, respawns, and the round cycle.

PostgreSQL is **required**: accounts and currency are meaningless without persistence, so the server refuses to start without `DATABASE_URL`.

## Round cycle

- 3 platforms (levels 0..2), each 9x9 with its own obstacle layout.
- Every 60s the current platform starts crumbling tile by tile from the rim inward (one tile per 400ms).
- When crumbling starts on levels 0/1, a trampoline spawns on a random free cell of the central 3x3; stepping on it launches the cube to the next level.
- Standing on (or moving into) a destroyed tile = fall = death. Knockback into a hole kills too.
- Level 2 has no trampoline: once it fully crumbles, everything resets — all platforms restored, everyone back on level 0 with full HP.
- Jump (`space`): a 2-cell leap in the last movement direction that clears the fence — you can jump off the platform and die.
- Mine (`E`): arms the current cell for 30s and hurts the first enemy who lands on it. See [Classes and mines](#classes-and-mines).

## Run locally

```powershell
# 1. Postgres (from repo root)
docker compose up -d

# 2. Server
cd server
$env:DATABASE_URL  = "postgres://cube:cube2077@127.0.0.1:5434/cube2077?sslmode=disable"
$env:JWT_SECRET    = "dev-secret-for-local-testing"
$env:ALLOWED_ORIGINS = "http://localhost:5173"
$env:ADMIN_USERNAMES = "Goldie"
go run .
```

Ports 5434/8090 are used because 5432/5433 and 8080 are already taken on this machine.

### Environment

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | server exits without it |
| `JWT_SECRET` | production | when unset a random secret is generated, so every restart logs everyone out |
| `ALLOWED_ORIGINS` | production | comma-separated exact origins; when unset any origin is accepted |
| `TELEGRAM_BOT_TOKEN` | for TMA login | without it `POST /api/auth/telegram` always fails |
| `ADDR` / `PORT` | no | defaults to `:8090` |

## REST API

All bodies are JSON. Errors are `{"error": "текст для игрока"}`.

| Endpoint | Auth | Body / result |
| --- | --- | --- |
| `POST /api/register` | — | `{username, password}` → `{token, user}` |
| `POST /api/login` | — | `{username, password}` → `{token, user}` |
| `POST /api/auth/telegram` | — | `{initData}` → `{token, user}`; the HMAC signature is verified against `TELEGRAM_BOT_TOKEN` |
| `GET /api/me` | Bearer | `{user, ownedSkins[]}` |
| `POST /api/me/skin` | Bearer | `{skinId}` → `{user}`; only owned skins are accepted |
| `GET /api/skins` | — | `{skins[], default}` — the catalog every client renders from |

Nicknames are 3–14 letters/digits/`-`/`_` and unique case-insensitively; passwords are at least 6 characters, stored as bcrypt hashes. `/api/register` and `/api/login` are rate-limited to 30 attempts per minute per IP. Tokens are HS256 JWTs valid for 30 days.

## WebSocket protocol (JSON)

Connect with the token and the map: `/ws?token=<jwt>&map=cyberpunk`. A missing or invalid token gets `401` before the upgrade; an unknown map falls back to `cyberpunk`.

Every map is a separate world with its own hub, round timer and roster (`cyberpunk`, `lava`, `desert`). An account can only hold one cube at a time: the player id equals the account id, so reconnecting keeps the same cube, while a second session — on the same map or another one — takes the cube over and the older connection receives `kicked` before it is closed.

Obstacle layouts live in `maps.go` only. The client draws what `welcome.layout` describes and derives colors and scales from the cell coordinates, so the two sides cannot disagree about which cells block.

Each map has its own obstacle vocabulary — cyberpunk `pylon/crate/barrel/column/antenna`, lava `spire/boulder/vent/basalt`, desert `cactus/palm/rock/ruin`. A kind is only a drawing hint: gameplay-wise every obstacle blocks its cell, and a client that does not recognise a kind falls back to a generic prop instead of breaking. `maps_test.go` guards the data itself: cells in bounds and unique, decals not buried under obstacles, every walkable cell reachable, and room left in the central 3x3 for the trampoline to spawn.

Skins work the same way: `skins.go` is the catalog, each player object carries a `skinId`, and the catalog itself rides along in `welcome` — so one cube looks identical on every screen. A skin is picked up from the database when the socket opens, which means changing it in the menu applies the next time you enter a match.

### Round rules

A world needs `MinRoundPlayers` (2) to run a match, which gives three states (see `round.go`):

- **waiting** — practice. Free respawns after `RespawnDelay`, the platforms keep crumbling and looping, and nothing is ever paid out. This is what a lone player gets.
- **live** — elimination on lives. Everyone starts with `MaxLives` (5); each death costs one and the cube respawns after `RespawnDelay`. Spending the last life is final: the player becomes a spectator (`spectating`, also flagged `dead` so every board check ignores them). Joining now means watching until the next round. The round ends when one player is left, and the last survivor wins — including by walkover if everyone else disconnects. A player waiting to respawn still counts as alive, so a mutual kill does not end the round.
- **over** — a `IntermissionTime` (7s) pause with the result on screen. Crumbling stops, then everyone present — spectators included — starts a fresh round on a rebuilt arena.

The winner earns `CubesForWin` + `CubesPerKill` per kill, but only if the round lasted at least `MinRewardedRound` (30s); shorter wins are announced with `tooShort` and pay nothing, so two accounts cannot take turns jumping off the edge to print currency. The payout runs off the hub goroutine — a slow database must not freeze a world — and the resulting balance comes back as a `cubes` message.

Client -> server: `{"t":"move","dx":1,"dz":0}`, `{"t":"dash","dx":0,"dz":-1}`, `{"t":"jump","dx":1,"dz":0}`, `{"t":"mine"}`

Server -> client:
- `welcome {id, map, layout[3], skins[], players[], dashCooldownMs, jumpCooldownMs, mineCooldownMs, maxMines, maxLives, mines[], destroyed[3][], tramps[3], phase, round}` — on connect, includes the full world snapshot; `layout[l] = {obstacles: [{x, z, kind}], decals: [[x, z]]}`, `round = {state, alive, players, minPlayers, nextInMs?}`, `skins` is the same catalog `GET /api/skins` returns, `mines` holds only *your own* armed mines
- `join {p}` / `leave {id}` — roster changes
- `move {p, dash?, cells?, knock?, jump?}` — a player moved (roll, dash, knockback, or jump)
- `hit {a, d, dmgToD, dmgToA, hpA, hpD, dx, dz}` — collision, mutual damage; both survivors are then knocked one cell apart (the perimeter fence stops them at the edge, obstacles bounce them back one cell)
- `death {id, cause: "hit"|"fall", lives?, respawnMs?, eliminated?, alive?}` — `lives` is what is left after this death (absent in practice, where deaths are free); `respawnMs` when coming back, `eliminated` when that was the last life / `respawn {p}`
- `phase {mode: "calm"|"crumble", level, remainMs?}` — destruction phase changes
- `tiles {level, cells[]}` — tiles destroyed
- `tramp {level, x, z}` — trampoline spawned
- `launch {p}` — player launched to the next level
- `reset {players[], phase, round}` — a new round (or practice) starts on a rebuilt arena
- `roundOver {winnerId?, winnerName?, kills?, reward?, tooShort?, draw?, nextInMs}` — the match is decided
- `cubes {total}` — the winner's new balance, once the database confirms it
- `mine {level, x, z, expiresMs}` — **owner only**: your mine is armed
- `mineGone {level, x, z}` — **owner only**: it expired, or the tile under it crumbled
- `mineBoom {level, x, z, id, dmg, hp}` — broadcast when someone sets a mine off; this is the first the victim hears of it
- `denied {reason}` — e.g. dash/jump on cooldown, `mine_cooldown`, `mine_limit`, `mine_here`
- `kicked {reason}` — the account connected from somewhere else

Each player object carries `{id, name, skinId, classId, level, x, z, top, east, south, hp, lives, dead, spectating}`.

## Classes and mines

Every account is the `universal` class, whose ability is a mine (`E` on desktop, the on-screen button on touch). `classCanMine` gates it, so a second class is a data change rather than an edit to the movement code.

A mine arms the cell the player is standing on and deals `MineDamage` (8) to the first *other* player who ends a move there — rolling, dashing, jumping or being knocked back all count, because every landing goes through `Hub.landed`. Owners walk over their own mines safely, otherwise laying one under yourself would be suicide.

Mines are **only sent to the player who placed them**: a trap everyone can see is just a wall. Victims learn about it from `mineBoom`. Limits are `MineCooldown` (8s) between mines, `MaxMinesAlive` (2) armed at once, and `MineLifetime` (30s) before it disarms itself. Mines never go on the trampoline cell (that escape route stays fair), disappear with the tile they sat on, and are cleared between rounds. Player ids are per account, so a reconnect gets its own mines back in `welcome`.

## Tests

```powershell
go test ./...          # game rules, dice orientation, map layouts, round machine
node smoke.mjs         # REST auth, CORS, skins, ws admission, maps, rounds (server must be running)
$env:SLOW=1; node smoke.mjs   # also sits through a 30s round to verify the Cubes payout
```
