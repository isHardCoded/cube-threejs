import * as THREE from 'three'
import { BODY_CLEARANCE, HIP_TO_SOLE, createLegs, disposeLegs, updateLegs } from './legs.js'
import { PUNCH_TIME, facingYaw } from './hands.js'
import { floorY } from './layouts.js'
import { ensureAudio } from './sfx.js'
import { sfx } from './sfx.js'

const MOVE_SPEED = 7.5
const ACCEL = 28
const FRICTION = 14
const HOP_VY = 7.0
const GRAVITY = 22
const POSE_MS = 50

const KEYS = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
}

/**
 * Continuous WASD + splash punch for networked PvP (welcome.free).
 * Replaces grid rolls while active.
 */
export function createFreeCombat({
  canvas, env, arena, players: pm, send, onSplash,
}) {
  let enabled = false
  let punchCooldownMs = 480
  let punchReadyAt = 0
  const keys = new Set()
  let vx = 0
  let vz = 0
  let hopY = 0
  let hopVy = 0
  let grounded = true
  let faceX = 0
  let faceZ = -1
  let lastPoseAt = 0
  let dragging = false
  let lastPtr = null
  const splashes = []
  const remoteTargets = new Map() // id -> { fx, fz, faceX, faceZ, level }

  function dieY(level) {
    const lift = env.theme?.arenaLift || 0
    return floorY(level, lift) + 0.5 - 0.02 + HIP_TO_SOLE + BODY_CLEARANCE
  }

  function hipY(level) {
    return dieY(level) - 0.5 + 0.02
  }

  function ensureLegs(p) {
    if (!p || p.legs) return
    const skin = pm.state.skins.get(p.group?.userData?.skinId) || { body: p.bodyMat?.color }
    // Prefer body material color from the die.
    const color = p.bodyMat?.color || '#e8d8a8'
    p.legs = createLegs(color)
    env.scene.add(p.legs)
  }

  function enable(opts = {}) {
    enabled = true
    punchCooldownMs = opts.punchCooldownMs || 480
    env.setCameraRadius?.(11)
    env.setCameraElev?.(32)
    // Soften follow so mouse orbit feels freeroam-like.
    for (const p of pm.players.values()) {
      ensureLegs(p)
      p.freeCombat = true
      p.group.rotation.order = 'YXZ'
      const fx = p.fx ?? p.cell?.x ?? 0
      const fz = p.fz ?? p.cell?.z ?? 0
      p.fx = fx
      p.fz = fz
      p.group.position.set(fx, dieY(p.level || 0), fz)
    }
  }

  function disable() {
    enabled = false
    keys.clear()
    for (const p of pm.players.values()) {
      if (p.legs) {
        env.scene.remove(p.legs)
        disposeLegs(p.legs)
        p.legs = null
      }
      p.freeCombat = false
    }
    remoteTargets.clear()
    for (const s of splashes) env.scene.remove(s.mesh)
    splashes.length = 0
  }

  function spawnSplash(fx, fz, level, radius = 1.85) {
    const y = floorY(level || 0, env.theme?.arenaLift || 0) + 0.06
    const geo = new THREE.RingGeometry(0.15, 0.35, 48)
    const mat = new THREE.MeshBasicMaterial({
      color: '#ffe08a',
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(fx, y, fz)
    env.scene.add(mesh)
    splashes.push({ mesh, mat, t: 0, life: 0.38, r0: 0.2, r1: radius })
    onSplash?.({ fx, fz, level, radius })
    sfx.hit?.()
  }

  function applyRemotePose(msg) {
    if (!enabled) return
    const me = pm.state.myId
    if (msg.id === me) {
      // Soft reconcile if server clamped us hard.
      const p = pm.me()
      if (!p || p.dead) return
      const dx = (msg.fx ?? 0) - (p.fx ?? p.group.position.x)
      const dz = (msg.fz ?? 0) - (p.fz ?? p.group.position.z)
      if (Math.hypot(dx, dz) > 1.25) {
        p.fx = msg.fx
        p.fz = msg.fz
        p.group.position.x = msg.fx
        p.group.position.z = msg.fz
      }
      return
    }
    const p = pm.players.get(msg.id)
    if (!p) return
    ensureLegs(p)
    p.freeCombat = true
    remoteTargets.set(msg.id, {
      fx: msg.fx, fz: msg.fz,
      faceX: msg.faceX ?? 0, faceZ: msg.faceZ ?? -1,
      level: msg.level ?? p.level,
    })
  }

  function applySplashHit(msg) {
    const d = pm.players.get(msg.d)
    if (d && msg.fx != null) {
      d.fx = msg.fx
      d.fz = msg.fz
      if (d.id !== pm.state.myId) {
        remoteTargets.set(d.id, {
          fx: msg.fx, fz: msg.fz,
          faceX: d.faceX, faceZ: d.faceZ,
          level: d.level,
        })
      } else {
        // Local knock from server
        d.fx = msg.fx
        d.fz = msg.fz
        d.group.position.x = msg.fx
        d.group.position.z = msg.fz
        vx *= 0.35
        vz *= 0.35
      }
    }
  }

  function onJoinPlayer(p) {
    if (!enabled || !p) return
    ensureLegs(p)
    p.freeCombat = true
    p.group.rotation.order = 'YXZ'
    const fx = p.fx ?? p.cell?.x ?? 0
    const fz = p.fz ?? p.cell?.z ?? 0
    p.fx = fx
    p.fz = fz
  }

  function wishDir() {
    let wx = 0
    let wz = 0
    for (const code of keys) {
      const d = KEYS[code]
      if (d) { wx += d[0]; wz += d[1] }
    }
    const yaw = ((env.getCameraYaw?.() ?? 0) * Math.PI) / 180
    // Camera-relative: W = into camera look on XZ.
    const cos = Math.cos(yaw)
    const sin = Math.sin(yaw)
    const rx = wx * cos + wz * sin
    const rz = -wx * sin + wz * cos
    const len = Math.hypot(rx, rz)
    if (len < 1e-6) return [0, 0]
    return [rx / len, rz / len]
  }

  function tryPunch() {
    const me = pm.me()
    if (!me || me.dead || me.gone || !pm.canPlay()) return
    const tag = document.activeElement?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return
    const now = performance.now()
    if (now < punchReadyAt) return
    if (me.punch && me.punch.t < 1) return
    punchReadyAt = now + punchCooldownMs
    const side = Math.random() < 0.5 ? -1 : 1
    me.punch = { side, t: 0, time: PUNCH_TIME }
    send({ t: 'punch' })
  }

  function onKeyDown(e) {
    if (!enabled || e.repeat) return
    ensureAudio()
    if (e.code === 'Space') {
      e.preventDefault()
      if (grounded && pm.canPlay()) {
        hopVy = HOP_VY
        grounded = false
      }
      return
    }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault()
      tryPunch()
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

  function onPointerDown(e) {
    if (!enabled) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    ensureAudio()
    dragging = true
    lastPtr = { x: e.clientX, y: e.clientY }
    try { canvas.setPointerCapture(e.pointerId) } catch { /* ignore */ }
  }

  function onPointerMove(e) {
    if (!enabled || !dragging || !lastPtr) return
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

  function update(dt) {
    if (!enabled) return

    // Splash rings
    for (let i = splashes.length - 1; i >= 0; i--) {
      const s = splashes[i]
      s.t += dt / s.life
      const u = Math.min(1, s.t)
      const r = s.r0 + (s.r1 - s.r0) * u
      s.mesh.scale.setScalar(r / 0.35)
      s.mat.opacity = 0.85 * (1 - u)
      if (u >= 1) {
        env.scene.remove(s.mesh)
        s.mesh.geometry.dispose()
        s.mat.dispose()
        splashes.splice(i, 1)
      }
    }

    // Remotes: lerp toward posed targets
    for (const [id, tgt] of remoteTargets) {
      const p = pm.players.get(id)
      if (!p || p.dead || p.gone) continue
      p.fx = p.fx ?? p.group.position.x
      p.fz = p.fz ?? p.group.position.z
      const k = Math.min(1, dt * 14)
      p.fx += (tgt.fx - p.fx) * k
      p.fz += (tgt.fz - p.fz) * k
      p.level = tgt.level ?? p.level
      p.faceDir = [tgt.faceX, tgt.faceZ]
      p.faceX = tgt.faceX
      p.faceZ = tgt.faceZ
      pm.local.moveDir // no-op keep
      const yaw = facingYaw(tgt.faceX, tgt.faceZ)
      p.group.rotation.order = 'YXZ'
      p.group.rotation.y = yaw
      p.group.rotation.x = 0
      p.group.rotation.z = 0
      p.group.position.set(p.fx, dieY(p.level) + (p.hopY || 0), p.fz)
      p.cell = { x: Math.round(p.fx), z: Math.round(p.fz) }
      if (p.legs) {
        updateLegs(p.legs, { x: p.fx, y: hipY(p.level), z: p.fz }, {
          speed: Math.hypot(tgt.fx - p.group.position.x, tgt.fz - p.group.position.z) / Math.max(dt, 1e-3),
          facingX: tgt.faceX,
          facingZ: tgt.faceZ,
          dt,
          grounded: true,
        })
      }
    }

    const me = pm.me()
    if (!me || me.dead || me.gone || me.spectating) {
      vx = 0
      vz = 0
      return
    }
    ensureLegs(me)
    me.freeCombat = true
    me.group.rotation.order = 'YXZ'

    const [wx, wz] = wishDir()
    if (wx || wz) {
      faceX = wx
      faceZ = wz
      pm.local.moveDir = [wx, wz]
      me.faceDir = [wx, wz]
    }

    if (pm.canPlay()) {
      if (wx || wz) {
        vx += wx * ACCEL * dt
        vz += wz * ACCEL * dt
      } else {
        const sp = Math.hypot(vx, vz)
        if (sp > 1e-4) {
          const f = Math.max(0, 1 - FRICTION * dt)
          vx *= f
          vz *= f
        } else {
          vx = 0
          vz = 0
        }
      }
      const sp = Math.hypot(vx, vz)
      if (sp > MOVE_SPEED) {
        vx = (vx / sp) * MOVE_SPEED
        vz = (vz / sp) * MOVE_SPEED
      }
    } else {
      vx = 0
      vz = 0
    }

    me.fx = (me.fx ?? me.group.position.x) + vx * dt
    me.fz = (me.fz ?? me.group.position.z) + vz * dt

    // Keep on playable pad roughly (server also clamps).
    const half = (env.theme?.gridHalf || 4) + 0.35
    me.fx = Math.max(-half, Math.min(half, me.fx))
    me.fz = Math.max(-half, Math.min(half, me.fz))

    if (!grounded || hopVy !== 0) {
      hopVy -= GRAVITY * dt
      hopY += hopVy * dt
      if (hopY <= 0) {
        hopY = 0
        hopVy = 0
        grounded = true
      }
    }

    const yaw = facingYaw(faceX, faceZ)
    me.group.rotation.y = yaw
    me.group.rotation.x = 0
    me.group.rotation.z = 0
    me.group.position.set(me.fx, dieY(me.level || 0) + hopY, me.fz)
    me.cell = { x: Math.round(me.fx), z: Math.round(me.fz) }
    me.faceX = faceX
    me.faceZ = faceZ

    if (me.legs) {
      updateLegs(me.legs, { x: me.fx, y: hipY(me.level || 0) + hopY, z: me.fz }, {
        speed: Math.hypot(vx, vz),
        facingX: faceX,
        facingZ: faceZ,
        dt,
        grounded,
      })
    }

    const now = performance.now()
    if (now - lastPoseAt >= POSE_MS && pm.canPlay()) {
      lastPoseAt = now
      send({
        t: 'pose',
        x: me.fx,
        z: me.fz,
        faceX,
        faceZ,
      })
    }
  }

  function handleSplashMsg(msg) {
    spawnSplash(msg.fx, msg.fz, msg.level, msg.r || 1.85)
    const p = pm.players.get(msg.id)
    if (p && !(p.punch && p.punch.t < 1)) {
      p.punch = { side: msg.side || 1, t: 0, time: PUNCH_TIME }
      if (msg.faceX != null) {
        p.faceDir = [msg.faceX, msg.faceZ]
        p.faceX = msg.faceX
        p.faceZ = msg.faceZ
      }
    }
  }

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerUp)

  function dispose() {
    disable()
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerup', onPointerUp)
    canvas.removeEventListener('pointercancel', onPointerUp)
  }

  return {
    enable,
    disable,
    update,
    dispose,
    applyRemotePose,
    applySplashHit,
    handleSplashMsg,
    onJoinPlayer,
    get enabled() { return enabled },
  }
}
