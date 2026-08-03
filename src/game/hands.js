import * as THREE from 'three'
import { cloneGltf, preloadGltf } from './assets/gltf.js'
import { DEFAULT_SKIN } from './dice.js'

/** Authored fist pair from `art/character/die_hero.blend`. Cache-bust after re-export. */
export const HANDS_URL = '/assets/character/hands.glb?v=1'

/** Idle levitation (stay upright — never tumble with the die). */
export const HAND_BOB_AMP = 0.11
export const HAND_BOB_SPEED = 2.55
export const HAND_HOVER_AMP = 0.055
export const HAND_HOVER_SPEED = 1.15
export const HAND_SWAY_AMP = 0.06
export const HAND_SWAY_SPEED = 1.85
export const HAND_DRIFT_AMP = 0.045
export const HAND_DRIFT_SPEED = 1.35
export const HAND_TILT_AMP = 0.14

/** Cosmetic Enter-punch (seconds). */
export const PUNCH_TIME = 0.3

/** Fallback offsets if GLB is missing (Three.js Y-up, die centre). */
const FALLBACK_L = { x: -0.78, y: 0.05, z: 0.08 }
const FALLBACK_R = { x: 0.78, y: 0.05, z: 0.08 }

const _e = new THREE.Euler()
const _yAxis = new THREE.Vector3(0, 1, 0)
const _qIdle = new THREE.Quaternion()
const _qPunch = new THREE.Quaternion()
const _ePunch = new THREE.Euler()

export async function preloadHands() {
  await preloadGltf([HANDS_URL], {
    palette: {
      glove: DEFAULT_SKIN.body,
      'glove.001': DEFAULT_SKIN.body,
    },
  })
}

export function disposeHands(root) {
  if (!root) return
  const owned = root.userData?.ownedMats
  if (owned?.length) {
    for (const m of owned) m.dispose?.()
    root.userData.ownedMats = null
    return
  }
  // Shared GLB template mats — don't dispose.
  if (root.userData?.fromGltf) return
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose()
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose())
      else o.material.dispose()
    }
  })
}

/**
 * Two floating fists as scene siblings of the hat (not children of the tumbling die).
 * @param {string|object} [skinOrColor] die skin (or body hex) — fists match the cube.
 */
export function createHands(skinOrColor = DEFAULT_SKIN) {
  const root = new THREE.Group()
  root.userData.fromGltf = true

  const authored = cloneGltf(HANDS_URL)
  let left
  let right

  if (authored) {
    authored.updateMatrixWorld(true)
    const nodes = collectFistNodes(authored)
    left = wrapNode(nodes.L, FALLBACK_L)
    right = wrapNode(nodes.R, FALLBACK_R)
  } else {
    left = makeFallbackFist(-1)
    right = makeFallbackFist(1)
    root.userData.fromGltf = false
  }

  root.add(left, right)
  root.userData.left = left
  root.userData.right = right
  // Same Standard shading as the die — toon gloves blow out yellow under night glow.
  setHandsSkin(root, skinOrColor)
  root.traverse((o) => {
    if (!o.isMesh) return
    o.castShadow = true
    o.receiveShadow = true
  })
  return root
}

function normalizeSkin(skinOrColor) {
  if (skinOrColor == null) return { ...DEFAULT_SKIN }
  if (typeof skinOrColor === 'string' || typeof skinOrColor === 'number'
    || (skinOrColor.isColor)) {
    return { ...DEFAULT_SKIN, body: skinOrColor }
  }
  return { ...DEFAULT_SKIN, ...skinOrColor }
}

/**
 * Match die body shading (Standard + skin roughness/metalness).
 * Replaces toon/GLB mats so night lights don't turn fists neon.
 */
export function setHandsSkin(root, skinOrColor) {
  if (!root) return
  const s = normalizeSkin(skinOrColor)
  const prev = root.userData.ownedMats
  const mat = new THREE.MeshStandardMaterial({
    color: s.body,
    roughness: s.roughness ?? DEFAULT_SKIN.roughness,
    metalness: s.metalness ?? DEFAULT_SKIN.metalness,
  })
  root.traverse((o) => {
    if (!o.isMesh) return
    o.material = mat
  })
  if (prev?.length) {
    for (const m of prev) {
      if (m !== mat) m.dispose?.()
    }
  }
  root.userData.ownedMats = [mat]
}

/** @deprecated prefer setHandsSkin — kept for colour-only wardrobe updates */
export function setHandsColor(root, color) {
  setHandsSkin(root, color)
}

function collectFistNodes(authored) {
  const named = { L: null, R: null }
  authored.traverse((o) => {
    const n = o.name || ''
    if (/fist_l/i.test(n)) named.L = o
    if (/fist_r/i.test(n)) named.R = o
  })

  if (named.L && named.R) return named

  // Fallback: sort meshes by X (glTF Y-up: Blender +X stays +X).
  const meshes = []
  authored.traverse((o) => { if (o.isMesh) meshes.push(o) })
  meshes.sort((a, b) => {
    const ax = new THREE.Vector3()
    const bx = new THREE.Vector3()
    a.getWorldPosition(ax)
    b.getWorldPosition(bx)
    return ax.x - bx.x
  })
  return {
    L: named.L || meshes[0] || null,
    R: named.R || meshes[meshes.length - 1] || null,
  }
}

/** Parent a GLB node under a fresh group; keep authored local pose as base. */
function wrapNode(node, fallback) {
  const g = new THREE.Group()
  if (!node) {
    g.position.set(fallback.x, fallback.y, fallback.z)
    g.userData.base = { ...fallback }
    return g
  }

  // Prefer the mesh's local position relative to the export root (die centre).
  const pos = new THREE.Vector3()
  node.getWorldPosition(pos)
  // authored root is at origin on clone — world pos ≈ offset from die centre.
  // Climb to include parent offsets baked into Fist_* objects.
  let src = node
  // If mesh is nested, lift the top-most Fist_* / first meaningful parent under scene.
  while (src.parent && src.parent.parent) {
    if (/fist_/i.test(src.parent.name || '')) src = src.parent
    else break
  }

  const worldPos = new THREE.Vector3()
  const worldQuat = new THREE.Quaternion()
  const worldScale = new THREE.Vector3()
  src.matrixWorld.decompose(worldPos, worldQuat, worldScale)

  if (src.parent) src.parent.remove(src)
  g.position.copy(worldPos)
  g.quaternion.copy(worldQuat)
  g.scale.copy(worldScale)
  // Mesh keeps its local transform under src; reset src local so g owns the pose.
  src.position.set(0, 0, 0)
  src.quaternion.identity()
  src.scale.set(1, 1, 1)
  g.add(src)

  g.userData.base = { x: g.position.x, y: g.position.y, z: g.position.z }
  g.userData.baseQuat = g.quaternion.clone()
  return g
}

function makeFallbackFist(side) {
  const g = new THREE.Group()
  const base = side < 0 ? FALLBACK_L : FALLBACK_R
  g.position.set(base.x, base.y, base.z)
  g.userData.base = { ...base }
  g.userData.baseQuat = new THREE.Quaternion()
  // Material replaced by setHandsSkin on the root; placeholder only.
  const mat = new THREE.MeshStandardMaterial({
    color: DEFAULT_SKIN.body,
    roughness: DEFAULT_SKIN.roughness,
    metalness: DEFAULT_SKIN.metalness,
  })
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.26, 0.18), mat)
  const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.08), mat)
  thumb.position.set(side * 0.12, -0.02, 0.06)
  thumb.rotation.z = side * 0.5
  g.add(palm, thumb)
  return g
}

/**
 * Yaw so local −Z matches facing (fx, fz). Default face (0, −1) → yaw 0
 * (fists stay on ±X left/right of the die).
 */
export function facingYaw(fx = 0, fz = -1) {
  const len = Math.hypot(fx, fz)
  if (len < 1e-6) return 0
  // Mirror of atan2(x,−z): otherwise A/D flips fists opposite the aim arrow.
  return Math.atan2(-fx / len, -fz / len)
}

/**
 * Drive idle levitation + move reaction. Call each frame after the die pose is known.
 * Root yaw follows facing so fists flank the die relative to look direction.
 * @param {object|null} opts.punch { side: -1|1, t: 0..1 } cosmetic jab
 */
export function updateHands(hands, anchor, opts = {}) {
  if (!hands) return
  const {
    t = 0,
    phase = 0,
    scale = null,
    anim = null,
    hopLift = 0,
    visible = true,
    facingX = 0,
    facingZ = -1,
    punch = null,
  } = opts

  hands.visible = visible
  if (!visible) return

  hands.position.set(anchor.x, anchor.y, anchor.z)
  // Stay world-up; only yaw with look direction (never inherit die tumble).
  hands.quaternion.setFromAxisAngle(_yAxis, facingYaw(facingX, facingZ))
  if (scale) hands.scale.copy(scale)
  else hands.scale.set(1, 1, 1)

  const left = hands.userData.left
  const right = hands.userData.right
  if (!left || !right) return

  const move = movePose(anim)

  for (const [side, hand, ph] of [
    [-1, left, phase],
    [1, right, phase + 1.15],
  ]) {
    const base = hand.userData.base
    const bob = Math.sin(t * HAND_BOB_SPEED + ph) * HAND_BOB_AMP
    const hover = Math.sin(t * HAND_HOVER_SPEED + ph * 0.55) * HAND_HOVER_AMP
    const sway = Math.sin(t * HAND_SWAY_SPEED + ph * 1.3) * HAND_SWAY_AMP
    const drift = Math.sin(t * HAND_DRIFT_SPEED + ph * 0.9) * HAND_DRIFT_AMP
    const jab = punchPose(punch, side)

    hand.position.set(
      base.x + sway * side * 0.55 + move.outX * side + jab.outX,
      base.y + bob + hover + hopLift + move.up + jab.up,
      base.z + drift + sway * 0.35 + move.back + jab.back,
    )

    const idleWobble = jab.muteIdle
    _e.set(
      move.pitch + Math.sin(t * 1.55 + ph) * HAND_TILT_AMP * idleWobble,
      move.yaw * side + Math.sin(t * 1.2 + ph * 0.7) * (HAND_TILT_AMP * 0.7) * idleWobble,
      move.roll * side + Math.cos(t * 1.75 + ph) * (HAND_TILT_AMP * 0.55) * idleWobble,
    )
    _qIdle.setFromEuler(_e)
    const bq = hand.userData.baseQuat
    if (bq) _qIdle.premultiply(bq)

    if (jab.aim > 0.001) {
      // Knuckles toward facing (−Z of hands root), palm flat toward −Y.
      // Roll ±90° from the authored rest pose reads as a real jab.
      _ePunch.set(-0.08, side * -0.05, side * (Math.PI * 0.5))
      _qPunch.setFromEuler(_ePunch)
      hand.quaternion.copy(_qIdle).slerp(_qPunch, jab.aim)
    } else {
      hand.quaternion.copy(_qIdle)
    }
  }
}

/** One fist jabs forward; the other eases back a little. */
function punchPose(punch, side) {
  const pose = { outX: 0, up: 0, back: 0, muteIdle: 1, aim: 0 }
  if (!punch) return pose
  const u = Math.min(Math.max(punch.t, 0), 1)
  if (punch.side !== side) {
    const ease = Math.sin(u * Math.PI)
    pose.back = 0.1 * ease
    pose.outX = 0.04 * side * ease
    return pose
  }

  // Wind-up → strike → recover. `aim` holds palm-down / knuckles-forward pose.
  let strike = 0
  if (u < 0.2) {
    const w = u / 0.2
    pose.back = 0.18 * w
    pose.aim = 0.35 * w
    strike = 0
  } else if (u < 0.48) {
    const s = (u - 0.2) / 0.28
    const e = 1 - (1 - s) * (1 - s)
    pose.back = 0.18 - (0.18 + 0.78) * e
    pose.aim = 0.35 + 0.65 * e
    strike = e
  } else {
    const s = (u - 0.48) / 0.52
    const e = s * s * (3 - 2 * s)
    pose.back = -0.78 * (1 - e)
    pose.aim = 1 - e
    strike = 1 - e
  }
  pose.outX = -0.12 * side * Math.max(0, strike)
  pose.up = 0.04 * Math.max(0, strike)
  pose.muteIdle = 1 - pose.aim
  return pose
}

function movePose(anim) {
  const pose = { outX: 0, up: 0, back: 0, pitch: 0, yaw: 0, roll: 0 }
  if (!anim) return pose

  const type = anim.type
  const dur =
    type === 'roll' ? 0.13
      : type === 'dash' ? 0.10
        : type === 'jump' ? 0.36
          : type === 'launch' ? (anim.time || 0.55)
            : 0
  if (!dur) return pose
  const u = Math.min(Math.max(anim.t / dur, 0), 1)
  const ease = Math.sin(u * Math.PI)

  if (type === 'roll') {
    pose.back = -0.1 * ease
    pose.outX = 0.045 * ease
    pose.pitch = -0.35 * ease
    pose.roll = 0.22 * ease
  } else if (type === 'dash') {
    pose.back = -0.16 * ease
    pose.outX = 0.1 * ease
    pose.yaw = 0.22 * ease
    pose.pitch = -0.18 * ease
  } else if (type === 'jump' || type === 'launch') {
    pose.up = 0.14 * ease
    pose.outX = 0.06 * ease
    pose.pitch = -0.45 * ease
  }
  return pose
}
