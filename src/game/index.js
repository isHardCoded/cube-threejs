import * as THREE from 'three'
import { createEnvironment } from './environment.js'
import { createArena } from './platforms.js'
import { createMines } from './mines.js'
import { createPlayers } from './players.js'
import { createEnemies } from './enemies.js'
import { createPopups, setNameplateMaxHp } from './sprites.js'
import { createProtocol } from './protocol.js'
import { createNet } from './net.js'
import { createInput } from './input.js'
import { ensureAudio } from './sfx.js'
import { initTelegram, tg } from './telegram.js'
import { ARENA_HALF, HALF, setPlayHalf } from './layouts.js'
import { MAX_HP } from './dice.js'
import { createDuelRunRuntime } from './duelrun/index.js'
import { WS_BASE } from '../config/env.js'
import { t } from '../i18n/t.js'
import { startFreeRoam } from './freeRoam.js'
import { createFreeCombat } from './freeCombat.js'
import { createVoiceChat, attachMicBadge, setMicBadge } from './voiceChat.js'

// Boots the whole 3D game onto a canvas. onHud receives partial HUD updates
// so React can render the overlay without touching Three.js.
// onAuthLost fires when the server refuses the token or another session wins.
export function startGame({
  canvas, token, mapId, mode, matchId, onHud = () => {}, onAuthLost, onCubes,
  skin, hatId,
}) {
  initTelegram()

  const env = createEnvironment(canvas, mapId)
  const isDuelRun = mapId === 'duelrun' || mode === 'duel_run'
  const isFreeFight = mode === 'free' || mapId === 'freefight'
  const isArena = !isDuelRun && !isFreeFight && (mode === 'arena' || mapId === 'arena' || !!env.theme?.singleLevel)
  // Movement bounds + HP bar scale must match the map before first input.
  setPlayHalf(isArena || isDuelRun || isFreeFight ? (env.theme?.gridHalf || ARENA_HALF) : HALF)
  setNameplateMaxHp(isArena || isDuelRun ? 100 : MAX_HP)
  const arena = createArena(env)

  // Local free-roam test — no WebSocket / grid authority.
  if (mode === 'freeroam' || mapId === 'freeroam') {
    return startFreeRoam({
      canvas,
      env,
      arena,
      onHud,
      skin,
      hatId,
    })
  }

  // Flat PvE floor: show sectors immediately so a slow welcome does not leave
  // only the grass backdrop. Server layout still wins on welcome.
  if (isArena || isDuelRun) {
    arena.build([{}, {}, {}])
  }
  if (isDuelRun) {
    // Hide default square floor — Duel Run draws its own sector corridor + battle grid.
    for (const p of arena.platforms || []) {
      if (p?.group) p.group.visible = false
    }
    // Track runs +Z. Classic yaw=0 looks −Z (at the runner's back). Face down the corridor.
    env.setCameraYaw?.(180)
  }
  // the arena itself waits for the server layout; apply the saved day/night to
  // the sky and city right away so the scene looks right while connecting
  env.setDayMode(env.isDay())

  const players = createPlayers(env, arena)
  const mines = createMines(env.scene, env.theme)
  const enemies = createEnemies(env)
  const popups = createPopups(env.scene)

  let statusTimer = null
  function setStatus(text, autoClearMs = 0) {
    clearTimeout(statusTimer)
    onHud({ status: text })
    if (text && autoClearMs) statusTimer = setTimeout(() => setStatus(''), autoClearMs)
  }

  let duelRun = null
  const duelRef = { get current() { return duelRun } }
  // Forward refs filled after net exists.
  const netRef = { current: null }
  const freeCombat = createFreeCombat({
    canvas,
    env,
    arena,
    players,
    send: (msg) => netRef.current?.send(msg),
  })

  const voice = createVoiceChat({
    send: (msg) => netRef.current?.send(msg),
    getMyId: () => players.state.myId,
    getPeerIds: () => [...players.players.keys()],
  })

  voice.setPeerMic = (id, on) => {
    const p = players.players.get(id)
    if (p) {
      attachMicBadge(THREE, env.scene, p)
      setMicBadge(p, on)
      p.voiceOn = !!on
    }
    // Drive WebRTC even if the visual player row is briefly missing.
    if (id !== players.state.myId) voice.onRemoteVoice?.(id, !!on)
  }

  const protocol = createProtocol({
    env, arena, players, mines, enemies, popups, setStatus,
    initialMode: mode,
    duelRun: duelRef,
    freeCombat,
    voice,
    onHud,
    onKicked: (reason) => {
      net.dispose()
      onAuthLost?.('kicked', reason)
    },
    onCubes,
  })

  let pingShown = -1
  const net = createNet({
    url: () => {
      const params = new URLSearchParams({ token })
      if (matchId) {
        params.set('match', matchId)
      } else {
        if (mapId) params.set('map', mapId)
        params.set('mode', mode || 'training')
      }
      return `${WS_BASE}?${params}`
    },
    onMessage: protocol.handleMessage,
    // wipe everything; the server resends the world on reconnect
    onClose: () => {
      players.clear()
      mines.clear()
      enemies.clear()
      freeCombat.disable()
      pingShown = -1
      onHud({ ping: null })
    },
    onStatus: setStatus,
    onAuthFailure: () => onAuthLost?.('rejected'),
    onPing: (ping) => {
      if (ping !== pingShown) {
        pingShown = ping
        onHud({ ping })
      }
    },
  })
  netRef.current = net

  if (isDuelRun) {
    duelRun = createDuelRunRuntime({ env, players, send: net.send, onHud })
    const baseCanPlay = players.canPlay.bind(players)
    players.canPlay = () => {
      if (!baseCanPlay()) return false
      // Block speculative rolls during countdown/loading — server ignores them.
      return !!(duelRun?.fsm?.canRunnerInput?.() || duelRun?.fsm?.canBattleInput?.())
    }
    // Manual corridor: W advances +Z (server inverts classic dz). Predict the same.
    // Player cells live on p.cell / confirmedCell — never p.x/p.z (those are undefined → NaN → blue sky).
    players.predictRoll = (dx, dz) => {
      const p = players.me()
      if (!p || p.dead || p.gone) return true
      if (duelRun?.fsm?.canBattleInput?.()) {
        // Same cam yaw 180 → screen-relative invert in battle too.
        const fx = -dx
        const fz = -dz
        players.local.moveDir = [fx, fz]
        const o = players.predictions.length
          ? players.predictions[players.predictions.length - 1]
          : p.confirmedCell
        const nx = o.x + fx
        const nz = o.z + fz
        const half = env.theme?.gridHalf ?? 4
        if (nx < -half || nx > half || nz < -half || nz > half) {
          players.playBump(dx, dz)
          return false
        }
        for (const [, op] of players.players) {
          if (op !== p && !op.dead && !op.gone && op.cell.x === nx && op.cell.z === nz) {
            players.playBump(dx, dz, { hop: true })
            return true
          }
        }
        players.predictions.push({ x: nx, z: nz, at: performance.now() })
        players.enqueueMove(p, {
          predicted: true,
          p: { id: p.id, level: 0, x: nx, z: nz, top: p.orient?.top, east: p.orient?.east, south: p.orient?.south },
        })
        return true
      }
      // Screen-relative with cam yaw 180: invert both axes so WASD matches the view.
      const fx = -dx
      const fz = -dz
      // Aim chevron uses world dir (matches the roll)
      players.local.moveDir = [fx, fz]
      const o = players.predictions.length
        ? players.predictions[players.predictions.length - 1]
        : p.confirmedCell
      const nx = o.x + fx
      const nz = o.z + fz
      if (nz < 0 || nx < -1 || nx > 1) {
        players.playBump(dx, dz)
        return false
      }
      // Solid obstacles — bump client-side so we don't phase through before deny.
      if (duelRun?.track?.walkBlocked?.(nx, nz)) {
        players.playBump(dx, dz)
        return false
      }
      for (const [, op] of players.players) {
        if (op !== p && !op.dead && !op.gone && op.cell.x === nx && op.cell.z === nz) {
          players.playBump(dx, dz, { hop: true })
          return true
        }
      }
      players.predictions.push({ x: nx, z: nz, at: performance.now() })
      players.enqueueMove(p, {
        predicted: true,
        p: { id: p.id, level: 0, x: nx, z: nz, top: p.orient?.top, east: p.orient?.east, south: p.orient?.south },
      })
      return true
    }
    players.predictDash = (dx, dz) => {
      const p = players.me()
      if (!p || p.dead) return 'ok'
      const battle = !!duelRun?.fsm?.canBattleInput?.()
      // Run: screen-relative invert. Battle: same cam yaw → same invert.
      const fx = -dx
      const fz = -dz
      players.local.moveDir = [fx, fz]
      let x = p.confirmedCell.x
      let z = p.confirmedCell.z
      if (players.predictions.length) {
        const last = players.predictions[players.predictions.length - 1]
        x = last.x
        z = last.z
      }
      const half = env.theme?.gridHalf ?? 4
      let steps = 0
      for (let i = 0; i < 2; i++) {
        const nx = x + fx
        const nz = z + fz
        if (battle) {
          if (nx < -half || nx > half || nz < -half || nz > half) break
        } else if (nz < 0 || nx < -1 || nx > 1) {
          // Rails block walk/dash — only Space jump clears them
          break
        }
        if (!battle && duelRun?.track?.walkBlocked?.(nx, nz)) {
          break
        }
        x = nx
        z = nz
        steps++
      }
      if (steps === 0) {
        players.playBump(dx, dz)
        return 'wall'
      }
      players.predictions.push({ x, z, at: performance.now() })
      players.enqueueMove(p, {
        predicted: true, dash: true,
        p: { id: p.id, level: 0, x, z, ...p.orient },
      })
      return 'ok'
    }
    // Local jump arc immediately (same as waiting for server felt like a teleport
    // under duel-run prediction load). Server confirms via fromX/fromZ.
    players.predictJump = () => {
      const p = players.me()
      if (!p || p.dead || p.gone) return false
      if (duelRun?.fsm?.canBattleInput?.()) return false
      const o = players.predictions.length
        ? players.predictions[players.predictions.length - 1]
        : p.confirmedCell
      // World aim: moveDir is already cam-corrected in duel run.
      let fx = Number(players.local.moveDir?.[0]) || 0
      let fz = Number(players.local.moveDir?.[1]) || 0
      if (fx === 0 && fz === 0) { fx = 0; fz = 1 }
      // Normalize to unit step
      if (fx !== 0) { fx = Math.sign(fx); fz = 0 }
      else { fz = Math.sign(fz); fx = 0 }

      const lx = o.x + 2 * fx
      const lz = o.z + 2 * fz
      const mx = o.x + fx
      const mz = o.z + fz
      if (lz < 0 && mz < 0) {
        players.playBump(fx, fz)
        return false
      }
      // Never predict landing on an occupied cell — short-land or bump (matches server).
      let tx = lx
      let tz = lz
      const landIn = lx >= -1 && lx <= 1 && lz >= 0
      if (landIn && duelRun?.track?.walkBlocked?.(lx, lz)) {
        const midIn = mx >= -1 && mx <= 1 && mz >= 0
        if (!midIn || duelRun.track.walkBlocked(mx, mz)) {
          players.playBump(fx, fz)
          return false
        }
        tx = mx
        tz = mz
      }
      // Clear pending rolls so the leap isn't fast-forwarded away
      players.predictions.length = 0
      p.queue = p.queue.filter((m) => !m.predicted)
      p.anim = null
      p.cell = { x: o.x, z: o.z }
      const y = (env.theme?.arenaLift || 0) + 0.5
      p.group.position.set(o.x, y, o.z)

      players.predictions.push({ x: tx, z: tz, at: performance.now(), jump: true })
      players.enqueueMove(p, {
        predicted: true,
        jump: true,
        fromX: o.x,
        fromZ: o.z,
        p: {
          id: p.id, level: 0, x: tx, z: tz,
          top: p.orient?.top, east: p.orient?.east, south: p.orient?.south,
        },
      })
      return true
    }
  }

  const input = createInput({
    canvas,
    players,
    send: net.send,
  })
  // Corridor forward is +Z (cam yaw 180). Default classic aim [0,-1] points backward.
  if (isDuelRun) players.local.moveDir = [0, 1]

  // When free combat enables, block grid input.
  const _enable = freeCombat.enable.bind(freeCombat)
  freeCombat.enable = (opts) => {
    _enable(opts)
    input.setBlocked(true)
    onHud({ hideMine: true, freeCombat: true })
  }
  const _disable = freeCombat.disable.bind(freeCombat)
  freeCombat.disable = () => {
    _disable()
    input.setBlocked(false)
    onHud({ freeCombat: false })
  }

  function onVoiceKey(e) {
    if (e.repeat || e.code !== 'KeyK') return
    if (!protocol.free && !freeCombat.enabled) return
    const tag = document.activeElement?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return
    e.preventDefault()
    ensureAudio()
    voice.toggle().then((on) => {
      const me = players.me()
      if (me) {
        me.voiceOn = !!on
        attachMicBadge(THREE, env.scene, me)
        setMicBadge(me, on)
      }
      setStatus(on ? t('game.voiceOn') : t('game.voiceOff'), 1600)
    }).catch(() => {
      setStatus(t('game.voiceOff'), 1600)
    })
  }
  window.addEventListener('keydown', onVoiceKey)

  const onResize = () => env.resize()
  window.addEventListener('resize', onResize)
  tg?.onEvent?.('viewportChanged', onResize)

  // browsers unlock audio only after a user gesture
  window.addEventListener('pointerdown', ensureAudio)
  window.addEventListener('keydown', ensureAudio)
  ensureAudio()

  env.resize()
  net.connect()

  const clock = new THREE.Clock()
  let raf = 0
  let fpsFrames = 0
  let fpsWindow = 0
  let fpsShown = 0
  // Delay dropping upper floors so death/respawn does not flip group.visible
  // (that recompile hitch felt like the platform reloading).
  let stickyViewLevel = 0
  let stickyHideWait = 0
  const VIEW_HIDE_DELAY = 0.45
  let busyHoldSent = false

  const lastHud = {
    fps: 0,
    timer: '', timerKind: '', alive: '', banner: '', mine: '', mineReady: null, lives: null,
    canStart: false, hideMine: false, freeCombat: false,
  }

  function resultText(r) {
    if (r.lose || (r.arena && r.draw && !r.mine)) return t('game.arenaLose', { kills: r.kills || 0 })
    if (r.draw) return t('game.draw')
    if (r.mine) {
      if (r.tooShort) return t('game.winShort')
      return t('game.winReward', { reward: r.reward })
    }
    return t('game.winner', { name: r.name })
  }

  function secondsLeft(endsAt) {
    return Math.max(0, Math.ceil((endsAt - performance.now()) / 1000))
  }

  function updateHud() {
    const { phase, round, arena: arenaHud } = protocol
    let timer = ''
    let timerKind = ''
    let danger = false

    if (arenaHud.active && (round.state === 'live' || round.state === 'waiting')) {
      timerKind = 'calm'
      const s = arenaHud.endsAt
        ? secondsLeft(arenaHud.endsAt)
        : Math.ceil((arenaHud.surviveMs || 60000) / 1000)
      const time = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
      timer = t('game.arenaTimer', { time, kills: arenaHud.kills, goal: arenaHud.killGoal })
      danger = round.state === 'live' && s <= 10
    } else if (arenaHud.active && round.state === 'over') {
      timerKind = 'next'
      timer = t('game.nextRound', { sec: secondsLeft(round.endsAt) })
    } else if (round.state === 'waiting') {
      timerKind = 'wait'
      // PvP lobby shows fill progress; solo training is just a label — no 1/2.
      timer = round.room >= round.minPlayers
        ? t('game.lobby', { players: round.players, room: round.room })
        : t('game.practice')
    } else if (round.state === 'over') {
      timerKind = 'next'
      timer = t('game.nextRound', { sec: secondsLeft(round.endsAt) })
    } else if (phase.mode === 'calm') {
      timerKind = 'calm'
      const s = secondsLeft(phase.endsAt)
      const time = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
      timer = t('game.calm', { level: phase.level + 1, time })
    } else {
      timerKind = 'danger'
      danger = true
      timer = phase.level < 2
        ? t('game.crumble', { level: phase.level + 1 })
        : t('game.finalCrumble')
    }

    const alive = (!arenaHud.active && round.state === 'live') ? `${round.alive}` : ''
    const banner = round.result ? resultText(round.result) : ''

    // ability button: countdown, or armed/out of max
    const cooling = Math.max(0, players.local.mineReadyAt - performance.now())
    const out = mines.countOwned(players.state.myId)
    const hideMine = !!arenaHud.active || !!protocol.free
    const freeCombatHud = !!protocol.free
    const mineReady = !hideMine && cooling === 0 && out < players.local.maxMines && players.canPlay()
    const mine = hideMine
      ? ''
      : cooling > 0
        ? `${Math.ceil(cooling / 1000)}`
        : `${out}/${players.local.maxMines}`

    // lives are a match thing: practice would just show a permanent 5/5
    const lives = round.state === 'live' ? (players.me()?.lives ?? null) : null
    const canStart = !!(
      round.canStart
      && round.hostId
      && String(round.hostId) === String(players.state.myId)
    )

    if (timer !== lastHud.timer || timerKind !== lastHud.timerKind
      || alive !== lastHud.alive || banner !== lastHud.banner
      || mine !== lastHud.mine || mineReady !== lastHud.mineReady
      || lives !== lastHud.lives || canStart !== lastHud.canStart
      || hideMine !== lastHud.hideMine || freeCombatHud !== lastHud.freeCombat) {
      lastHud.timer = timer
      lastHud.timerKind = timerKind
      lastHud.alive = alive
      lastHud.banner = banner
      lastHud.mine = mine
      lastHud.mineReady = mineReady
      lastHud.lives = lives
      lastHud.canStart = canStart
      lastHud.hideMine = hideMine
      lastHud.freeCombat = freeCombatHud
      onHud({
        timer, timerKind, timerDanger: danger, alive, banner, mine, mineReady,
        lives, maxLives: players.local.maxLives, canStart, hideMine,
        freeCombat: freeCombatHud,
      })
    }
  }

  function tick() {
    const dt = Math.min(clock.getDelta(), 0.05)
    const t = clock.elapsedTime

    fpsFrames += 1
    fpsWindow += dt
    if (fpsWindow >= 0.5) {
      const nextFps = Math.round(fpsFrames / fpsWindow)
      fpsFrames = 0
      fpsWindow = 0
      if (nextFps !== fpsShown) {
        fpsShown = nextFps
        lastHud.fps = nextFps
        onHud({ fps: nextFps })
      }
    }

    // platforms above mine are hidden so they don't block the view of the arena;
    // while spectating, the camera sits over the platform where the fight is.
    // Temporary death (gone, waiting to respawn) must NOT enter spectate mode —
    // flipping floors + jungle cull with the camera jump caused a respawn hitch.
    // While a trampoline is live on my floor, keep the next floor already shown —
    // flipping that whole group visible on the first launch frame was a hitch.
    const me = players.me()
    const spectating = !me || me.spectating
    let viewLevel = spectating ? protocol.phase.level : me.level
    if (env.theme?.singleLevel) {
      viewLevel = 0
    } else if (!spectating) {
      if (me.anim?.type === 'launch' && me.anim.toLevel != null) {
        viewLevel = Math.max(viewLevel, me.anim.toLevel)
      } else if (!me.gone && me.level < 2 && arena.platforms[me.level]?.trampKey) {
        viewLevel = Math.max(viewLevel, me.level + 1)
      }
    }

    if (viewLevel > stickyViewLevel) {
      stickyViewLevel = viewLevel
      stickyHideWait = 0
    } else if (viewLevel < stickyViewLevel) {
      stickyHideWait += dt
      if (stickyHideWait >= VIEW_HIDE_DELAY) {
        stickyViewLevel = viewLevel
        stickyHideWait = 0
      }
    } else {
      stickyHideWait = 0
    }
    viewLevel = stickyViewLevel

    const busy = !!(me && (me.deathAnim || me.spawnAnim || me.pendingDeath))
    if (busy) {
      if (!busyHoldSent) {
        env.holdAdaptive?.(1.5)
        busyHoldSent = true
      }
    } else {
      busyHoldSent = false
    }

    arena.update(dt, t, viewLevel)
    mines.update(dt, t, viewLevel)
    players.update(dt, viewLevel)
    freeCombat.update(dt)
    enemies.update(dt, env.camera)
    if (duelRun) {
      duelRun.update(dt)
    } else {
      updateHud()
    }
    // Mic badges ride above nameplates
    for (const p of players.players.values()) {
      if (!p.micBadge) continue
      const show = !!p.voiceOn && !p.dead && p.group.visible
      p.micBadge.sprite.visible = show
      if (!show) continue
      const plateLift = p.hatId && p.hatId !== 'none' ? 1.45 : 1.15
      p.micBadge.sprite.position.set(
        p.group.position.x,
        p.group.position.y + plateLift + 0.42,
        p.group.position.z,
      )
    }
    popups.update(dt)
    env.update(dt, t)
    // Duel Run uses classic isometric follow (same as PvP) — the old runner
    // chase cam pointed down the thin corridor into the sky and filled the
    // frame with solid blue fog/background.
    env.updateCamera(dt, t, spectating
      ? { x: 0, z: 0, level: viewLevel, follow: isDuelRun ? 1 : 0.55, lookFollow: isDuelRun ? 1 : 0.6 }
      : {
        x: me.group.position.x,
        z: me.group.position.z,
        level: me.level,
        y: me.group.position.y - 0.5,
        follow: isDuelRun ? 1 : 0.55,
        lookFollow: isDuelRun ? 1 : 0.6,
        tight: !!protocol.free,
      })
    env.render()

    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)

  return {
    setDayMode: (day) => env.setDayMode(day),
    isDay: () => env.isDay(),
    placeMine: () => input.placeMine(),
    startMatch: () => net.send({ t: 'start' }),
    sendEmote: (emote) => freeCombat.sendEmote?.(emote),
    setCameraYaw: (deg) => env.setCameraYaw?.(deg),
    getCameraYaw: () => env.getCameraYaw?.() ?? 0,
    setCameraElev: (deg) => env.setCameraElev?.(deg),
    getCameraElev: () => env.getCameraElev?.() ?? 30,
    getLightTweaks: () => env.getLightTweaks?.() ?? null,
    setLightTweaks: (partial) => env.setLightTweaks?.(partial) ?? null,
    stop() {
      cancelAnimationFrame(raf)
      clearTimeout(statusTimer)
      duelRun?.dispose?.()
      window.removeEventListener('keydown', onVoiceKey)
      freeCombat.dispose()
      voice.dispose()
      input.dispose()
      net.dispose()
      enemies.clear()
      window.removeEventListener('resize', onResize)
      tg?.offEvent?.('viewportChanged', onResize)
      window.removeEventListener('pointerdown', ensureAudio)
      window.removeEventListener('keydown', ensureAudio)
      players.clear()
      mines.clear()
      env.dispose()
    },
  }
}
