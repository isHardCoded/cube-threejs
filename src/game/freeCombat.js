import * as THREE from 'three'
import { BODY_CLEARANCE, HIP_TO_SOLE, createLegs, disposeLegs, updateLegs } from './legs.js'
import { PUNCH_TIME, facingYaw } from './hands.js'
import { createDie, DEFAULT_SKIN } from './dice.js'
import { floorY } from './layouts.js'
import { ensureAudio, sfx } from './sfx.js'

const MOVE_SPEED = 7.5
const ACCEL = 28
const FRICTION = 14
const HOP_VY = 7.0
const GRAVITY = 22
const POSE_MS = 50
const BODY_SEP = 0.95

const KEYS = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
}

/**
 * Continuous WASD + splash punch for networked PvP (welcome.free).
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
  const remoteTargets = new Map()

  function dieY(level) {
    const lift = env.theme?.arenaLift || 0
    return floorY(level, lift) + 0.5 - 0.02 + HIP_TO_SOLE + BODY_CLEARANCE
  }

  function hipY(level) {
    return dieY(level) - 0.5 + 0.02
  }

  function skinFor(p) {
    return pm.state.skins.get(p.skinId) || {
      ...DEFAULT_SKIN,
      body: p.bodyMat?.color ? `#${p.bodyMat.color.getHexString()}` : DEFAULT_SKIN.body,
    }
  }

  /** Swap pip die → toy face (same as freeroam training). */
  function ensureFaceDie(p) {
    if (!p || p.faceDie) return
    const skin = skinFor(p)
    const { group, bodyMat } = createDie(skin, { pips: false, face: true })
    group.rotation.order = 'YXZ'
    group.position.copy(p.group.position)
    group.rotation.y = p.group.rotation.y
    group.visible = p.group.visible
    group.scale.copy(p.group.scale)

    const glow = new THREE.PointLight(skin.body, p.id === pm.state.myId ? 1.8 : 1.4, 3.5)
    glow.position.y = 0.2
    group.add(glow)

    env.scene.remove(p.group)
    p.group.traverse((o) => {
      if (o === p.group) return
      // Shared dieGeo — don't dispose geometry. Materials on this instance only.
      if (o.material && o.material !== p.bodyMat) o.material.dispose?.()
    })
    p.bodyMat?.dispose?.()

    env.scene.add(group)
    p.group = group
    p.bodyMat = bodyMat
    p.faceDie = true
  }

  function ensureLegs(p) {
    if (!p || p.legs || p.dead || p.gone) return
    const color = p.bodyMat?.color || '#e8d8a8'
    p.legs = createLegs(color)
    env.scene.add(p.legs)
  }

  function hideLegs(p) {
    if (p?.legs) p.legs.visible = false
  }

  function showLegs(p) {
    if (p?.legs && !p.dead && !p.gone) p.legs.visible = true
  }

  function dropLegs(p) {
    if (!p?.legs) return
    env.scene.remove(p.legs)
    disposeLegs(p.legs)
    p.legs = null
  }

  function syncLegsVisibility(p) {
    if (!p?.legs) return
    const show = !p.dead && !p.gone && !p.spectating && p.group.visible && !p.deathAnim
    p.legs.visible = show
  }

  function enable(opts = {}) {
    enabled = true
    punchCooldownMs = opts.punchCooldownMs || 480
    env.setCameraRadius?.(11)
    env.setCameraElev?.(32)
    for (const p of pm.players.values()) {
      p.freeCombat = true
      ensureFaceDie(p)
      ensureLegs(p)
      p.group.rotation.order = 'YXZ'
      const fx = p.fx ?? p.cell?.x ?? 0
      const fz = p.fz ?? p.cell?.z ?? 0
      p.fx = fx
      p.fz = fz
      p.group.position.set(fx, dieY(p.level || 0), fz)
      syncLegsVisibility(p)
    }
  }

  function disable() {
    enabled = false
    keys.clear()
    for (const p of pm.players.values()) {
      dropLegs(p)
      p.freeCombat = false
    }
    remoteTargets.clear()
    for (const s of splashes) disposeSplash(s)
    splashes.length = 0
  }

  function disposeSplash(s) {
    env.scene.remove(s.root)
    s.root.traverse((o) => {
      o.geometry?.dispose?.()
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose?.())
        else o.material.dispose?.()
      }
    })
  }

  /** 3D shockwave: stacked tori that expand, rise, and spin around the cube. */
  function spawnSplash(fx, fz, level, radius = 1.85, followId = null) {
    const baseY = dieY(level || 0)
    const root = new THREE.Group()
    root.position.set(fx, baseY, fz)
    env.scene.add(root)

    const rings = []
    const colors = ['#ffe08a', '#ff9f43', '#fff6c8']
    for (let i = 0; i < 3; i++) {
      const tube = 0.045 - i * 0.008
      const geo = new THREE.TorusGeometry(0.35, tube, 10, 48)
      const mat = new THREE.MeshStandardMaterial({
        color: colors[i],
        emissive: colors[i],
        emissiveIntensity: 1.4 - i * 0.25,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        roughness: 0.35,
        metalness: 0.15,
        toneMapped: false,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.rotation.x = Math.PI / 2
      mesh.position.y = 0.05 + i * 0.12
      mesh.userData.baseY = mesh.position.y
      root.add(mesh)
      rings.push({ mesh, mat, delay: i * 0.05, spin: (i % 2 === 0 ? 1 : -1) * (4.5 - i) })
    }

    splashes.push({
      root, rings, t: 0, life: 0.55,
      r0: 0.35, r1: radius * 1.05,
      y0: 0, y1: 0.85,
      followId,
      level: level || 0,
    })
    onSplash?.({ fx, fz, level, radius })
    sfx.hit?.()
  }

  function updateSplashes(dt) {
    for (let i = splashes.length - 1; i >= 0; i--) {
      const s = splashes[i]
      // Stick to the punching cube so a sprint doesn't leave the wave behind.
      if (s.followId) {
        const p = pm.players.get(s.followId)
        if (p && !p.gone) {
          s.root.position.x = p.group.position.x
          s.root.position.z = p.group.position.z
          s.root.position.y = p.group.position.y
        }
      }
      s.t += dt / s.life
      const u = Math.min(1, s.t)
      for (const ring of s.rings) {
        const local = Math.max(0, Math.min(1, (u - (ring.delay || 0)) / (1 - (ring.delay || 0) + 1e-6)))
        const e = 1 - (1 - local) * (1 - local)
        const r = s.r0 + (s.r1 - s.r0) * e
        const scale = r / 0.35
        ring.mesh.scale.setScalar(scale)
        const baseY = ring.mesh.userData.baseY || 0
        ring.mesh.position.y = baseY + (s.y1 - s.y0) * e
        ring.mesh.rotation.z += dt * (ring.spin || 0)
        ring.mat.opacity = 0.95 * (1 - e)
        if (ring.mat.emissiveIntensity != null) {
          ring.mat.emissiveIntensity = 1.4 * (1 - e * 0.7)
        }
      }
      if (u >= 1) {
        disposeSplash(s)
        splashes.splice(i, 1)
      }
    }
  }

  /** Push `pos` out of other living cubes. */
  function separateFromOthers(selfId, x, z, level) {
    let fx = x
    let fz = z
    for (const o of pm.players.values()) {
      if (o.id === selfId || o.dead || o.gone || o.spectating) continue
      if ((o.level || 0) !== (level || 0)) continue
      const ox = o.fx ?? o.group.position.x
      const oz = o.fz ?? o.group.position.z
      let dx = fx - ox
      let dz = fz - oz
      let d = Math.hypot(dx, dz)
      if (d < 1e-4) {
        dx = 1
        dz = 0
        d = 1
      }
      if (d < BODY_SEP) {
        const push = (BODY_SEP - d) / d
        fx += dx * push
        fz += dz * push
      }
    }
    return [fx, fz]
  }

  function applyRemotePose(msg) {
    if (!enabled) return
    const me = pm.state.myId
    if (msg.id === me) {
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
    p.freeCombat = true
    ensureFaceDie(p)
    ensureLegs(p)
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
    p.freeCombat = true
    ensureFaceDie(p)
    ensureLegs(p)
    p.group.rotation.order = 'YXZ'
    const fx = p.fx ?? p.cell?.x ?? 0
    const fz = p.fz ?? p.cell?.z ?? 0
    p.fx = fx
    p.fz = fz
  }

  /** Same camera-relative wish as freeroam training. */
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

  function smoothYaw(group, targetYaw, dt) {
    let dyaw = targetYaw - group.rotation.y
    while (dyaw > Math.PI) dyaw -= Math.PI * 2
    while (dyaw < -Math.PI) dyaw += Math.PI * 2
    group.rotation.y += dyaw * Math.min(1, dt * 12)
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

    updateSplashes(dt)

    // Keep legs in sync with death / visibility for everyone.
    for (const p of pm.players.values()) {
      if (!p.freeCombat) continue
      syncLegsVisibility(p)
      if ((p.dead || p.gone) && p.legs) hideLegs(p)
    }

    // Remotes
    for (const [id, tgt] of remoteTargets) {
      const p = pm.players.get(id)
      if (!p || p.dead || p.gone) {
        hideLegs(p)
        continue
      }
      ensureFaceDie(p)
      ensureLegs(p)
      showLegs(p)
      p.fx = p.fx ?? p.group.position.x
      p.fz = p.fz ?? p.group.position.z
      const k = Math.min(1, dt * 14)
      p.fx += (tgt.fx - p.fx) * k
      p.fz += (tgt.fz - p.fz) * k
      ;[p.fx, p.fz] = separateFromOthers(p.id, p.fx, p.fz, tgt.level ?? p.level)
      p.level = tgt.level ?? p.level
      p.faceDir = [tgt.faceX, tgt.faceZ]
      p.faceX += (tgt.faceX - p.faceX) * Math.min(1, dt * 12)
      p.faceZ += (tgt.faceZ - p.faceZ) * Math.min(1, dt * 12)
      p.group.rotation.order = 'YXZ'
      smoothYaw(p.group, facingYaw(p.faceX, p.faceZ), dt)
      p.group.rotation.x = 0
      p.group.rotation.z = 0
      p.group.position.set(p.fx, dieY(p.level), p.fz)
      p.cell = { x: Math.round(p.fx), z: Math.round(p.fz) }
      if (p.legs?.visible) {
        updateLegs(p.legs, { x: p.fx, y: hipY(p.level), z: p.fz }, {
          speed: Math.hypot(tgt.fx - p.fx, tgt.fz - p.fz) / Math.max(dt, 1e-3),
          facingX: p.faceX,
          facingZ: p.faceZ,
          dt,
          grounded: true,
        })
      }
    }

    const me = pm.me()
    if (!me || me.dead || me.gone || me.spectating) {
      vx = 0
      vz = 0
      if (me) hideLegs(me)
      return
    }
    ensureFaceDie(me)
    ensureLegs(me)
    showLegs(me)
    me.freeCombat = true
    me.group.rotation.order = 'YXZ'

    const [wx, wz] = wishDir()
    if (wx || wz) {
      faceX += (wx - faceX) * Math.min(1, dt * 12)
      faceZ += (wz - faceZ) * Math.min(1, dt * 12)
      pm.local.moveDir = [wx, wz]
      me.faceDir = [faceX, faceZ]
    }

    if (pm.canPlay()) {
      if (wx || wz) {
        vx += wx * ACCEL * dt
        vz += wz * ACCEL * dt
      } else {
        const damp = Math.exp(-FRICTION * dt)
        vx *= damp
        vz *= damp
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
    ;[me.fx, me.fz] = separateFromOthers(me.id, me.fx, me.fz, me.level || 0)

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

    const spd = Math.hypot(vx, vz)
    smoothYaw(me.group, facingYaw(faceX, faceZ), dt)
    const leanPitch = grounded && spd > 0.4 ? -Math.min(0.16, spd * 0.018) : 0
    me.group.rotation.x = THREE.MathUtils.lerp(me.group.rotation.x, leanPitch, Math.min(1, dt * 10))
    me.group.rotation.z = THREE.MathUtils.lerp(me.group.rotation.z, 0, Math.min(1, dt * 10))

    const walkBob = grounded && spd > 0.4
      ? Math.abs(Math.sin((me.legs?.userData?.phase || 0) * 2)) * 0.04
      : 0
    me.group.position.set(me.fx, dieY(me.level || 0) + hopY + walkBob, me.fz)
    me.cell = { x: Math.round(me.fx), z: Math.round(me.fz) }
    me.faceX = faceX
    me.faceZ = faceZ

    if (me.legs?.visible) {
      updateLegs(me.legs, { x: me.fx, y: hipY(me.level || 0) + hopY, z: me.fz }, {
        speed: spd,
        facingX: faceX,
        facingZ: faceZ,
        dt,
        grounded,
      })
    }

    const now = performance.now()
    if (now - lastPoseAt >= POSE_MS && pm.canPlay()) {
      lastPoseAt = now
      send({ t: 'pose', x: me.fx, z: me.fz, faceX, faceZ })
    }
  }

  function handleSplashMsg(msg) {
    spawnSplash(msg.fx, msg.fz, msg.level, msg.r || 1.85, msg.id)
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
