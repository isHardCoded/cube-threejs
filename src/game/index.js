import * as THREE from 'three'
import { createEnvironment } from './environment.js'
import { createArena } from './platforms.js'
import { createMines } from './mines.js'
import { createPlayers } from './players.js'
import { createPopups } from './sprites.js'
import { createProtocol } from './protocol.js'
import { createNet } from './net.js'
import { createInput } from './input.js'
import { ensureAudio } from './sfx.js'
import { initTelegram, tg } from './telegram.js'
import { WS_BASE } from '../config/env.js'
import { t } from '../i18n/t.js'

// Boots the whole 3D game onto a canvas. onHud receives partial HUD updates
// so React can render the overlay without touching Three.js.
// onAuthLost fires when the server refuses the token or another session wins.
export function startGame({ canvas, token, mapId, onHud = () => {}, onAuthLost, onCubes }) {
  initTelegram()

  const env = createEnvironment(canvas, mapId)
  const arena = createArena(env)
  // the arena itself waits for the server layout; apply the saved day/night to
  // the sky and city right away so the scene looks right while connecting
  env.setDayMode(env.isDay())

  const players = createPlayers(env, arena)
  const mines = createMines(env.scene)
  const popups = createPopups(env.scene)

  let statusTimer = null
  function setStatus(text, autoClearMs = 0) {
    clearTimeout(statusTimer)
    onHud({ status: text })
    if (text && autoClearMs) statusTimer = setTimeout(() => setStatus(''), autoClearMs)
  }

  const protocol = createProtocol({
    env, arena, players, mines, popups, setStatus,
    onKicked: () => {
      net.dispose()
      onAuthLost?.('kicked')
    },
    onCubes,
  })

  const net = createNet({
    url: () => {
      const params = new URLSearchParams({ token })
      if (mapId) params.set('map', mapId)
      return `${WS_BASE}?${params}`
    },
    onMessage: protocol.handleMessage,
    // wipe everything; the server resends the world on reconnect
    onClose: () => {
      players.clear()
      mines.clear()
    },
    onStatus: setStatus,
    onAuthFailure: () => onAuthLost?.('rejected'),
  })

  const input = createInput({
    canvas,
    players,
    send: net.send,
  })

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
  const lastHud = {
    timer: '', timerKind: '', alive: '', banner: '', mine: '', mineReady: null, lives: null,
  }

  function resultText(r) {
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
    const { phase, round } = protocol
    let timer = ''
    let timerKind = ''
    let danger = false

    if (round.state === 'waiting') {
      timerKind = 'wait'
      timer = t('game.training', { players: round.players, min: round.minPlayers })
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

    const alive = round.state === 'live' ? `${round.alive}` : ''
    const banner = round.result ? resultText(round.result) : ''

    // ability button: countdown, or armed/out of max
    const cooling = Math.max(0, players.local.mineReadyAt - performance.now())
    const out = mines.count()
    const mineReady = cooling === 0 && out < players.local.maxMines && players.canPlay()
    const mine = cooling > 0
      ? `${Math.ceil(cooling / 1000)}`
      : `${out}/${players.local.maxMines}`

    // lives are a match thing: practice would just show a permanent 5/5
    const lives = round.state === 'live' ? (players.me()?.lives ?? null) : null

    if (timer !== lastHud.timer || timerKind !== lastHud.timerKind
      || alive !== lastHud.alive || banner !== lastHud.banner
      || mine !== lastHud.mine || mineReady !== lastHud.mineReady
      || lives !== lastHud.lives) {
      lastHud.timer = timer
      lastHud.timerKind = timerKind
      lastHud.alive = alive
      lastHud.banner = banner
      lastHud.mine = mine
      lastHud.mineReady = mineReady
      lastHud.lives = lives
      onHud({
        timer, timerKind, timerDanger: danger, alive, banner, mine, mineReady,
        lives, maxLives: players.local.maxLives,
      })
    }
  }

  function tick() {
    const dt = Math.min(clock.getDelta(), 0.05)
    const t = clock.elapsedTime

    // platforms above mine are hidden so they don't block the view of the arena;
    // while watching, the camera sits over the platform where the fight is
    const me = players.me()
    const watching = !me || me.spectating || me.gone
    const viewLevel = watching ? protocol.phase.level : me.level

    arena.update(dt, t, viewLevel)
    mines.update(dt, t, viewLevel)
    players.update(dt, viewLevel)
    updateHud()
    popups.update(dt)
    env.update(dt, t)
    env.updateCamera(dt, t, watching
      ? { x: 0, z: 0, level: viewLevel }
      : { x: me.group.position.x, z: me.group.position.z, level: me.level })
    env.render()

    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)

  return {
    setDayMode: (day) => env.setDayMode(day),
    isDay: () => env.isDay(),
    placeMine: () => input.placeMine(),
    stop() {
      cancelAnimationFrame(raf)
      clearTimeout(statusTimer)
      input.dispose()
      net.dispose()
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
