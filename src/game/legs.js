import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { DEFAULT_SKIN } from './dice.js'

/** Approximate visual leg length (for reference / tuning). */
export const LEG_LENGTH = 0.32
/**
 * Distance from freeroam hipAnchor to sole bottom at rest:
 * |foot.y| + soleHalf − hip.y = 0.405 + 0.0225 − 0.02.
 */
export const HIP_TO_SOLE = 0.408
/** Tiny gap so soles sit on the grass, not inside it. */
export const BODY_CLEARANCE = 0.01

/**
 * Two toy legs (scene siblings of the die). Origin = hip; feet hang −Y.
 * Forward = local −Z (same as the cube face / freeroam facing).
 */
export function createLegs(skinOrColor = DEFAULT_SKIN) {
  const bodyHex = typeof skinOrColor === 'string' || skinOrColor?.isColor
    ? skinOrColor
    : (skinOrColor?.body || DEFAULT_SKIN.body)
  const pipHex = skinOrColor?.pip || '#2a2010'

  const root = new THREE.Group()
  const bodyMat = new THREE.MeshStandardMaterial({
    color: bodyHex,
    roughness: 0.52,
    metalness: 0.08,
  })
  const darkMat = new THREE.MeshStandardMaterial({
    color: pipHex,
    roughness: 0.65,
    metalness: 0.05,
  })
  const sockMat = new THREE.MeshStandardMaterial({
    color: '#fff6e8',
    roughness: 0.7,
    metalness: 0,
  })
  root.userData.mats = [bodyMat, darkMat, sockMat]

  const left = makeLeg(-1, bodyMat, darkMat, sockMat)
  const right = makeLeg(1, bodyMat, darkMat, sockMat)
  root.add(left, right)
  root.userData.left = left
  root.userData.right = right
  root.userData.phase = 0
  return root
}

function makeLeg(side, bodyMat, darkMat, sockMat) {
  const hip = new THREE.Group()
  hip.position.set(side * 0.2, 0.02, 0)
  hip.userData.side = side

  const hipBall = new THREE.Mesh(new THREE.SphereGeometry(0.078, 12, 10), bodyMat)
  hipBall.position.y = -0.018
  hipBall.castShadow = true
  hip.add(hipBall)

  const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.095, 5, 10), bodyMat)
  thigh.position.y = -0.115
  thigh.castShadow = true
  thigh.receiveShadow = true
  hip.add(thigh)

  const knee = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), bodyMat)
  knee.position.y = -0.2
  knee.castShadow = true
  hip.add(knee)

  const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.075, 5, 10), bodyMat)
  shin.position.y = -0.275
  shin.castShadow = true
  hip.add(shin)

  const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.062, 0.05, 12), sockMat)
  sock.position.y = -0.335
  sock.castShadow = true
  hip.add(sock)

  const ankle = new THREE.Mesh(new THREE.SphereGeometry(0.042, 10, 8), bodyMat)
  ankle.position.y = -0.37
  ankle.castShadow = true
  hip.add(ankle)

  const foot = new THREE.Group()
  foot.position.set(0, -0.405, -0.018)

  const sole = new THREE.Mesh(
    new RoundedBoxGeometry(0.14, 0.045, 0.19, 2, 0.028),
    darkMat,
  )
  sole.position.set(0, 0, -0.035)
  sole.castShadow = true
  sole.receiveShadow = true
  foot.add(sole)

  const vamp = new THREE.Mesh(
    new RoundedBoxGeometry(0.12, 0.055, 0.12, 2, 0.022),
    bodyMat,
  )
  vamp.position.set(0, 0.03, -0.018)
  vamp.castShadow = true
  foot.add(vamp)

  const toe = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), bodyMat)
  toe.position.set(0, 0.018, -0.11)
  toe.scale.set(1.15, 0.75, 0.9)
  toe.castShadow = true
  foot.add(toe)

  const heel = new THREE.Mesh(new THREE.SphereGeometry(0.036, 8, 8), darkMat)
  heel.position.set(0, 0, 0.06)
  heel.scale.set(1.1, 0.7, 0.8)
  foot.add(heel)

  hip.add(foot)
  hip.userData.foot = foot
  hip.userData.knee = knee
  return hip
}

export function setLegsColor(root, color) {
  if (!root?.userData?.mats?.[0] || color == null) return
  root.userData.mats[0].color.set(color)
}

/**
 * Drive a walk cycle. Forward = local −Z (matches cube face).
 */
export function updateLegs(root, hipAnchor, opts = {}) {
  if (!root) return
  const {
    speed = 0,
    facingX = 0,
    facingZ = -1,
    dt = 0.016,
    grounded = true,
  } = opts

  const left = root.userData.left
  const right = root.userData.right
  if (!left || !right) return

  root.position.set(hipAnchor.x, hipAnchor.y, hipAnchor.z)

  // Same yaw as fists / cube face: local −Z = look direction.
  const len = Math.hypot(facingX, facingZ)
  const yaw = len < 1e-6 ? 0 : Math.atan2(-facingX / len, -facingZ / len)
  root.rotation.set(0, yaw, 0)

  const moving = grounded && speed > 0.35
  const stepRate = 9.2
  if (moving) root.userData.phase += dt * stepRate * Math.min(speed / 4.5, 1.6)
  else root.userData.phase *= Math.max(0, 1 - dt * 6)

  const ph = root.userData.phase
  const amp = moving ? Math.min(0.5, 0.2 + speed * 0.045) : 0.032
  const idle = moving ? 0 : Math.sin(performance.now() * 0.002) * 0.022

  for (const [leg, offset] of [[left, 0], [right, Math.PI]]) {
    const swing = Math.sin(ph + offset) * amp + idle * (offset ? -1 : 1)
    const lift = moving ? Math.max(0, Math.sin(ph + offset)) * 0.085 : 0
    const kneeBend = moving ? Math.max(0, -Math.sin(ph + offset)) * 0.32 : 0.07

    leg.rotation.x = -swing
    leg.rotation.z = leg.userData.side * 0.032
    // Keep makeLeg() hip base (0.02); only add swing lift on top.
    leg.position.y = 0.02 + lift

    if (leg.userData.knee) {
      leg.userData.knee.scale.setScalar(1 + kneeBend * 0.13)
    }
    if (leg.userData.foot) {
      leg.userData.foot.rotation.x = moving ? swing * 0.52 : 0.045
    }
  }
}

export function disposeLegs(root) {
  if (!root) return
  for (const m of root.userData.mats || []) m.dispose?.()
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose()
  })
}
