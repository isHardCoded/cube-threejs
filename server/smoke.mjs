// End-to-end check against a running server: REST auth, CORS, skins,
// websocket admission, and per-map world isolation.
//
//   node smoke.mjs                # server with ALLOWED_ORIGINS unset
//   STRICT_CORS=1 node smoke.mjs  # server with ALLOWED_ORIGINS set to ORIGIN
//   HOST=localhost:8091 node smoke.mjs  # a second instance on another port
const HOST = process.env.HOST || 'localhost:8090'
const API = `http://${HOST}`
const WS = `ws://${HOST}/ws`
const ORIGIN = 'http://localhost:5173'

const pass = 'secret123'
const nick = () => 'Test' + Math.floor(Math.random() * 1000000)

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' -> ' + detail : ''}`)
  if (!ok) failures++
}

function skip(name, why) {
  console.log(`SKIP  ${name} -> ${why}`)
}

// A 429 means the rate limiter fired, not that the endpoint is broken.
function rateLimited(r) {
  if (r.status !== 429) return false
  console.log('NOTE  rate limit hit; wait a minute between runs')
  return true
}

async function call(path, { method = 'GET', body, token, origin } = {}) {
  const headers = {}
  if (body) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`
  if (origin) headers.Origin = origin
  const res = await fetch(API + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try { data = await res.json() } catch {}
  return { status: res.status, data, headers: res.headers }
}

// Resolves once the first server message arrives (or the socket dies), while
// `messages` keeps filling so later assertions can inspect the whole stream.
function openWS(url) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url)
    const messages = []
    let settled = false
    const done = (result) => {
      if (settled) return
      settled = true
      resolve({ ...result, messages, ws })
    }
    ws.onmessage = (e) => {
      messages.push(JSON.parse(e.data))
      if (messages.length === 1) done({ opened: true })
    }
    ws.onerror = () => done({ opened: false })
    ws.onclose = () => done({ opened: false })
    setTimeout(() => done({ opened: messages.length > 0 }), 3000)
  })
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const lastMsg = (msgs, t) => [...msgs].reverse().find((m) => m.t === t)

async function waitFor(ok, ms = 12000) {
  for (const until = Date.now() + ms; Date.now() < until;) {
    if (ok()) return true
    await wait(250)
  }
  return false
}

// My cube as of the latest snapshot: a round start respawns everyone, so the
// roster from welcome goes stale as soon as a second player shows up.
function mySnapshot(sock) {
  const id = sock.messages[0]?.id
  const snap = lastMsg(sock.messages, 'reset') || sock.messages[0]
  return snap?.players?.find((p) => p.id === id)
}

// Each map has its own obstacle vocabulary; a cyberpunk pylon showing up in the
// desert would mean the layouts got crossed somewhere.
const KINDS = {
  cyberpunk: ['pylon', 'crate', 'barrel', 'column', 'antenna'],
  lava: ['spire', 'boulder', 'vent', 'basalt'],
  desert: ['cactus', 'palm', 'rock', 'ruin'],
}

async function newAccount() {
  const name = nick()
  const r = await call('/api/register', { method: 'POST', body: { username: name, password: pass } })
  if (r.status !== 200) throw new Error(`register failed: ${r.status} ${r.data?.error || ''}`)
  return { name, token: r.data.token }
}

async function testAuth() {
  console.log('\n-- auth --')
  const name = nick()

  let r = await call('/api/register', { method: 'POST', body: { username: 'ab', password: pass } })
  check('short nickname rejected', r.status === 400, r.data?.error)

  r = await call('/api/register', { method: 'POST', body: { username: name, password: '123' } })
  check('short password rejected', r.status === 400, r.data?.error)

  r = await call('/api/register', { method: 'POST', body: { username: name, password: pass } })
  check('register works', r.status === 200 && !!r.data?.token, `cubes=${r.data?.user?.cubes}`)
  const token = r.data?.token

  r = await call('/api/register', { method: 'POST', body: { username: name.toUpperCase(), password: pass } })
  check('duplicate nickname rejected case-insensitively', r.status === 409, r.data?.error)

  r = await call('/api/login', { method: 'POST', body: { username: name, password: 'wrong-pass' } })
  if (!rateLimited(r)) check('wrong password rejected', r.status === 401)

  r = await call('/api/login', { method: 'POST', body: { username: name.toLowerCase(), password: pass } })
  if (!rateLimited(r)) check('login is case-insensitive', r.status === 200 && !!r.data?.token)

  r = await call('/api/me')
  check('me without token is 401', r.status === 401)

  r = await call('/api/me', { token: 'garbage.token.here' })
  check('me with bad token is 401', r.status === 401)

  r = await call('/api/me', { token })
  check('me returns the account', r.status === 200 && r.data?.user?.username === name,
    `skin=${r.data?.user?.skinId} owned=${r.data?.ownedSkins?.length}`)
  check('all skins granted on register', r.data?.ownedSkins?.length === 5)

  r = await call('/api/skins')
  check('skin catalog is public', r.status === 200 && r.data?.skins?.length === 5)

  r = await call('/api/me/skin', { method: 'POST', token, body: { skinId: 'lava-rock' } })
  check('skin equip works', r.status === 200 && r.data?.user?.skinId === 'lava-rock')

  r = await call('/api/me/skin', { method: 'POST', token, body: { skinId: 'does-not-exist' } })
  check('unknown skin rejected', r.status === 400)

  return { name, token }
}

async function testCORS() {
  console.log('\n-- cors --')
  const pre = await fetch(API + '/api/login', {
    method: 'OPTIONS',
    headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST' },
  })
  check('preflight allows the frontend origin',
    pre.status === 204 && pre.headers.get('access-control-allow-origin') === ORIGIN)

  const bad = await fetch(API + '/api/skins', { headers: { Origin: 'https://evil.example' } })
  if (process.env.STRICT_CORS) {
    check('unlisted origin gets no CORS header', !bad.headers.get('access-control-allow-origin'))
  } else {
    skip('unlisted origin gets no CORS header',
      'set ALLOWED_ORIGINS on the server and STRICT_CORS=1 here')
  }
}

async function testAdmission({ name, token }) {
  console.log('\n-- websocket admission --')

  let sock = await openWS(WS)
  check('ws without token is refused', !sock.opened)

  sock = await openWS(`${WS}?token=garbage`)
  check('ws with bad token is refused', !sock.opened)

  const first = await openWS(`${WS}?token=${token}`)
  const welcome = first.messages[0]
  check('ws with token gets welcome', welcome?.t === 'welcome', `id=${welcome?.id}`)
  const mine = welcome?.players?.find((p) => p.id === welcome.id)
  check('player carries account name and skin',
    mine?.name === name && mine?.skinId === 'lava-rock', `${mine?.name}/${mine?.skinId}`)

  const skins = welcome?.skins
  check('welcome ships the skin catalog',
    Array.isArray(skins) && skins.length === 5
      && skins.every((s) => s.id && s.body && s.pip && s.roughness != null),
    JSON.stringify(skins?.map((s) => s.id)))
  check('the equipped skin exists in the catalog',
    !!skins?.some((s) => s.id === mine?.skinId))

  const second = await openWS(`${WS}?token=${token}`)
  check('second session also joins', second.messages[0]?.t === 'welcome')
  await wait(500)
  check('first session was kicked', first.messages.some((m) => m.t === 'kicked'),
    JSON.stringify(first.messages.map((m) => m.t)))
  check('same account keeps the same player id',
    second.messages[0]?.id === welcome?.id, `${welcome?.id} vs ${second.messages[0]?.id}`)

  first.ws.close()
  second.ws.close()
}

function layoutProblems(layout, mapId) {
  const kinds = KINDS[mapId]
  if (!kinds) return `no expected kinds for map ${mapId}`
  if (!Array.isArray(layout) || layout.length !== 3) return 'expected 3 levels'
  for (let l = 0; l < 3; l++) {
    const { obstacles, decals } = layout[l] || {}
    if (!Array.isArray(obstacles) || obstacles.length === 0) return `L${l} has no obstacles`
    for (const o of obstacles) {
      if (!Number.isInteger(o.x) || !Number.isInteger(o.z)) return `L${l} obstacle without integer cell`
      if (Math.abs(o.x) > 4 || Math.abs(o.z) > 4) return `L${l} obstacle out of bounds`
      if (!kinds.includes(o.kind)) return `L${l} kind ${o.kind} does not belong to ${mapId}`
    }
    if (!Array.isArray(decals)) return `L${l} decals missing`
  }
  return ''
}

const cellSet = (layout) =>
  new Set(layout.flatMap((lvl, l) => lvl.obstacles.map((o) => `${l}:${o.x},${o.z}`)))

async function testMaps(accountA) {
  console.log('\n-- maps --')

  const cyber = await openWS(`${WS}?token=${accountA.token}&map=cyberpunk`)
  const cyberWelcome = cyber.messages[0]
  check('welcome names the map', cyberWelcome?.map === 'cyberpunk', cyberWelcome?.map)
  check('welcome carries a usable layout', layoutProblems(cyberWelcome?.layout, 'cyberpunk') === '',
    layoutProblems(cyberWelcome?.layout, 'cyberpunk'))
  cyber.ws.close()
  await wait(200)

  const lava = await openWS(`${WS}?token=${accountA.token}&map=lava`)
  const lavaWelcome = lava.messages[0]
  check('lava is a separate map', lavaWelcome?.map === 'lava', lavaWelcome?.map)
  check('lava layout is valid', layoutProblems(lavaWelcome?.layout, 'lava') === '',
    layoutProblems(lavaWelcome?.layout, 'lava'))

  const a = cellSet(cyberWelcome.layout)
  const b = cellSet(lavaWelcome.layout)
  const shared = [...a].filter((c) => b.has(c)).length
  check('maps have different obstacle placement', shared < Math.min(a.size, b.size),
    `${shared} shared of ${a.size}/${b.size}`)

  const bogus = await openWS(`${WS}?token=${accountA.token}&map=does-not-exist`)
  check('unknown map falls back to the default', bogus.messages[0]?.map === 'cyberpunk',
    bogus.messages[0]?.map)
  bogus.ws.close()
  lava.ws.close()
  await wait(200)

  // two accounts, two maps: neither should see the other
  const accountB = await newAccount()
  const onCyber = await openWS(`${WS}?token=${accountA.token}&map=cyberpunk`)
  await wait(150)
  const onDesert = await openWS(`${WS}?token=${accountB.token}&map=desert`)
  await wait(600)

  // asserted by identity, not by count: other players may be online
  const cyberId = onCyber.messages[0]?.id
  const desertId = onDesert.messages[0]?.id
  const cyberRoster = (onCyber.messages[0]?.players || []).map((p) => p.id)
  const desertRoster = (onDesert.messages[0]?.players || []).map((p) => p.id)
  check('desert layout is valid', layoutProblems(onDesert.messages[0]?.layout, 'desert') === '',
    layoutProblems(onDesert.messages[0]?.layout, 'desert'))
  check('worlds do not share players',
    !cyberRoster.includes(desertId) && !desertRoster.includes(cyberId),
    `${cyberId} in [${desertRoster}] / ${desertId} in [${cyberRoster}]`)
  check('joining another map is invisible here',
    !onCyber.messages.some((m) => m.t === 'join' && m.p?.id === desertId),
    JSON.stringify(onCyber.messages.map((m) => m.t)))

  // the same account switching maps must release the cube it left behind
  const moved = await openWS(`${WS}?token=${accountA.token}&map=lava`)
  await wait(600)
  check('switching maps kicks the old session',
    onCyber.messages.some((m) => m.t === 'kicked'),
    JSON.stringify(onCyber.messages.map((m) => m.t)))
  check('the new map welcomed the account', moved.messages[0]?.map === 'lava')

  onCyber.ws.close()
  onDesert.ws.close()
  moved.ws.close()
}

// One world, three players: practice -> live round -> spectator -> walkover win.
async function testRounds() {
  console.log('\n-- rounds --')
  await wait(300) // let the previous section's disconnects land

  const p1 = await newAccount()
  const first = await openWS(`${WS}?token=${p1.token}&map=lava`)
  await wait(200)
  const w1 = first.messages[0]
  check('a lone player gets practice mode', w1?.round?.state === 'waiting',
    w1?.round?.state)
  check('welcome states the life count', w1?.maxLives >= 1, w1?.maxLives)

  const p2 = await newAccount()
  const second = await openWS(`${WS}?token=${p2.token}&map=lava`)
  await wait(400)
  const reset = lastMsg(first.messages, 'reset')
  check('a second player starts the round', reset?.round?.state === 'live', reset?.round?.state)
  check('both players are alive', reset?.round?.alive === 2, reset?.round?.alive)

  const both = reset?.players || []
  check('everyone starts the round with full lives',
    both.length >= 2 && both.every((p) => p.lives === w1?.maxLives),
    `${JSON.stringify(both.map((p) => p.lives))} of ${w1?.maxLives}`)

  const p3 = await newAccount()
  const late = await openWS(`${WS}?token=${p3.token}&map=lava`)
  const w3 = late.messages[0]
  const self = w3?.players?.find((p) => p.id === w3.id)
  check('a mid-round join only watches', self?.spectating === true, JSON.stringify(self))
  check('spectators are not counted as alive', w3?.round?.alive === 2, w3?.round?.alive)

  second.ws.close() // walkover: the opponent disconnects
  await wait(600)
  const over = lastMsg(first.messages, 'roundOver')
  check('the last survivor wins the round', over?.winnerId === first.messages[0]?.id,
    JSON.stringify(over))
  check('a win this quick pays nothing', over?.reward === 0 && over?.tooShort === true)
  check('the client is told when the next round starts', over?.nextInMs > 0, over?.nextInMs)

  first.ws.close()
  late.ws.close()
}

// Mine wiring over the wire: who is told about a trap, and when. The damage
// paths themselves are covered by the Go tests.
async function testMines() {
  console.log('\n-- mines --')
  await wait(300)

  const owner = await newAccount()
  const enemy = await newAccount()
  const a = await openWS(`${WS}?token=${owner.token}&map=desert`)
  const b = await openWS(`${WS}?token=${enemy.token}&map=desert`)
  await wait(300)

  const welcome = a.messages[0]
  check('welcome states the mine budget',
    welcome?.mineCooldownMs > 0 && welcome?.maxMines >= 1,
    `${welcome?.mineCooldownMs}ms x${welcome?.maxMines}`)
  check('a fresh account starts with no mines', (welcome?.mines || []).length === 0)

  // Wait for the round to go live before arming anything: a round start rebuilds
  // the arena and disarms every mine, and the fresh board has no holes or
  // trampoline to refuse the cell.
  const live = await waitFor(() => lastMsg(a.messages, 'reset')?.round?.state === 'live')
  check('a round is running before we arm anything', live,
    lastMsg(a.messages, 'reset')?.round?.state)

  const me = mySnapshot(a)
  a.ws.send(JSON.stringify({ t: 'mine' }))
  await wait(400)

  const laid = lastMsg(a.messages, 'mine')
  check('the mine lands under the owner',
    laid?.x === me.x && laid?.z === me.z && laid?.level === me.level,
    `${JSON.stringify(laid)} vs cell L${me?.level} ${me?.x},${me?.z}`
      + ` (denied: ${lastMsg(a.messages, 'denied')?.reason || 'none'})`)
  check('the enemy is never told about it', !b.messages.some((m) => m.t === 'mine'),
    JSON.stringify(b.messages.map((m) => m.t)))

  a.ws.send(JSON.stringify({ t: 'mine' }))
  await wait(300)
  check('a second mine is refused right away',
    lastMsg(a.messages, 'denied')?.reason?.startsWith('mine_'),
    lastMsg(a.messages, 'denied')?.reason)

  // reconnecting must not lose track of a live trap
  const again = await openWS(`${WS}?token=${owner.token}&map=desert`)
  await wait(300)
  const restored = again.messages[0]?.mines || []
  check('a reconnect gets its own mines back',
    restored.length === 1 && restored[0].x === laid?.x && restored[0].z === laid?.z,
    JSON.stringify(restored))

  a.ws.close()
  b.ws.close()
  again.ws.close()
}

// Sits through MinRewardedRound to check the paid path end to end: opt-in,
// because it costs half a minute of waiting.
async function testPayout() {
  console.log('\n-- payout (slow) --')
  const p1 = await newAccount()
  const p2 = await newAccount()
  const winner = await openWS(`${WS}?token=${p1.token}&map=desert`)
  const loser = await openWS(`${WS}?token=${p2.token}&map=desert`)
  // the map may still be showing the previous section's result
  const live = await waitFor(() => lastMsg(winner.messages, 'reset')?.round?.state === 'live')
  check('round is live', live, lastMsg(winner.messages, 'reset')?.round?.state)

  console.log('NOTE  waiting out the minimum rewarded round (~31s)')
  await wait(31000)
  loser.ws.close()
  await wait(1000)

  const over = lastMsg(winner.messages, 'roundOver')
  check('a real round pays the winner', over?.reward === 10, JSON.stringify(over))
  const cubes = lastMsg(winner.messages, 'cubes')
  check('the new balance reaches the client', cubes?.total === 10, JSON.stringify(cubes))

  const me = await call('/api/me', { token: p1.token })
  check('cubes are persisted', me.data?.user?.cubes === 10, `cubes=${me.data?.user?.cubes}`)
  winner.ws.close()
}

async function main() {
  const account = await testAuth()
  await testCORS()
  await testAdmission(account)
  await testMaps(account)
  await testRounds()
  await testMines()
  if (process.env.SLOW) await testPayout()

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('\nsmoke run failed:', err.message)
  process.exit(1)
})
