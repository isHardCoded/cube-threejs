import * as THREE from 'three'
import { NEON_MAGENTA, POOP_BROWN } from './palette.js'
import { quatForOrient } from './dice.js'
import { getStoredHatId } from './hatStore.js'
import { floorY } from './layouts.js'
import { sfx } from './sfx.js'
import { hapticError, hapticHeavy } from './telegram.js'
import { t } from '../i18n/t.js'

const POPUP_OFFSET = new THREE.Vector3(0, 1.4, 0)

// Denials that refuse something the cube already predicted. Anything else
// (a jump, a mine) predicts nothing, so rolling back would only snap the cube
// off moves that are still perfectly valid.
const PREDICTED_DENIALS = new Set(['blocked', 'cooldown', 'dash_cooldown'])

const KICK_MESSAGES = {
  another_session: 'game.otherSession',
  opponent_left: 'game.opponentLeft',
  opponent_missing: 'game.opponentMissing',
  lobby_closed: 'game.opponentLeft',
}

// Server messages -> scene state. The server is authoritative for everything;
// the client only predicts my own rolls and dashes.
export function createProtocol({
  env, arena, players: pm, mines, popups, setStatus, onKicked, onCubes,
}) {
  // destruction phase, driven by server messages; endsAt is in performance.now() time
  const phase = { mode: 'calm', level: 0, endsAt: 0 }

  // match state: waiting (practice, too few players), live (elimination), over
  const round = {
    state: 'waiting', alive: 0, players: 0, minPlayers: 2, room: 0,
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
    round.room = r.room || 0
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
    p.jelly = null
    p.combatHop = null
    p.deathAnim = null
    p.pendingDeath = null
    p.gone = false
    pm.clearHatFlight(p)
    p.group.position.set(data.x, floorY(p.level, env.theme?.arenaLift || 0) + 0.5, data.z)
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
        mines.setSkin(msg.mineSkinId)
        pm.local.dashCooldownMs = msg.dashCooldownMs || 5000
        pm.local.jumpCooldownMs = msg.jumpCooldownMs || 1200
        pm.local.mineCooldownMs = msg.mineCooldownMs || 8000
        pm.local.maxMines = msg.maxMines || 2
        pm.local.maxLives = msg.maxLives || 5
        // obstacles come from the server, so the arena is built on first welcome
        arena.build(msg.layout)
        // mines survive a reconnect: the server hands every armed mine back
        mines.clear()
        for (const m of msg.mines || []) {
          mines.add(m.level, m.x, m.z, { skinId: m.skinId, owner: m.owner })
        }
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
        // Older servers omit hatId — apply the locally equipped hat to me.
        const mine = pm.me()
        if (mine) pm.setHat(mine, getStoredHatId())
        if (mine?.spectating) setStatus(t('game.spectate'))
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
        const dx = msg.dx || 0
        const dz = msg.dz || 0
        const stomp = !!msg.stomp
        if (a) {
          a.hp = msg.hpA
          if (msg.dmgToA > 0) {
            a.flash = 1
            pm.paintPlate(a)
            popups.spawn(`-${msg.dmgToA}`, NEON_MAGENTA, a.group.position.clone().add(POPUP_OFFSET))
            pm.playBump(a, dx, dz, { sfx: false, hop: true })
          }
        }
        if (d) {
          d.hp = msg.hpD
          d.flash = 1
          pm.paintPlate(d)
          popups.spawn(`-${msg.dmgToD}`, NEON_MAGENTA, d.group.position.clone().add(POPUP_OFFSET))
          pm.playBump(d, -dx, -dz, { sfx: false, hop: true })
        }
        if (!stomp) sfx.hit()
        if (msg.a === myId() || msg.d === myId()) {
          env.addShake(stomp ? 0.34 : 0.28)
          hapticHeavy()
        }
        // a predicted step may have raced into a cell someone just occupied
        if (msg.a === myId() && pm.predictions.length > 0) pm.rollbackPrediction(pm.me())
        break
      }

      // wall / obstacle jelly — local player already played it; others see VFX only (no shake)
      case 'bump': {
        if (msg.id === myId()) break
        const p = pm.players.get(msg.id)
        if (!p) break
        pm.playBump(p, msg.dx, msg.dz, { shake: 0 })
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
          if (msg.eliminated) setStatus(t('game.eliminated'))
          else if (msg.lives == null) {
            setStatus(msg.cause === 'fall' ? t('game.fall') : t('game.destroyed'))
          }
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

      // armed mines are broadcast to everyone (own + enemy)
      case 'mine': {
        mines.add(msg.level, msg.x, msg.z, { skinId: msg.skinId, owner: msg.owner })
        if (msg.owner === myId()) {
          pm.local.mineReadyAt = performance.now() + pm.local.mineCooldownMs
          if ((msg.skinId || '') === 'poop') sfx.poopArm()
          else sfx.arm()
        }
        break
      }

      case 'mineGone':
        mines.remove(msg.level, msg.x, msg.z)
        break

      case 'mineBoom': {
        const boomSkin = msg.skinId || 'classic'
        mines.boom(msg.level, msg.x, msg.z, boomSkin)
        const victim = pm.players.get(msg.id)
        if (victim) {
          victim.hp = msg.hp
          victim.flash = 1
          pm.paintPlate(victim)
          const dmgColor = boomSkin === 'poop' ? POOP_BROWN : NEON_MAGENTA
          popups.spawn(`-${msg.dmg}`, dmgColor, victim.group.position.clone().add(POPUP_OFFSET))
        }
        if (boomSkin === 'poop') sfx.fart()
        else sfx.hit()
        const viewer = pm.me()
        if (viewer && (msg.id === myId() || viewer.level === msg.level)) env.addShake(0.3)
        if (msg.id === myId()) hapticHeavy()
        break
      }

      case 'launch': {
        const p = pm.players.get(msg.p.id)
        if (!p) { pm.addPlayer(msg.p); break }
        if (msg.p.id === myId()) {
          pm.predictions.length = 0
          // Drop client-predicted rolls that raced the trampoline — otherwise they
          // play after (or instead of) the arc and leave the die on the old floor Y.
          p.queue = p.queue.filter((m) => !m.predicted)
        }
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
        setStatus(round.state === 'live' ? t('game.roundStart') : t('game.practice'), 2500)
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

      // the room let us go: another session took the cube, or the match ended
      // because the other side never showed up
      case 'kicked':
        setStatus(t(KICK_MESSAGES[msg.reason] || 'game.matchClosed'))
        onKicked?.(msg.reason || '')
        break

      case 'denied':
        if (msg.reason?.endsWith('_cooldown') || msg.reason?.startsWith('mine_')) {
          hapticError()
          sfx.deny()
        }
        if (PREDICTED_DENIALS.has(msg.reason) && pm.predictions.length > 0) {
          pm.rollbackPrediction(pm.me())
        }
        break
    }
  }

  return { handleMessage, phase, round }
}
