import * as THREE from 'three'
import { cloneGltf, preloadGltf } from './assets/gltf.js'

/** Authored fist pair from `art/character/die_hero.blend`. Cache-bust after re-export. */
export const HANDS_URL = '/assets/character/hands.glb?v=1'

/** Idle levitation (world-up, never tumbles with the die). */
export const HAND_BOB_AMP = 0.05
export const HAND_BOB_SPEED = 2.2
export const HAND_SWAY_AMP = 0.028
export const HAND_SWAY_SPEED = 1.7

/** Fallback offsets if GLB is missing (Three.js Y-up, die centre). */
const FALLBACK_L = { x: -0.78, y: 0.05, z: 0.08 }
const FALLBACK_R = { x: 0.78, y: 0.05, z: 0.08 }

const _e = new THREE.Euler()

export async function preloadHands() {
  await preloadGltf([HANDS_URL], {
    palette: {
      glove: '#d989b0',
      'glove.001': '#d989b0',
    },
  })
}

export function disposeHands(root) {
  if (!root) return
  // GLB clones share geometry/materials with the template cache.
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
 */
export function createHands() {
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
  }

  root.add(left, right)
  root.userData.left = left
  root.userData.right = right
  root.traverse((o) => {
    if (!o.isMesh) return
    o.castShadow = true
    o.receiveShadow = true
  })
  return root
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
  const mat = new THREE.MeshToonMaterial({ color: '#d989b0' })
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.26, 0.18), mat)
  const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.08), mat)
  thumb.position.set(side * 0.12, -0.02, 0.06)
  thumb.rotation.z = side * 0.5
  g.add(palm, thumb)
  return g
}

/**
 * Drive idle levitation + move reaction. Call each frame after the die pose is known.
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
  } = opts

  hands.visible = visible
  if (!visible) return

  hands.position.set(anchor.x, anchor.y, anchor.z)
  hands.quaternion.identity()
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
    const sway = Math.sin(t * HAND_SWAY_SPEED + ph * 1.3) * HAND_SWAY_AMP

    hand.position.set(
      base.x + sway * side * 0.4 + move.outX * side,
      base.y + bob + hopLift + move.up,
      base.z + sway * 0.55 + move.back,
    )

    const bq = hand.userData.baseQuat
    _e.set(
      move.pitch + Math.sin(t * 1.4 + ph) * 0.05,
      move.yaw * side + Math.sin(t * 1.1 + ph * 0.7) * 0.07,
      move.roll * side + Math.cos(t * 1.6 + ph) * 0.04,
    )
    hand.quaternion.setFromEuler(_e)
    if (bq) hand.quaternion.premultiply(bq)
  }
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
