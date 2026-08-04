import * as THREE from 'three'
import { DEFAULT_SKIN, createDie, setDieEmotion, EMOTE_MS } from './dice.js'
import { createHat, disposeHat, HAT_BASE_Y, HAT_BOB_AMP, HAT_BOB_SPEED } from './hats.js'
import { createHands, disposeHands, updateHands, PUNCH_TIME, facingYaw } from './hands.js'
import {
  BODY_CLEARANCE, HIP_TO_SOLE, createLegs, disposeLegs, updateLegs,
} from './legs.js'
import { ensureAudio } from './sfx.js'
import { initTelegram, tg } from './telegram.js'
import { t } from '../i18n/t.js'

const MOVE_SPEED = 7.8
const ACCEL = 18
const FRICTION = 10
const HOP_VY = 7.2
const GRAVITY = 22
// Floor ≈ y=0; lift die so sole bottoms land on the grass (not through it).
// hipAnchor = DIE_Y - 0.5 + 0.02; sole = hipAnchor - HIP_TO_SOLE.
const DIE_Y = 0.5 - 0.02 + HIP_TO_SOLE + BODY_CLEARANCE

const KEYS = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
}

/**
 * Local free-roam sandbox: continuous WASD, mouse-orbit camera, no WebSocket.
 */
export function startFreeRoam({
  canvas, env, arena, onHud = () => {}, skin = DEFAULT_SKIN, hatId = 'none',
}) {
  const playRadius = env.theme?.playRadius || 14
  const s = { ...DEFAULT_SKIN, ...skin }

  arena.build([{}, {}, {}])
  env.setDayMode(env.isDay())
  env.setCameraRadius?.(12)
  env.setCameraElev?.(28)

  const { group, bodyMat } = createDie(s, { pips: false, face: true })
  group.rotation.order = 'YXZ'
  group.position.set(0, DIE_Y, 0)
  const glow = new THREE.PointLight(s.body, 1.6, 3.5)
  glow.position.y = 0.2
  group.add(glow)
  env.scene.add(group)

  let hat = createHat(hatId)
  env.scene.add(hat)

  const hands = createHands(s)
  env.scene.add(hands)

  const legs = createLegs(s)
  env.scene.add(legs)

  const keys = new Set()
  let vx = 0
  let vz = 0
  let hopY = 0
  let hopVy = 0
  let grounded = true
  let faceX = 0
  let faceZ = -1
  let punch = null
  let handPhase = Math.random() * Math.PI * 2
  let hatPhase = Math.random() * Math.PI * 2

  let dragging = false
  let lastPtr = null

  function onKeyDown(e) {
    if (e.repeat) return
    ensureAudio()
    if (e.code === 'Space') {
      e.preventDefault()
      if (grounded) {
        hopVy = HOP_VY
        grounded = false
      }
      return
    }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault()
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return
      if (punch && punch.t < 1) return
      punch = { side: Math.random() < 0.5 ? -1 : 1, t: 0, time: PUNCH_TIME }
      return
    }
    if (KEYS[e.code]) {
      e.preventDefault()
      keys.add(e.code)
    }
  }

  function onKeyUp(e) {
    keys.delete(e.code)
  }

  function clearMovementKeys() {
    keys.clear()
    vx = 0
    vz = 0
  }

  function onWindowBlur() {
    clearMovementKeys()
  }

  function onVisibilityChange() {
    if (document.hidden) clearMovementKeys()
  }

  function onPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    ensureAudio()
    dragging = true
    lastPtr = { x: e.clientX, y: e.clientY }
    try { canvas.setPointerCapture(e.pointerId) } catch { /* ignore */ }
  }

  function onPointerMove(e) {
    if (!dragging || !lastPtr) return
    const dx = e.clientX - lastPtr.x
    const dy = e.clientY - lastPtr.y
    lastPtr = { x: e.clientX, y: e.clientY }
    env.setCameraYaw((env.getCameraYaw?.() ?? 0) - dx * 0.22)
    env.setCameraElev((env.getCameraElev?.() ?? 30) + dy * 0.16)
  }

  function onPointerUp(e) {
    dragging = false
    lastPtr = null
    try { canvas.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
  }

  function onWheel(e) {
    e.preventDefault()
    const r = env.getCameraRadius?.() ?? 12
    env.setCameraRadius?.(r + Math.sign(e.deltaY) * 0.85)
  }

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onWindowBlur)
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('pointerdown', ensureAudio)
  window.addEventListener('keydown', ensureAudio)
  const onResize = () => env.resize()
  window.addEventListener('resize', onResize)
  tg?.onEvent?.('viewportChanged', onResize)
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerUp)
  canvas.addEventListener('wheel', onWheel, { passive: false })
  env.resize()
  ensureAudio()

  onHud({
    status: t('game.freeroam'),
    timer: '',
    timerKind: '',
    alive: '',
    banner: '',
    mine: '',
    mineReady: false,
    hideMine: true,
    canStart: false,
    ping: null,
    freeCombat: true,
  })

  let emoteTimer = 0
  function sendEmote(emote) {
    setDieEmotion(group, emote)
    clearTimeout(emoteTimer)
    emoteTimer = window.setTimeout(() => setDieEmotion(group, 'happy'), EMOTE_MS)
  }

  const clock = new THREE.Clock()
  let raf = 0
  let fpsFrames = 0
  let fpsWindow = 0
  let fpsShown = 0

  function wishDir() {
    let ix = 0
    let iz = 0
    for (const code of keys) {
      const d = KEYS[code]
      if (!d) continue
      ix += d[0]
      iz += d[1]
    }
    if (ix === 0 && iz === 0) return [0, 0]
    const yaw = ((env.getCameraYaw?.() ?? 0) * Math.PI) / 180
    const forwardX = -Math.sin(yaw)
    const forwardZ = -Math.cos(yaw)
    const rightX = Math.cos(yaw)
    const rightZ = -Math.sin(yaw)
    let wx = forwardX * -iz + rightX * ix
    let wz = forwardZ * -iz + rightZ * ix
    const len = Math.hypot(wx, wz) || 1
    return [wx / len, wz / len]
  }

  function tick() {
    const dt = Math.min(clock.getDelta(), 0.05)
    const t = clock.elapsedTime

    fpsFrames += 1
    fpsWindow += dt
    if (fpsWindow >= 0.5) {
      const next = Math.round(fpsFrames / fpsWindow)
      fpsFrames = 0
      fpsWindow = 0
      if (next !== fpsShown) {
        fpsShown = next
        onHud({ fps: next })
      }
    }

    const [wx, wz] = wishDir()
    if (wx || wz) {
      faceX += (wx - faceX) * Math.min(1, dt * 9)
      faceZ += (wz - faceZ) * Math.min(1, dt * 9)
      const fl = Math.hypot(faceX, faceZ) || 1
      faceX /= fl
      faceZ /= fl
    }
    {
      const tx = wx * MOVE_SPEED
      const tz = wz * MOVE_SPEED
      const rate = (wx || wz) ? ACCEL : FRICTION
      const k = 1 - Math.exp(-rate * dt)
      vx += (tx - vx) * k
      vz += (tz - vz) * k
      if (!(wx || wz) && Math.hypot(vx, vz) < 0.08) {
        vx = 0
        vz = 0
      }
    }

    const spd = Math.hypot(vx, vz)

    group.position.x += vx * dt
    group.position.z += vz * dt

    const r = Math.hypot(group.position.x, group.position.z)
    if (r > playRadius) {
      const k = playRadius / r
      group.position.x *= k
      group.position.z *= k
      const nx = group.position.x / playRadius
      const nz = group.position.z / playRadius
      const push = vx * nx + vz * nz
      if (push > 0) {
        vx -= nx * push
        vz -= nz * push
      }
    }

    if (!grounded || hopVy !== 0) {
      hopVy -= GRAVITY * dt
      hopY += hopVy * dt
      if (hopY <= 0) {
        hopY = 0
        hopVy = 0
        grounded = true
      }
    }

    const walkBob = grounded && spd > 0.35
      ? Math.abs(Math.sin(legs.userData.phase || 0)) * (0.045 + Math.min(spd, 8) * 0.004)
      : 0
    group.position.y = DIE_Y + hopY + walkBob

    // Turn the cube (and its face) toward move / look direction.
    const targetYaw = facingYaw(faceX, faceZ)
    let dyaw = targetYaw - group.rotation.y
    while (dyaw > Math.PI) dyaw -= Math.PI * 2
    while (dyaw < -Math.PI) dyaw += Math.PI * 2
    group.rotation.y += dyaw * Math.min(1, dt * 9)

    // Lean in local space (YXZ): pitch forward + soft strafe roll.
    const leanPitch = grounded && spd > 0.35
      ? -Math.min(0.22, spd * 0.026)
      : 0
    const leanRoll = grounded && spd > 0.35
      ? THREE.MathUtils.clamp((-vx * faceZ + vz * faceX) * 0.035, -0.12, 0.12)
      : 0
    group.rotation.x = THREE.MathUtils.lerp(group.rotation.x, leanPitch, Math.min(1, dt * 8))
    group.rotation.z = THREE.MathUtils.lerp(group.rotation.z, leanRoll, Math.min(1, dt * 8))

    // Hips under the die bottom face.
    updateLegs(legs, {
      x: group.position.x,
      y: group.position.y - 0.5 + 0.02,
      z: group.position.z,
    }, {
      speed: spd,
      facingX: faceX,
      facingZ: faceZ,
      dt,
      grounded,
    })

    if (hat) {
      const bob = Math.sin(t * HAT_BOB_SPEED + hatPhase) * HAT_BOB_AMP
      const show = hat.userData.hatId && hat.userData.hatId !== 'none'
      hat.visible = !!show
      if (show) {
        hat.position.set(group.position.x, group.position.y + HAT_BASE_Y + bob, group.position.z)
        hat.quaternion.identity()
        hat.scale.copy(group.scale)
      }
    }

    if (punch) {
      punch.t += dt / punch.time
      if (punch.t >= 1) punch = null
    }
    updateHands(hands, {
      x: group.position.x,
      y: group.position.y,
      z: group.position.z,
    }, {
      t,
      phase: handPhase,
      scale: group.scale,
      visible: true,
      facingX: faceX,
      facingZ: faceZ,
      punch,
      walkSpeed: spd,
      walkPhase: legs.userData.phase || 0,
      dt,
    })

    arena.update?.(dt, t, 0)
    env.update(dt, t)
    env.updateCamera(dt, t, {
      x: group.position.x,
      z: group.position.z,
      y: group.position.y - 0.5,
      level: 0,
      tight: true,
    })
    env.render()
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)

  return {
    setDayMode: (day) => env.setDayMode(day),
    isDay: () => env.isDay(),
    placeMine: () => {},
    startMatch: () => {},
    sendEmote,
    setCameraYaw: (deg) => env.setCameraYaw?.(deg),
    getCameraYaw: () => env.getCameraYaw?.() ?? 0,
    setCameraElev: (deg) => env.setCameraElev?.(deg),
    getCameraElev: () => env.getCameraElev?.() ?? 30,
    getLightTweaks: () => env.getLightTweaks?.() ?? null,
    setLightTweaks: (partial) => env.setLightTweaks?.(partial) ?? null,
    stop() {
      cancelAnimationFrame(raf)
      clearTimeout(emoteTimer)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onWindowBlur)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pointerdown', ensureAudio)
      window.removeEventListener('keydown', ensureAudio)
      window.removeEventListener('resize', onResize)
      tg?.offEvent?.('viewportChanged', onResize)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('wheel', onWheel)
      env.scene.remove(group)
      bodyMat?.dispose?.()
      if (hat) {
        env.scene.remove(hat)
        disposeHat(hat)
      }
      env.scene.remove(hands)
      disposeHands(hands)
      env.scene.remove(legs)
      disposeLegs(legs)
      env.dispose()
    },
  }
}
