import * as THREE from 'three'
import { NEON_MAGENTA, POOP_BROWN } from './palette.js'
import { quatForOrient } from './dice.js'
import { getStoredHatId } from './hatStore.js'
import { floorY, setPlayHalf } from './layouts.js'
import { setNameplateMaxHp } from './sprites.js'
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
  env, arena, players: pm, mines, enemies, popups, setStatus, onKicked, onCubes,
  initialMode = '',
  duelRun = null,
}) {
  // destruction phase, driven by server messages; endsAt is in performance.now() time
  const phase = { mode: 'calm', level: 0, endsAt: 0 }

  // match state: waiting (practice, too few players), live (elimination), over
  const round = {
    state: 'waiting', alive: 0, players: 0, minPlayers: 2, room: 0,
    hostId: 0, canStart: false,
    endsAt: 0,   // intermission deadline
    result: null, // { draw, name, reward, tooShort, mine, lose } while state === 'over'
  }

  const arenaState = {
    active: initialMode === 'arena',
    kills: 0,
    killGoal: 100,
    endsAt: 0,
    surviveMs: 60000,
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
    round.hostId = r.hostId || 0
    round.canStart = !!r.canStart
    round.endsAt = r.nextInMs != null ? performance.now() + r.nextInMs : 0
    if (r.state !== 'over') round.result = null
  }

  function applyArena(a) {
    if (!a) return
    arenaState.active = true
    arenaState.kills = a.kills ?? arenaState.kills
    arenaState.killGoal = a.killGoal ?? arenaState.killGoal
    if (a.surviveMs != null) arenaState.surviveMs = a.surviveMs
    if (a.remainMs != null) arenaState.endsAt = performance.now() + a.remainMs
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

    // Duel Run owns its own protocol surface.
    const dr = duelRun?.current || duelRun
    if (dr && typeof msg?.t === 'string' && (msg.t.startsWith('dr_') || (msg.t === 'welcome' && (msg.mode === 'duel_run' || msg.dr)))) {
      if (msg.t === 'welcome') {
        pm.state.myId = msg.id
        pm.setSkins(msg.skins)
        mines.setSkin(msg.mineSkinId)
        pm.local.maxLives = msg.maxLives || 3
        pm.local.dashCooldownMs = msg.dashCooldownMs || 5000
        pm.local.jumpCooldownMs = msg.jumpCooldownMs || 1200
        pm.local.mineCooldownMs = msg.mineCooldownMs || 8000
        pm.local.maxMines = msg.maxMines || 2
        if (msg.maxHp != null) setNameplateMaxHp(msg.maxHp)
        arena.build([{}, {}, {}])
        for (const pd of msg.players || []) pm.addPlayer(pd)
        const mine = pm.me()
        if (mine) pm.setHat(mine, getStoredHatId())
      }
      if (msg.t === 'join') pm.addPlayer(msg.p)
      if (msg.t === 'leave') pm.removePlayer(msg.id)
      if (msg.t === 'kicked') {
        setStatus(t(KICK_MESSAGES[msg.reason] || 'game.matchClosed'))
        onKicked?.(msg.reason || '')
        return
      }
      if (msg.t === 'cubes') {
        onCubes?.(msg.total)
        return
      }
      if (dr.handleMessage?.(msg)) return
      if (msg.t.startsWith('dr_')) return
    }

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
        arenaState.active = msg.mode === 'arena' || arenaState.active
        if (msg.half != null) setPlayHalf(msg.half)
        if (msg.maxHp != null) setNameplateMaxHp(msg.maxHp)
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
        applyArena(msg.arena)
        enemies?.clear()
        for (const mob of msg.mobs || []) enemies?.spawn(mob)
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

      case 'round':
        applyRound(msg.round)
        break

      case 'move': {
        const p = pm.players.get(msg.p.id)
        if (!p) { pm.addPlayer(msg.p); break }
        const liftY = floorY(p.level || 0, env.theme?.arenaLift || 0) + 0.5

        if (msg.p.id === myId()) {
          if (msg.dash) pm.local.dashReadyAt = performance.now() + pm.local.dashCooldownMs
          if (msg.jump) pm.local.jumpReadyAt = performance.now() + pm.local.jumpCooldownMs

          // Jump: never rollback onto the landing (that killed the arc). Prefer
          // server fromX/fromZ; if we already predicted this leap, just confirm.
          if (msg.jump) {
            pm.syncConfirmed(p, msg.p)
            if (pm.predictions.length > 0) {
              const pred = pm.predictions[0]
              if (pred.jump && pred.x === msg.p.x && pred.z === msg.p.z) {
                pm.predictions.shift()
                break
              }
              pm.predictions.length = 0
              p.queue = p.queue.filter((m) => !m.predicted)
            }
            const ox = msg.fromX != null ? msg.fromX : p.cell.x
            const oz = msg.fromZ != null ? msg.fromZ : p.cell.z
            p.anim = null
            p.cell = { x: ox, z: oz }
            p.group.position.set(ox, liftY, oz)
            pm.enqueueMove(p, msg)
            break
          }

          pm.syncConfirmed(p, msg.p)
          if (pm.predictions.length > 0 && !msg.knock) {
            const pred = pm.predictions.shift()
            if (pred.x === msg.p.x && pred.z === msg.p.z) break
            pm.rollbackPrediction(p)
            break
          }
          if (pm.predictions.length > 0) pm.rollbackPrediction(p)
        } else {
          if (msg.jump) {
            const ox = msg.fromX != null ? msg.fromX : p.confirmedCell.x
            const oz = msg.fromZ != null ? msg.fromZ : p.confirmedCell.z
            p.cell = { x: ox, z: oz }
            p.group.position.set(ox, liftY, oz)
          }
          pm.syncConfirmed(p, msg.p)
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
        enemies?.clear()
        for (const mob of msg.mobs || []) enemies?.spawn(mob)
        applyPhase(msg.phase)
        applyRound(msg.round)
        applyArena(msg.arena)
        for (const pd of msg.players || []) {
          const p = pm.players.get(pd.id) || pm.addPlayer(pd)
          reviveInto(p, pd)
        }
        sfx.crumble()
        setStatus(
          arenaState.active
            ? t('game.arenaStart')
            : (round.state === 'live' ? t('game.roundStart') : t('game.practice')),
          2500,
        )
        break
      }

      // the round is decided: the result stays on screen through the intermission
      case 'roundOver': {
        round.state = 'over'
        round.endsAt = performance.now() + (msg.nextInMs || 7000)
        const mine = !!msg.winnerId && msg.winnerId === myId()
        round.result = {
          draw: !!msg.draw,
          lose: !!msg.lose,
          name: msg.winnerName || '',
          kills: msg.kills || 0,
          reward: msg.reward || 0,
          tooShort: !!msg.tooShort,
          mine,
          arena: msg.mode === 'arena',
        }
        setStatus('')
        if (mine) {
          sfx.launch()
          hapticHeavy()
        }
        break
      }

      case 'arena':
        applyArena(msg.arena)
        break

      case 'mobSpawn':
        enemies?.spawn(msg.mob)
        break

      case 'mobMove':
        enemies?.move(
          msg.id, msg.x, msg.z,
          (msg.top != null) ? { top: msg.top, east: msg.east, south: msg.south } : null,
          msg.dx || 0, msg.dz || 0,
        )
        break

      case 'mobHit': {
        if (msg.hp != null) enemies?.setHp(msg.id, msg.hp)
        const orient = (msg.top != null)
          ? { top: msg.top, east: msg.east, south: msg.south }
          : null
        if (msg.knock && msg.x != null && msg.z != null) {
          enemies?.move(msg.id, msg.x, msg.z, orient, msg.dx || 0, msg.dz || 0, { knock: true })
        } else if (orient) {
          enemies?.setOrient(msg.id, orient)
        }
        const me = pm.me()
        if (me && msg.playerId === myId() && msg.playerHp != null) {
          me.hp = msg.playerHp
          pm.paintPlate(me)
          if (msg.dmgToPlayer > 0) {
            me.flash = 1
            popups.spawn(`-${msg.dmgToPlayer}`, NEON_MAGENTA, me.group.position.clone().add(POPUP_OFFSET))
            pm.playBump(me, msg.dx || 0, msg.dz || 0, { sfx: false, hop: true })
            env.addShake(0.22)
            hapticHeavy()
          }
        }
        if (msg.dmgToMob > 0) {
          const e = enemies?.enemies.get(msg.id)
          if (e) {
            popups.spawn(`-${msg.dmgToMob}`, NEON_MAGENTA, e.group.position.clone().add(POPUP_OFFSET))
          }
          sfx.hit()
        }
        if (msg.playerId === myId() && pm.predictions.length > 0) pm.rollbackPrediction(pm.me())
        break
      }

      case 'mobDie':
        enemies?.kill(msg.id)
        if (msg.kills != null) arenaState.kills = msg.kills
        sfx.crumble()
        break

      case 'mobsClear':
        enemies?.clear()
        break

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

      default:
        break
    }
  }

  return { handleMessage, phase, round, arena: arenaState }
}
