import * as THREE from 'three'
import { NEON_MAGENTA } from './palette.js'
import { quatForOrient } from './dice.js'
import { levelY } from './layouts.js'
import { sfx } from './sfx.js'
import { hapticError, hapticHeavy } from './telegram.js'

const POPUP_OFFSET = new THREE.Vector3(0, 1.4, 0)

// Server messages -> scene state. The server is authoritative for everything;
// the client only predicts my own rolls and dashes.
export function createProtocol({
  env, arena, players: pm, mines, popups, setStatus, onKicked, onCubes,
}) {
  // destruction phase, driven by server messages; endsAt is in performance.now() time
  const phase = { mode: 'calm', level: 0, endsAt: 0 }

  // match state: waiting (practice, too few players), live (elimination), over
  const round = {
    state: 'waiting', alive: 0, players: 0, minPlayers: 2,
    endsAt: 0,   // intermission deadline
    result: null, // { draw, name, reward, tooShort, mine } while state === 'over'
  }

  function applyPhase(ph) {
    if (!ph) return
    phase.mode = ph.mode
    phase.level = ph.level
    phase.endsAt = ph.remainMs != null ? performance.now() + ph.remainMs : 0
  }

  function applyRound(r) {
    if (!r) return
    round.state = r.state
    round.alive = r.alive
    round.players = r.players
    round.minPlayers = r.minPlayers || 2
    round.endsAt = r.nextInMs != null ? performance.now() + r.nextInMs : 0
    if (r.state !== 'over') round.result = null
  }

  // shared by respawn and reset: put a die back on the board, alive
  function reviveInto(p, data) {
    p.dead = false
    p.spectating = false
    p.hp = data.hp
    p.lives = data.lives ?? p.lives
    p.level = data.level
    p.cell = { x: data.x, z: data.z }
    pm.syncConfirmed(p, data)
    p.queue = []
    p.anim = null
    p.deathAnim = null
    p.pendingDeath = null
    p.gone = false
    p.group.position.set(data.x, levelY(p.level) + 0.5, data.z)
    p.group.scale.set(1, 1, 1)
    const q = quatForOrient(data)
    if (q) p.group.quaternion.copy(q)
    p.spawnAnim = { t: 0 }
    pm.paintPlate(p)
  }

  function handleMessage(msg) {
    const myId = () => pm.state.myId

    switch (msg.t) {
      case 'welcome': {
        pm.state.myId = msg.id
        pm.setSkins(msg.skins) // before any cube is built
        pm.local.dashCooldownMs = msg.dashCooldownMs || 5000
        pm.local.jumpCooldownMs = msg.jumpCooldownMs || 1200
        pm.local.mineCooldownMs = msg.mineCooldownMs || 8000
        pm.local.maxMines = msg.maxMines || 2
        pm.local.maxLives = msg.maxLives || 5
        // obstacles come from the server, so the arena is built on first welcome
        arena.build(msg.layout)
        // mines survive a reconnect: the server hands mine back
        mines.clear()
        for (const m of msg.mines || []) mines.add(m.level, m.x, m.z)
        if (msg.destroyed) {
          msg.destroyed.forEach((cells, l) => {
            for (const [x, z] of cells || []) arena.destroyCellVisual(l, x, z, false)
          })
        }
        if (msg.tramps) {
          msg.tramps.forEach((tr, l) => { if (tr) arena.showTramp(l, tr[0], tr[1]) })
        }
        applyPhase(msg.phase)
        applyRound(msg.round)
        for (const pd of msg.players) pm.addPlayer(pd)
        if (pm.me()?.spectating) setStatus('РАУНД УЖЕ ИДЁТ — СМОТРИМ')
        break
      }

      case 'join':
        pm.addPlayer(msg.p)
        break

      case 'leave':
        pm.removePlayer(msg.id)
        break

      case 'move': {
        const p = pm.players.get(msg.p.id)
        if (!p) { pm.addPlayer(msg.p); break }
        pm.syncConfirmed(p, msg.p)

        if (msg.p.id === myId()) {
          if (msg.dash) pm.local.dashReadyAt = performance.now() + pm.local.dashCooldownMs
          if (msg.jump) pm.local.jumpReadyAt = performance.now() + pm.local.jumpCooldownMs

          // regular rolls/dashes were already animated by the prediction:
          // just confirm them, never enqueue the same move twice
          if (pm.predictions.length > 0 && !msg.knock && !msg.jump) {
            const pred = pm.predictions.shift()
            if (pred.x === msg.p.x && pred.z === msg.p.z) break
            pm.rollbackPrediction(p) // server disagreed: snap to its state
            break
          }
          // knockback/jump arrive unpredicted; drop stale predictions first
          if (pm.predictions.length > 0) pm.rollbackPrediction(p)
        }

        pm.enqueueMove(p, msg)
        break
      }

      case 'hit': {
        const a = pm.players.get(msg.a)
        const d = pm.players.get(msg.d)
        if (a) {
          a.hp = msg.hpA
          a.flash = 1
          pm.paintPlate(a)
          popups.spawn(`-${msg.dmgToA}`, NEON_MAGENTA, a.group.position.clone().add(POPUP_OFFSET))
        }
        if (d) {
          d.hp = msg.hpD
          d.flash = 1
          pm.paintPlate(d)
          popups.spawn(`-${msg.dmgToD}`, NEON_MAGENTA, d.group.position.clone().add(POPUP_OFFSET))
        }
        sfx.hit()
        if (msg.a === myId() || msg.d === myId()) {
          env.addShake(0.35)
          hapticHeavy()
        }
        // a predicted step may have raced into a cell someone just occupied
        if (msg.a === myId() && pm.predictions.length > 0) pm.rollbackPrediction(pm.me())
        break
      }

      case 'death': {
        const p = pm.players.get(msg.id)
        if (!p) break
        if (msg.id === myId()) pm.predictions.length = 0
        p.dead = true
        if (msg.lives != null) p.lives = msg.lives
        if (msg.eliminated) p.spectating = true
        if (msg.alive != null) round.alive = msg.alive
        const mode = msg.cause === 'fall' ? 'fall' : 'shrink'
        // let pending move animations (e.g. the jump arc off the platform)
        // play out first, otherwise the cube "falls through" its own tile
        if (p.anim || p.queue.length > 0) p.pendingDeath = mode
        else pm.startDeathAnim(p, mode)
        if (msg.id === myId()) {
          if (msg.eliminated) setStatus('ЖИЗНИ КОНЧИЛИСЬ — ДОСМАТРИВАЕМ РАУНД')
          else if (msg.lives != null) setStatus(`МИНУС ЖИЗНЬ — ОСТАЛОСЬ ${msg.lives}`)
          else setStatus(msg.cause === 'fall' ? 'ПАДЕНИЕ — РЕСПАУН...' : 'УНИЧТОЖЕН — РЕСПАУН...')
        }
        break
      }

      case 'respawn': {
        const p = pm.players.get(msg.p.id)
        if (!p) { pm.addPlayer(msg.p); break }
        if (msg.p.id === myId()) pm.predictions.length = 0
        reviveInto(p, msg.p)
        if (msg.p.id === myId()) setStatus('')
        break
      }

      case 'phase': {
        applyPhase(msg)
        if (msg.mode === 'crumble') {
          sfx.alarm()
          hapticError()
        }
        break
      }

      case 'tiles': {
        for (const [x, z] of msg.cells || []) {
          arena.destroyCellVisual(msg.level, x, z, true)
        }
        const mine = pm.me()
        if (mine && mine.level === msg.level) {
          env.addShake(0.12)
          if (Math.random() < 0.5) sfx.crumble()
        }
        break
      }

      case 'tramp':
        arena.showTramp(msg.level, msg.x, msg.z)
        break

      // only ever sent to the player who laid it
      case 'mine':
        mines.add(msg.level, msg.x, msg.z)
        pm.local.mineReadyAt = performance.now() + pm.local.mineCooldownMs
        sfx.arm()
        break

      case 'mineGone':
        mines.remove(msg.level, msg.x, msg.z)
        break

      case 'mineBoom': {
        mines.boom(msg.level, msg.x, msg.z)
        const victim = pm.players.get(msg.id)
        if (victim) {
          victim.hp = msg.hp
          victim.flash = 1
          pm.paintPlate(victim)
          popups.spawn(`-${msg.dmg}`, NEON_MAGENTA, victim.group.position.clone().add(POPUP_OFFSET))
        }
        sfx.hit()
        const viewer = pm.me()
        if (viewer && (msg.id === myId() || viewer.level === msg.level)) env.addShake(0.3)
        if (msg.id === myId()) hapticHeavy()
        break
      }

      case 'launch': {
        const p = pm.players.get(msg.p.id)
        if (!p) { pm.addPlayer(msg.p); break }
        if (msg.p.id === myId()) pm.predictions.length = 0
        pm.syncConfirmed(p, msg.p)
        // queued after the move that stepped onto the trampoline,
        // so the roll finishes first and the launch starts from the pad
        pm.enqueueMove(p, msg)
        break
      }

      case 'reset': {
        pm.predictions.length = 0
        arena.restorePlatforms()
        mines.clear() // the server disarms everything between rounds
        applyPhase(msg.phase)
        applyRound(msg.round)
        for (const pd of msg.players || []) {
          const p = pm.players.get(pd.id) || pm.addPlayer(pd)
          reviveInto(p, pd)
        }
        sfx.crumble()
        setStatus(round.state === 'live' ? 'РАУНД НАЧАЛСЯ' : 'ТРЕНИРОВКА', 2500)
        break
      }

      // the round is decided: the result stays on screen through the intermission
      case 'roundOver': {
        round.state = 'over'
        round.endsAt = performance.now() + (msg.nextInMs || 7000)
        const mine = !!msg.winnerId && msg.winnerId === myId()
        round.result = {
          draw: !!msg.draw,
          name: msg.winnerName || '',
          kills: msg.kills || 0,
          reward: msg.reward || 0,
          tooShort: !!msg.tooShort,
          mine,
        }
        setStatus('')
        if (mine) {
          sfx.launch()
          hapticHeavy()
        }
        break
      }

      // Cubes landed in the database; the menu balance can be trusted again
      case 'cubes':
        onCubes?.(msg.total)
        break

      // the account signed in somewhere else and took over the cube
      case 'kicked':
        setStatus('СЕССИЯ ОТКРЫТА В ДРУГОМ ОКНЕ')
        onKicked?.()
        break

      case 'denied':
        if (msg.reason?.endsWith('_cooldown') || msg.reason?.startsWith('mine_')) {
          hapticError()
          sfx.deny()
        }
        if ((msg.reason === 'blocked' || msg.reason === 'cooldown') && pm.predictions.length > 0) {
          pm.rollbackPrediction(pm.me())
        }
        break
    }
  }

  return { handleMessage, phase, round }
}
