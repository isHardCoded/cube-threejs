import * as THREE from 'three'
import { NEON_YELLOW } from './palette.js'
import { DEFAULT_SKIN, createDie, dieGeo, quatForOrient, rollOrient, yAxis } from './dice.js'
import { createHat, disposeHat, HAT_BASE_Y, HAT_BOB_AMP, HAT_BOB_SPEED } from './hats.js'
import { createHands, disposeHands, updateHands, PUNCH_TIME } from './hands.js'
import { inArena, floorY, LEVELS } from './layouts.js'
import { createNameplate, drawNameplate } from './sprites.js'
import { sfx } from './sfx.js'
import { haptic, hapticHeavy } from './telegram.js'

const ROLL_TIME = 0.13
const DASH_TIME = 0.10
const JUMP_TIME = 0.36
// How long a predicted move may wait for its confirmation. A command the server
// never answers (dropped input, lost packet) would otherwise leave my cube
// standing on a cell it was never given, until some later move exposes it.
const PREDICTION_TTL_MS = 1200
const TRAIL_POOL = 28
const TRAIL_LIFE = 0.26
const JELLY_TIME = 0.38
const COMBAT_HOP_TIME = 0.28
const COMBAT_HOP_H = 0.22
const smoothstep = (t) => t * t * (3 - 2 * t)

// Player registry: dice meshes, server-driven animations and local prediction.
export function createPlayers(env, arena) {
  const { scene } = env
  const lift = () => env.theme?.arenaLift || 0
  const dieY = (level) => floorY(level, lift()) + 0.5
  const players = new Map()
  const state = { myId: null, skins: new Map() }

  // The catalog arrives with the welcome message; every client renders a given
  // skinId identically because nobody keeps a local copy of the colors.
  function setSkins(list) {
    state.skins = new Map((list || []).map((s) => [s.id, s]))
  }
  const skinFor = (id) => state.skins.get(id) || DEFAULT_SKIN

  // Cubes used to be color-coded (mine yellow, others hashed). Skins took that
  // away, so a thin ring outlines which cube is mine — dim enough that bloom
  // doesn't turn it into a glowing puddle.
  const marker = new THREE.Mesh(
    new THREE.TorusGeometry(0.52, 0.022, 6, 32),
    new THREE.MeshBasicMaterial({
      color: NEON_YELLOW, transparent: true, opacity: 0.4, depthWrite: false,
    })
  )
  marker.rotation.x = Math.PI / 2
  marker.visible = false
  scene.add(marker)

  // cooldown timers for the local player, in performance.now() time
  const local = {
    dashCooldownMs: 5000, dashReadyAt: 0,
    jumpCooldownMs: 1200, jumpReadyAt: 0,
    mineCooldownMs: 8000, mineReadyAt: 0, maxMines: 2,
    maxLives: 5,
    // last WASD/swipe dir — Space jump uses this; the floating arrow reads it
    moveDir: [0, -1],
  }

  // Cartoon aim chevron — depth-tested so the die can occlude it; still billboarded.
  const facingArrowFillMat = new THREE.MeshBasicMaterial({
    color: '#ffe566', depthTest: true, depthWrite: false, toneMapped: false,
  })
  const facingArrowOutlineMat = new THREE.MeshBasicMaterial({
    color: '#0a0a0c', depthTest: true, depthWrite: false, toneMapped: false,
  })
  const facingArrow = new THREE.Group()
  {
    // Separate fat silhouette for the rim — uniform scale leaves gaps at the neck/tip.
    const chevron = (p) => {
      const s = new THREE.Shape()
      s.moveTo(0, p.tip)
      s.quadraticCurveTo(p.wing * 0.25, p.tip - 0.02, p.wing, p.wingY)
      s.quadraticCurveTo(p.wing + 0.015, p.wingY - 0.016, p.neck, p.wingY - 0.016)
      s.lineTo(p.shaft + 0.004, p.wingY - 0.016)
      s.quadraticCurveTo(p.shaft, p.wingY - 0.028, p.shaft, p.wingY - 0.04)
      s.lineTo(p.shaft, p.butt + 0.02)
      s.quadraticCurveTo(p.shaft, p.butt, p.shaft * 0.25, p.butt)
      s.lineTo(-p.shaft * 0.25, p.butt)
      s.quadraticCurveTo(-p.shaft, p.butt, -p.shaft, p.butt + 0.02)
      s.lineTo(-p.shaft, p.wingY - 0.04)
      s.quadraticCurveTo(-p.shaft, p.wingY - 0.028, -(p.shaft + 0.004), p.wingY - 0.016)
      s.lineTo(-p.neck, p.wingY - 0.016)
      s.quadraticCurveTo(-(p.wing + 0.015), p.wingY - 0.016, -p.wing, p.wingY)
      s.quadraticCurveTo(-p.wing * 0.25, p.tip - 0.02, 0, p.tip)
      return s
    }
    const extrude = (shape, depth, bevel) => {
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth,
        bevelEnabled: true,
        bevelThickness: bevel,
        bevelSize: bevel,
        bevelSegments: 2,
        curveSegments: 8,
      })
      geo.translate(0, 0, -depth * 0.5)
      return geo
    }
    const fillGeo = extrude(chevron({
      tip: 0.09, wing: 0.055, wingY: 0.015, neck: 0.036, shaft: 0.022, butt: -0.075,
    }), 0.03, 0.009)
    // ~constant rim width around the whole chevron (including head/shaft join)
    const outlineGeo = extrude(chevron({
      tip: 0.108, wing: 0.072, wingY: 0.02, neck: 0.048, shaft: 0.036, butt: -0.092,
    }), 0.036, 0.01)

    const tagArrow = (mesh, order) => {
      mesh.renderOrder = order
      mesh.frustumCulled = false
      mesh.castShadow = false
      mesh.receiveShadow = false
      return mesh
    }
    const outline = tagArrow(new THREE.Mesh(outlineGeo, facingArrowOutlineMat), 2)
    outline.position.z = -0.01
    const fill = tagArrow(new THREE.Mesh(fillGeo, facingArrowFillMat), 3)
    fill.position.z = 0.008
    facingArrow.add(outline, fill)
  }
  facingArrow.visible = false
  scene.add(facingArrow)
  // screen-space aim angle (0 = up on screen); smoothed for cartoon turns
  let faceAng = 0
  let faceBobT = 0
  let faceDirX = 0
  let faceDirZ = -1
  const _aimA = new THREE.Vector3()
  const _aimB = new THREE.Vector3()

  // Afterimage pool — translucent die bodies that fade behind a moving cube.
  const trails = []
  for (let i = 0; i < TRAIL_POOL; i++) {
    const mat = new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0, depthWrite: false, toneMapped: false,
    })
    const mesh = new THREE.Mesh(dieGeo, mat)
    mesh.visible = false
    mesh.castShadow = false
    mesh.receiveShadow = false
    scene.add(mesh)
    trails.push({ mesh, mat, life: 0, maxOpacity: 0.42 })
  }

  function spawnTrail(p, opacity = 0.4) {
    if (!p.group.visible) return
    let g = null
    for (const t of trails) {
      if (t.life <= 0) { g = t; break }
    }
    if (!g) {
      // steal the oldest fading ghost rather than allocate
      g = trails[0]
      for (const t of trails) if (t.life < g.life) g = t
    }
    g.mesh.position.copy(p.group.position)
    g.mesh.quaternion.copy(p.group.quaternion)
    g.mesh.scale.copy(p.group.scale)
    g.mat.color.copy(p.bodyMat.color)
    g.maxOpacity = opacity
    g.mat.opacity = opacity
    g.life = TRAIL_LIFE
    g.mesh.visible = true
  }

  function updateTrails(dt) {
    for (const t of trails) {
      if (t.life <= 0) continue
      t.life -= dt
      if (t.life <= 0) {
        t.life = 0
        t.mat.opacity = 0
        t.mesh.visible = false
        continue
      }
      const k = t.life / TRAIL_LIFE
      t.mat.opacity = t.maxOpacity * k * k
      // slight shrink so the stack reads as a blur, not stacked solids
      const s = 0.94 + 0.06 * k
      t.mesh.scale.setScalar(s)
    }
  }

  function clearTrails() {
    for (const t of trails) {
      t.life = 0
      t.mat.opacity = 0
      t.mesh.visible = false
    }
  }

  // Squash / stretch bounce when a cube bonks a wall, obstacle, or another die.
  function clearJelly(p) {
    if (!p?.jelly) return
    p.jelly = null
    if (!p.anim && !p.spawnAnim && !p.deathAnim) p.group.scale.set(1, 1, 1)
  }

  // Cube-vs-cube hop lives outside jelly so knockback anims cannot cancel it.
  function pulseCombatHop(p) {
    if (!p || p.dead || p.gone) return
    p.combatHop = { t: 0, time: COMBAT_HOP_TIME }
  }

  // Play on any cube (local prediction or remote bump/hit). opts: shake, sfx, haptic, hop.
  function playBump(p, dx, dz, opts = {}) {
    if (!p || p.dead || p.gone) return
    if (opts.hop) pulseCombatHop(p)
    // Knockback may already be queued; still allow hop above. Jelly needs a free pose.
    if (p.deathAnim || p.spawnAnim) return
    if (p.anim) return
    if (p.jelly && p.jelly.t < 0.45) return
    const dirX = Math.sign(dx) || 0
    const dirZ = Math.sign(dz) || 0
    if (dirX === 0 && dirZ === 0) return
    if (dirX || dirZ) p.faceDir = [dirX, dirZ]
    p.jelly = { t: 0, dx: dirX, dz: dirZ, time: JELLY_TIME }
    if (opts.sfx !== false) sfx.bump()
    if (opts.shake) env.addShake?.(opts.shake)
    if (opts.haptic && p.id === state.myId) haptic()
  }

  function bumpInto(dx, dz, opts = {}) {
    playBump(me(), dx, dz, { shake: 0.32, haptic: true, ...opts })
  }

  function updateJelly(p, dt) {
    const j = p.jelly
    if (!j) return
    j.t = Math.min(j.t + dt / j.time, 1)
    const t = j.t
    // Squash along the hit axis + soft spring wobble.
    const wobble = Math.sin(t * Math.PI * 5) * Math.exp(-t * 3.8)
    const along = 1 - 0.18 * Math.sin(Math.PI * Math.min(t * 1.25, 1)) + wobble * 0.06
    const across = 1 / Math.sqrt(Math.max(0.72, along))
    // Smash into the obstacle, then spring back a little past rest (jelly rebound).
    const push = Math.sin(t * Math.PI * 1.85) * Math.exp(-2.3 * t) * 0.17

    if (p.freeCombat) {
      // Continuous mode owns XZ/Y; jelly is squash-only so it doesn't fight knock slide.
      if (j.dx !== 0) p.group.scale.set(along, across, across)
      else p.group.scale.set(across, across, along)
    } else {
      p.group.position.x = p.cell.x + j.dx * push
      p.group.position.y = dieY(p.level)
      p.group.position.z = p.cell.z + j.dz * push
      if (j.dx !== 0) p.group.scale.set(along, across, across)
      else p.group.scale.set(across, across, along)
    }

    if (t >= 1) {
      p.jelly = null
      if (!p.freeCombat) p.group.position.set(p.cell.x, dieY(p.level), p.cell.z)
      p.group.scale.set(1, 1, 1)
    }
  }

  function updateCombatHop(p, dt) {
    const h = p.combatHop
    if (!h) return null
    h.t = Math.min(h.t + dt / h.time, 1)
    const hop = Math.sin(Math.PI * h.t) * COMBAT_HOP_H
    // Hat lifts a bit extra so it reads as a loose pop on impact.
    const hatExtra = Math.sin(Math.PI * Math.min(h.t * 1.1, 1)) * 0.12
    if (h.t >= 1) p.combatHop = null
    return { hop, hatExtra }
  }

  // Hop must be an offset from a fresh base Y — never += onto last frame's hopped Y,
  // or the cube stacks height and freezes in the air after a hit.
  function applyCombatHop(p, hopFx) {
    if (!hopFx) {
      if (!p.anim && !p.jelly && !p.deathAnim && !p.spawnAnim) {
        p.group.position.y = dieY(p.level)
      }
      return
    }
    if (!p.anim) p.group.position.y = dieY(p.level)
    p.group.position.y += hopFx.hop
  }

  // Nameplate is nickname + HP (+ dash for me). Lives live only in the HUD strip.
  function paintPlate(p, dashFrac = null) {
    drawNameplate(p.bar, p.hp, dashFrac)
  }

  // FIFO of cells my unconfirmed predicted moves should land on.
  // The array identity never changes so other modules can hold on to it.
  const predictions = []

  const me = () => players.get(state.myId)

  // spectators and corpses take no input: the server would drop it anyway
  function isLaunchLocked(p = me()) {
    if (!p) return false
    if (p.anim?.type === 'launch') return true
    return p.queue.some((m) => m.t === 'launch')
  }

  function canPlay() {
    const p = me()
    if (!p || p.dead || p.spectating) return false
    if (p.freeCombat) return true
    // Trampoline flight owns the cube — WASD mid-arc desyncs level vs. mesh Y
    // (prediction queues a roll on the pad floor while the server is already up).
    if (isLaunchLocked(p)) return false
    // After the step onto the pad (predicted or confirmed), wait for launch —
    // further rolls race the server teleport to the next floor.
    const o = predictOrigin(p)
    if (arena.isTramp?.(p.level, o.x, o.z)) return false
    return true
  }

  function addPlayer(data) {
    if (players.has(data.id)) return players.get(data.id)
    const isMe = data.id === state.myId
    const skin = skinFor(data.skinId)
    const { group, bodyMat } = createDie(skin)
    // a soft bounce light in the cube's own colour, so it feels like a lit toy
    // sitting on the floor rather than a sticker pasted onto the scene
    const glow = new THREE.PointLight(skin.body, isMe ? 1.8 : 1.4, 3.5)
    glow.position.y = 0.2
    group.add(glow)
    group.position.set(data.fx ?? data.x, dieY(data.level || 0), data.fz ?? data.z)
    const q = quatForOrient(data)
    if (q) group.quaternion.copy(q)
    scene.add(group)

    // Hat is NOT a child of the tumbling die: it stays world-up and floats
    // above the cube centre so rolls never tip it sideways.
    const hat = createHat(data.hatId)
    scene.add(hat)

    // Same for fists — levitate beside the die, never inherit roll quat.
    // Same for fists — levitate beside the die, never inherit roll quat.
    // Duel Run (and any theme with hideHands) skips them.
    const hands = env.theme?.hideHands ? null : createHands(skin)
    if (hands) scene.add(hands)

    const bar = createNameplate(data.name, isMe)
    scene.add(bar.sprite)

    const p = {
      id: data.id, group, bodyMat, bar, hat, hatId: data.hatId || 'none', hands,
      skinId: data.skinId || skin.id,
      cell: { x: data.x, z: data.z },
      confirmedCell: { x: data.x, z: data.z },
      fx: data.fx ?? data.x,
      fz: data.fz ?? data.z,
      level: data.level || 0,
      hp: data.hp, lives: data.lives ?? null, dead: data.dead || false,
      spectating: data.spectating || false, // out of the round, waiting for the next
      orient: { top: data.top, east: data.east, south: data.south },
      confirmedOrient: { top: data.top, east: data.east, south: data.south },
      queue: [], anim: null,
      flash: 0, deathAnim: null, spawnAnim: null,
      jelly: null, combatHop: null,
      pendingDeath: null,           // death animation deferred until move anims finish
      gone: data.dead || data.spectating || false, // fully hidden
      hatPhase: Math.random() * Math.PI * 2,
      handPhase: Math.random() * Math.PI * 2,
      // look dir for floating fists (WASD / last move); default toward −Z
      faceDir: [data.faceX || 0, data.faceZ ?? -1],
      faceX: data.faceX || 0,
      faceZ: data.faceZ ?? -1,
      punch: null,                 // { side, t } cosmetic Enter jab
      hatFlight: null,              // detached hat ballistic after arena fall
      voiceOn: !!data.voice,
      freeCombat: false,
      faceDie: false,
      legs: null,
    }
    paintPlate(p)
    players.set(data.id, p)
    return p
  }

  function removePlayer(id) {
    const p = players.get(id)
    if (!p) return
    scene.remove(p.group)
    if (p.hat) {
      scene.remove(p.hat)
      disposeHat(p.hat)
    }
    if (p.hands) {
      scene.remove(p.hands)
      disposeHands(p.hands)
    }
    if (p.legs) {
      scene.remove(p.legs)
      // dispose via dynamic import avoidance — geometry dispose in clear path
      p.legs.traverse?.((o) => { if (o.geometry) o.geometry.dispose() })
      for (const m of p.legs.userData?.mats || []) m.dispose?.()
      p.legs = null
    }
    if (p.micBadge) {
      scene.remove(p.micBadge.sprite)
      p.micBadge.tex.dispose?.()
      p.micBadge = null
    }
    scene.remove(p.bar.sprite)
    players.delete(id)
  }

  function setHat(p, hatId) {
    if (!p) return
    const next = hatId || 'none'
    if (p.hatId === next && p.hat && !p.hatFlight) return
    if (p.hat) {
      scene.remove(p.hat)
      disposeHat(p.hat)
    }
    p.hatFlight = null
    p.hatId = next
    p.hat = createHat(next)
    scene.add(p.hat)
  }

  function clear() {
    for (const id of [...players.keys()]) removePlayer(id)
    state.myId = null
    predictions.length = 0
    clearTrails()
    marker.visible = false
    facingArrow.visible = false
  }

  /** Pop the hat off on arena fall — flies away on its own. */
  function detachHat(p) {
    if (!p?.hat || p.hatId === 'none' || p.hatFlight) return
    const a = Math.random() * Math.PI * 2
    const speed = 2.8 + Math.random() * 3.2
    p.hatFlight = {
      t: 0,
      mode: 'fly', // fly | rest (arena) | float (water)
      vx: Math.cos(a) * speed,
      vz: Math.sin(a) * speed,
      vy: 4 + Math.random() * 3,
      wx: (Math.random() - 0.5) * 10,
      wy: (Math.random() - 0.5) * 8,
      wz: (Math.random() - 0.5) * 10,
    }
  }

  /** Snap hat back to follow mode (respawn). */
  function clearHatFlight(p) {
    if (!p) return
    p.hatFlight = null
    if (p.hat) {
      p.hat.rotation.set(0, 0, 0)
      p.hat.quaternion.identity()
      p.hat.scale.set(1, 1, 1)
    }
  }

  /** Intact arena tile top crossed this frame under (x,z), or null. */
  function arenaHatRestY(x, z, fromY, toY) {
    const cx = Math.round(x)
    const cz = Math.round(z)
    if (!inArena(cx, cz)) return null
    if (Math.abs(x - cx) > 0.55 || Math.abs(z - cz) > 0.55) return null
    for (let l = LEVELS - 1; l >= 0; l--) {
      if (arena.isHole?.(l, cx, cz)) continue
      const surf = floorY(l, lift()) + 0.02
      if (fromY >= surf && toY <= surf) return surf
    }
    return null
  }

  function updateHatFlight(p, dt) {
    const hf = p.hatFlight
    const hat = p.hat
    if (!hf || !hat) return
    const hasHat = p.hatId && p.hatId !== 'none'
    if (!hasHat) {
      hat.visible = false
      return
    }

    hf.t += dt
    hat.scale.set(1, 1, 1)
    hat.visible = true

    if (hf.mode === 'float') {
      // Bob on the lake — hats don't sink.
      const lakeY = env.theme?.lakeY ?? hat.position.y
      hf.vx *= Math.exp(-1.2 * dt)
      hf.vz *= Math.exp(-1.2 * dt)
      hf.wx *= Math.exp(-2 * dt)
      hf.wy *= Math.exp(-1.5 * dt)
      hf.wz *= Math.exp(-2 * dt)
      hat.position.x += hf.vx * dt
      hat.position.z += hf.vz * dt
      hat.position.y = lakeY + 0.04 + Math.sin(hf.t * 2.4 + p.hatPhase) * 0.03
      hat.rotation.x += hf.wx * dt
      hat.rotation.y += hf.wy * dt
      hat.rotation.z += hf.wz * dt
      // Ease toward a slight float tilt, not a wild tumble.
      hat.rotation.x *= Math.exp(-1.5 * dt)
      hat.rotation.z *= Math.exp(-1.5 * dt)
      return
    }

    if (hf.mode === 'rest') {
      // Settled on arena tile — damp spin, stay put.
      hf.wx *= Math.exp(-4 * dt)
      hf.wy *= Math.exp(-3 * dt)
      hf.wz *= Math.exp(-4 * dt)
      hat.rotation.x += hf.wx * dt
      hat.rotation.y += hf.wy * dt
      hat.rotation.z += hf.wz * dt
      hat.rotation.x *= Math.exp(-2 * dt)
      hat.rotation.z *= Math.exp(-2 * dt)
      return
    }

    // Ballistic flight
    const prevY = hat.position.y
    hf.vy -= 16 * dt
    hat.position.x += hf.vx * dt
    hat.position.y += hf.vy * dt
    hat.position.z += hf.vz * dt
    hat.rotation.x += hf.wx * dt
    hat.rotation.y += hf.wy * dt
    hat.rotation.z += hf.wz * dt

    if (hf.vy > 0) return // still climbing — don't land yet

    // Land on arena tiles (don't fall through).
    const restY = arenaHatRestY(hat.position.x, hat.position.z, prevY, hat.position.y)
    if (restY != null) {
      hat.position.y = restY
      hf.mode = 'rest'
      hf.vx = 0
      hf.vz = 0
      hf.vy = 0
      return
    }

    // Land on water and float.
    const lakeY = env.theme?.lakeY
    if (lakeY != null) {
      const floatY = lakeY + 0.04
      const lakeR = env.theme?.lakeRadius ?? 14
      const dist = Math.hypot(hat.position.x, hat.position.z)
      if (dist <= lakeR && prevY >= floatY && hat.position.y <= floatY) {
        hat.position.y = floatY
        hf.mode = 'float'
        hf.vy = 0
        hf.vx *= 0.45
        hf.vz *= 0.45
        return
      }
    }

    // Missed everything — cull far below.
    if (hat.position.y < -18 || hf.t > 6) {
      hat.visible = false
      p.hatFlight = null
    }
  }

  function startDeathAnim(p, mode) {
    clearJelly(p)
    p.combatHop = null
    p.deathAnim = { t: 0, mode, vy: 2, splashed: false }
    if (mode === 'fall') detachHat(p)
    sfx.death()
  }

  // --- prediction ----------------------------------------------------------

  function syncConfirmed(p, data) {
    p.confirmedCell = { x: data.x, z: data.z }
    p.confirmedOrient = { top: data.top, east: data.east, south: data.south }
    // while predictions are in flight my orient chain is ahead of the server:
    // don't rewind it with the confirmation of an older move
    if (p.id !== state.myId || predictions.length === 0) p.orient = { ...p.confirmedOrient }
  }

  function rollbackPrediction(p) {
    if (!p?.confirmedCell) return
    predictions.length = 0
    p.queue = p.queue.filter((m) => !m.predicted)
    p.anim = null
    clearJelly(p)
    p.combatHop = null
    p.cell = { ...p.confirmedCell }
    p.orient = { ...p.confirmedOrient }
    p.group.position.set(p.cell.x, dieY(p.level), p.cell.z)
    p.group.scale.set(1, 1, 1)
    const q = quatForOrient(p.orient)
    if (q) p.group.quaternion.copy(q)
  }

  function playerAtCell(l, x, z) {
    for (const p of players.values()) {
      if (p.id !== state.myId && !p.dead && !p.gone && p.level === l && p.cell.x === x && p.cell.z === z) return p
    }
    return null
  }

  // logical position for chaining predictions: ahead of the animation cell,
  // which only advances when each roll animation actually finishes
  function predictOrigin(p) {
    return predictions.length > 0 ? predictions[predictions.length - 1] : p.confirmedCell
  }

  // returns false when the move must not even be sent (wall/obstacle)
  function predictRoll(dx, dz) {
    const p = me()
    if (!p || p.dead || p.gone || isLaunchLocked(p)) return true
    const l = p.level
    const o = predictOrigin(p)
    const nx = o.x + dx
    const nz = o.z + dz
    if (!inArena(nx, nz) || arena.isBlocked(l, nx, nz)) {
      bumpInto(dx, dz)
      return false
    }
    // an occupied cell means attack: bonk in place, send the move, keep the cube here
    if (playerAtCell(l, nx, nz)) {
      bumpInto(dx, dz, { hop: true })
      return true
    }
    const next = rollOrient(p.orient || { top: 1, east: 3, south: 2 }, dx, dz)
    predictions.push({ x: nx, z: nz, at: performance.now() })
    p.orient = next
    enqueueMove(p, {
      predicted: true,
      p: { id: p.id, level: l, x: nx, z: nz, ...next },
    })
    return true
  }

  // walks up to two cells with the same stop rules as the server.
  // Returns 'ok' | 'wall' | 'attack' so input can sync bump VFX / skip a wasted dash.
  function predictDash(dx, dz) {
    const p = me()
    if (!p || p.dead || p.gone || isLaunchLocked(p)) return 'ok'
    const l = p.level
    let { x, z } = predictOrigin(p)
    let steps = 0
    for (let i = 0; i < 2; i++) {
      const nx = x + dx
      const nz = z + dz
      if (!inArena(nx, nz) || arena.isBlocked(l, nx, nz) || playerAtCell(l, nx, nz)) break
      x = nx
      z = nz
      steps++
      if (arena.isHole(l, nx, nz) || arena.isTramp(l, nx, nz)) break
    }
    if (steps === 0) {
      const o = predictOrigin(p)
      const hitPlayer = playerAtCell(l, o.x + dx, o.z + dz)
      bumpInto(dx, dz, { hop: !!hitPlayer })
      return hitPlayer ? 'attack' : 'wall'
    }
    predictions.push({ x, z, at: performance.now() })
    enqueueMove(p, {
      predicted: true, dash: true,
      p: { id: p.id, level: l, x, z, ...p.orient },
    })
    return 'ok'
  }

  // --- movement animation (server events drive everything) -----------------

  function enqueueMove(p, data) {
    p.queue.push(data)
    // Launch is queued after the step onto the pad. If that step is still
    // rolling, cut the leftover so we don't sit still on the tramp for a beat.
    if (data.t === 'launch' && p.anim?.type === 'roll') {
      const remain = (1 - p.anim.t) * p.anim.time
      if (remain > 0.04) p.anim.time = p.anim.t * p.anim.time + 0.04
    }
    // if animations fall behind the server, fast-forward everything but the last
    while (p.queue.length > 2) applyMoveInstantly(p, p.queue.shift())
  }

  function applyMoveInstantly(p, m) {
    p.anim = null
    clearJelly(p)
    if (m.t === 'launch') p.level = m.p.level
    p.cell = { x: m.p.x, z: m.p.z }
    if (m.p.top != null) syncConfirmed(p, m.p)
    p.group.position.set(m.p.x, dieY(p.level), m.p.z)
    const q = quatForOrient(m.p)
    if (q) p.group.quaternion.copy(q)
  }

  function startNextAnim(p) {
    if (p.anim || p.queue.length === 0) return
    const m = p.queue.shift()
    clearJelly(p)

    // trampoline launch to the next platform: big soaring arc with flips
    if (m.t === 'launch') {
      const fromLevel = p.level
      const toLevel = m.p.level
      // Speculative WASD rolls that raced the pad must not play after / during flight.
      p.queue = p.queue.filter((q) => !q.predicted)
      if (p.id === state.myId) predictions.length = 0
      // Keep p.level on the pad until landing — flipping it here snaps the camera
      // and reveals the whole upper arena in one frame (felt like a hitch).
      p.anim = {
        type: 'launch', t: 0,
        fromLevel, toLevel,
        from: p.group.position.clone(),
        to: new THREE.Vector3(m.p.x, dieY(toLevel), m.p.z),
        axis: new THREE.Vector3(1, 0, 0),
        startQuat: p.group.quaternion.clone(),
        arc: 3.2,
        target: m.p,
        time: 1.65,
      }
      // Landing tile dips open so the die flies through, then reseats under it.
      arena.beginLaunchHatch?.(toLevel, m.p.x, m.p.z, 1.65)
      // the pad visibly kicks the cube off
      const plat = arena.platforms[fromLevel]
      if (plat) plat.tramp.bounce = 1
      sfx.launch()
      if (p.id === state.myId) hapticHeavy()
      return
    }

    const dx = Math.sign(m.p.x - p.cell.x)
    const dz = Math.sign(m.p.z - p.cell.z)
    const dist = Math.abs(m.p.x - p.cell.x) + Math.abs(m.p.z - p.cell.z)
    const baseY = dieY(p.level)
    // Fists yaw with travel so left/right stay beside the die relative to facing.
    if (dx || dz) p.faceDir = [dx, dz]

    if (m.jump) {
      const stomp = !!m.stomp
      // Prefer server/predicted start cell so the arc always covers the leap.
      const ox = m.fromX != null ? m.fromX : p.cell.x
      const oz = m.fromZ != null ? m.fromZ : p.cell.z
      const jdx = m.p.x - ox
      const jdz = m.p.z - oz
      const dir = new THREE.Vector3(Math.sign(jdx), 0, Math.sign(jdz))
      const from = new THREE.Vector3(ox, baseY, oz)
      p.cell = { x: ox, z: oz }
      p.group.position.copy(from)
      p.anim = {
        type: 'jump', t: 0,
        stomp,
        from,
        to: new THREE.Vector3(m.p.x, baseY + (stomp ? 1.05 : 0), m.p.z),
        settleY: baseY,
        axis: dir.lengthSq() > 0 ? new THREE.Vector3().crossVectors(yAxis, dir).normalize() : null,
        startQuat: p.group.quaternion.clone(),
        arc: stomp ? 1.7 : 1.4,
        target: m.p,
        time: stomp ? JUMP_TIME * 1.08 : JUMP_TIME,
        trailAt: [0.22, 0.45, 0.7],
        trailI: 0,
      }
      sfx.jump()
    } else if (m.dash || m.knock || dist > 1 || dist === 0) {
      const from = new THREE.Vector3(p.group.position.x, baseY, p.group.position.z)
      p.anim = {
        type: 'dash', t: 0,
        from,
        to: new THREE.Vector3(m.p.x, baseY, m.p.z),
        dir: new THREE.Vector3(dx, 0, dz),
        target: m.p,
        time: DASH_TIME * Math.max(1, dist * 0.7),
        trailAt: dist > 1 ? [0.14, 0.34, 0.54, 0.74] : [0.2, 0.45, 0.7],
        trailI: 0,
      }
      if (m.dash) sfx.dash() // knockback slides are voiced by the hit sound
    } else {
      p.anim = {
        type: 'roll', t: 0,
        axis: new THREE.Vector3().crossVectors(yAxis, new THREE.Vector3(dx, 0, dz)),
        pivot: p.group.position.clone().add(new THREE.Vector3(dx * 0.5, -0.5, dz * 0.5)),
        startPos: p.group.position.clone(),
        startQuat: p.group.quaternion.clone(),
        target: m.p,
        time: ROLL_TIME,
        trailAt: [0.22, 0.48, 0.74],
        trailI: 0,
      }
      sfx.roll()
    }
  }

  function updatePlayerAnim(p, dt) {
    startNextAnim(p)
    const a = p.anim
    if (!a) return
    a.t = Math.min(a.t + dt / a.time, 1)
    const e = smoothstep(a.t)

    if (a.type === 'roll') {
      const q = new THREE.Quaternion().setFromAxisAngle(a.axis, e * Math.PI / 2)
      p.group.quaternion.copy(q).multiply(a.startQuat)
      p.group.position.copy(a.startPos).sub(a.pivot).applyQuaternion(q).add(a.pivot)
    } else if (a.type === 'jump') {
      p.group.position.lerpVectors(a.from, a.to, e)
      p.group.position.y += a.arc * 4 * e * (1 - e)
      // full flip in the air: ends in the same orientation it started with
      const axis = a.axis || new THREE.Vector3(1, 0, 0)
      const q = new THREE.Quaternion().setFromAxisAngle(axis, e * Math.PI * 2)
      p.group.quaternion.copy(q).multiply(a.startQuat)
      if (a.stomp) {
        // Squash as we come down onto their top face
        const land = Math.max(0, (a.t - 0.55) / 0.45)
        const squash = 1 - land * 0.22
        p.group.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash))
      }
    } else if (a.type === 'stompSettle') {
      p.group.position.lerpVectors(a.from, a.to, e)
      const squash = 0.78 + 0.22 * e
      p.group.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash))
    } else if (a.type === 'launch') {
      // trampoline pop: shoots up fast, floats over the apex, settles down softly
      p.group.position.x = a.from.x + (a.to.x - a.from.x) * e
      p.group.position.z = a.from.z + (a.to.z - a.from.z) * e
      const ve = 1 - Math.pow(1 - a.t, 2.4)
      p.group.position.y = a.from.y + (a.to.y - a.from.y) * ve + a.arc * 4 * a.t * (1 - a.t)
      // double front flip, slowing towards the landing; ends where it started
      const q = new THREE.Quaternion().setFromAxisAngle(a.axis, e * Math.PI * 4)
      p.group.quaternion.copy(q).multiply(a.startQuat)
      // stretch on take-off, relax mid-air
      const st = 1 + 0.4 * Math.sin(Math.PI * Math.min(a.t * 2.5, 1)) * (1 - a.t)
      p.group.scale.set(1 / Math.sqrt(st), st, 1 / Math.sqrt(st))
    } else {
      p.group.position.lerpVectors(a.from, a.to, e)
      // dash stretch: elongate along travel direction mid-dash
      const s = 1 + Math.sin(a.t * Math.PI) * 0.25
      const sq = 1 / Math.sqrt(s)
      p.group.scale.set(
        a.dir.x !== 0 ? s : sq,
        sq,
        a.dir.z !== 0 ? s : sq
      )
    }

    // Drop translucent copies along the path so the cube “triples” in motion.
    if (a.trailAt && a.trailI < a.trailAt.length && a.t >= a.trailAt[a.trailI]) {
      const fade = 0.28 - a.trailI * 0.05
      spawnTrail(p, Math.max(0.14, fade))
      a.trailI++
    }

    if (a.t >= 1) {
      if (a.type === 'jump' && a.stomp) {
        p.cell = { x: a.target.x, z: a.target.z }
        p.anim = {
          type: 'stompSettle', t: 0,
          from: p.group.position.clone(),
          to: new THREE.Vector3(a.target.x, a.settleY, a.target.z),
          target: a.target,
          time: 0.16,
        }
        sfx.hit()
        if (p.id === state.myId) hapticHeavy()
        return
      }
      if (a.type === 'launch' && a.toLevel != null) p.level = a.toLevel
      p.cell = { x: a.target.x, z: a.target.z }
      p.group.position.set(a.target.x, dieY(p.level), a.target.z)
      p.group.scale.set(1, 1, 1)
      const q = quatForOrient(a.target)
      if (q) p.group.quaternion.copy(q)
      p.anim = null
      if (p.id === state.myId) haptic()
      startNextAnim(p)
      if (!p.anim && p.pendingDeath) {
        startDeathAnim(p, p.pendingDeath)
        p.pendingDeath = null
      }
    }
  }

  function update(dt, visibleUpTo) {
    for (const p of players.values()) {
      let hopFx = null
      if (!p.freeCombat) {
        updatePlayerAnim(p, dt)
        if (!p.anim) updateJelly(p, dt)
        hopFx = updateCombatHop(p, dt)
        applyCombatHop(p, hopFx)
      } else {
        // Continuous pose owns transform; keep jelly for splash shove feedback.
        p.anim = null
        p.queue.length = 0
        p.combatHop = null
        if (p.jelly) updateJelly(p, dt)
      }

      // cubes on hidden (upper) platforms are hidden along with them;
      // a launch in progress stays visible from the pad it left
      const fromLaunch = p.anim?.type === 'launch' ? p.anim.fromLevel : null
      p.group.visible = !p.gone && (
        p.level <= visibleUpTo
        || (fromLaunch != null && fromLaunch <= visibleUpTo)
      )

      if (p.flash > 0) {
        p.flash = Math.max(0, p.flash - dt * 4)
        p.bodyMat.emissive.set('#ff2222')
        p.bodyMat.emissiveIntensity = p.flash * 1.2
      } else {
        p.bodyMat.emissiveIntensity = 0
      }

      if (p.deathAnim) {
        clearJelly(p)
        p.combatHop = null
        const da = p.deathAnim
        da.t += dt
        if (da.mode === 'fall') {
          // plunge off the platform, tumbling
          da.vy += dt * 16
          p.group.position.y -= da.vy * dt
          p.group.rotation.x += dt * 5
          p.group.rotation.z += dt * 3.2
          // Lake splash once when the cube crosses the water surface
          const lakeY = env.theme?.lakeY
          if (lakeY != null && !da.splashed && p.group.position.y <= lakeY + 0.35) {
            da.splashed = true
            if (env.splash?.(p.group.position.x, p.group.position.z, 1.15)) {
              sfx.splash?.()
              env.addShake?.(0.35)
            }
          }
          const k = Math.min(da.t / 1.1, 1)
          p.group.scale.setScalar(1 - k * 0.5)
          if (p.legs) p.legs.visible = false
          if (k >= 1) { p.gone = true; p.group.visible = false; p.deathAnim = null }
        } else {
          const k = Math.min(da.t * 1.6, 1)
          p.group.scale.setScalar(Math.max(0.001, 1 - k * 0.999))
          p.group.rotation.y += dt * 10
          p.group.position.y = dieY(p.level) + k * 1.2
          if (p.legs) p.legs.visible = false
          if (k >= 1) { p.gone = true; p.group.visible = false; p.deathAnim = null }
        }
      }

      if (p.spawnAnim) {
        clearJelly(p)
        p.combatHop = null
        p.spawnAnim.t += dt * 3
        const k = Math.min(p.spawnAnim.t, 1)
        p.group.scale.setScalar(Math.max(0.001, smoothstep(k)))
        if (k >= 1) { p.group.scale.set(1, 1, 1); p.spawnAnim = null }
      }

      // hat levitates above the die in world space (never tumbles with rolls)
      if (p.hat) {
        const hasHat = p.hatId && p.hatId !== 'none'
        if (p.hatFlight) {
          updateHatFlight(p, dt)
        } else if (hasHat && (p.group.visible || p.deathAnim)) {
          // Stay put during jelly squash — only the die deforms / shoves.
          const anchored = !!p.jelly
          const hx = anchored ? p.cell.x : p.group.position.x
          const hz = anchored ? p.cell.z : p.group.position.z
          const hy = anchored ? dieY(p.level) : p.group.position.y
          const bob = Math.sin(performance.now() * 0.001 * HAT_BOB_SPEED + p.hatPhase) * HAT_BOB_AMP
          const hopLift = hopFx ? hopFx.hatExtra : 0
          p.hat.visible = true
          p.hat.position.set(hx, hy + HAT_BASE_Y + bob + hopLift, hz)
          p.hat.quaternion.identity()
          p.hat.scale.copy(p.group.scale)
        } else {
          p.hat.visible = false
        }
      }

      // fists float beside the die (idle bob + yaw with facing + Enter jab)
      if (p.hands) {
        if (p.punch) {
          p.punch.t += dt / p.punch.time
          if (p.punch.t >= 1) p.punch = null
        }
        const showHands = !p.gone && (p.group.visible || p.deathAnim)
        const anchored = !!p.jelly
        const hx = anchored ? p.cell.x : p.group.position.x
        const hz = anchored ? p.cell.z : p.group.position.z
        const hy = anchored ? dieY(p.level) : p.group.position.y
        // Free-combat already owns facing — re-lerping from moveDir causes 180° flips
        // that yank the fists. Classic grid still aims from WASD / faceDir.
        if (!p.freeCombat) {
          let wantX = p.faceDir[0]
          let wantZ = p.faceDir[1]
          if (p.id === state.myId) {
            wantX = local.moveDir[0]
            wantZ = local.moveDir[1]
          }
          const wantLen = Math.hypot(wantX, wantZ)
          if (wantLen > 0.2) {
            wantX /= wantLen
            wantZ /= wantLen
            const faceK = Math.min(1, dt * 10)
            p.faceX += (wantX - p.faceX) * faceK
            p.faceZ += (wantZ - p.faceZ) * faceK
            const fl = Math.hypot(p.faceX, p.faceZ) || 1
            p.faceX /= fl
            p.faceZ /= fl
          }
        }
        updateHands(p.hands, { x: hx, y: hy, z: hz }, {
          t: performance.now() * 0.001,
          phase: p.handPhase,
          scale: p.group.scale,
          anim: p.anim,
          hopLift: hopFx ? hopFx.hatExtra * 0.6 : 0,
          visible: showHands,
          facingX: p.faceX,
          facingZ: p.faceZ,
          punch: p.punch,
          walkSpeed: p.walkSpeed || 0,
          walkPhase: p.gaitPhase || 0,
          dt,
        })
      }

      // nameplate floats above the die (and hat); hidden while dead
      p.bar.sprite.visible = !p.dead && p.group.visible
      const plateLift = p.hatId && p.hatId !== 'none' ? 1.45 : 1.15
      p.bar.sprite.position.set(p.group.position.x, p.group.position.y + plateLift, p.group.position.z)
    }

    updateTrails(dt)

    const mine = me()

    // an unanswered prediction is a lie about where I stand: give it up rather
    // than keep playing from a cell the server may never confirm
    if (mine && predictions.length > 0 && performance.now() - predictions[0].at > PREDICTION_TTL_MS) {
      rollbackPrediction(mine)
    }

    // the ring rides under my cube, on the ground of its platform
    marker.visible = !!mine && !mine.dead && !mine.gone && mine.level <= visibleUpTo
    if (marker.visible) {
      marker.position.set(mine.group.position.x, (floorY(mine.level, lift()) + 0.04), mine.group.position.z)
    }

    // aim arrow: billboard UI — tip follows screen dir of move (forward = up)
    facingArrow.visible = marker.visible && !mine?.freeCombat
    if (facingArrow.visible) {
      const [mdx, mdz] = local.moveDir
      const px = mine.group.position.x
      const py = mine.group.position.y
      const pz = mine.group.position.z
      _aimA.set(px, py, pz).project(env.camera)
      _aimB.set(px + mdx, py, pz + mdz).project(env.camera)
      // atan2(screenX, screenY): 0 = up, π = down toward the player
      const targetAng = Math.atan2(_aimB.x - _aimA.x, _aimB.y - _aimA.y)
      let dang = targetAng - faceAng
      while (dang > Math.PI) dang -= Math.PI * 2
      while (dang < -Math.PI) dang += Math.PI * 2
      faceAng += dang * Math.min(1, dt * 14)
      faceBobT += dt

      // only the face-offset eases; position sticks to the cube so rolls don't leave it behind
      const dirK = Math.min(1, dt * 16)
      faceDirX += (mdx - faceDirX) * dirK
      faceDirZ += (mdz - faceDirZ) * dirK
      const bob = Math.sin(faceBobT * 3.2) * 0.03
      const pulse = 1 + Math.sin(faceBobT * 3.8) * 0.04
      const wobble = Math.sin(faceBobT * 2.4) * 0.05
      facingArrow.position.set(px + faceDirX * 0.78, py + 0.18 + bob, pz + faceDirZ * 0.78)
      facingArrow.quaternion.copy(env.camera.quaternion)
      facingArrow.rotateZ(-faceAng + wobble)
      facingArrow.scale.setScalar(pulse)
    }

    // my bar also shows dash readiness, redrawn every frame while recharging
    if (mine && !mine.dead) {
      const remainMs = Math.max(0, local.dashReadyAt - performance.now())
      paintPlate(mine, 1 - remainMs / local.dashCooldownMs)
    }
  }

  /** Cosmetic fist jab — Enter only, no gameplay. Random left/right each press. */
  function punch() {
    const p = me()
    if (!p || p.gone || p.dead || !p.hands) return
    // Let the current jab finish — spam must not cut the swing short.
    if (p.punch && p.punch.t < 1) return
    const side = Math.random() < 0.5 ? -1 : 1
    p.punch = { side, t: 0, time: PUNCH_TIME }
  }

  return {
    players, state, local, predictions,
    me, canPlay, setSkins, setHat, addPlayer, removePlayer, clear, paintPlate,
    syncConfirmed, rollbackPrediction, predictRoll, predictDash, playBump,
    enqueueMove, startDeathAnim, clearHatFlight, punch, update,
  }
}
