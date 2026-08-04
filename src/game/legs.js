import * as THREE from 'three'
import { DEFAULT_SKIN } from './dice.js'

/** Approximate visual leg length (for reference / tuning). */
export const LEG_LENGTH = 0.28
/**
 * Distance from freeroam hipAnchor to sole bottom at rest.
 * Keep in sync with makeLeg() sole bottom.
 */
export const HIP_TO_SOLE = 0.34
/** Tiny gap so soles sit on the grass, not inside it. */
export const BODY_CLEARANCE = 0.01

/**
 * Two floating M&M-style sneakers (scene siblings of the die):
 * chunky round shoes with a clear air gap — not limb stacks.
 * Origin = hipAnchor under the die; feet hang −Y. Forward = local −Z.
 */
export function createLegs(skinOrColor = DEFAULT_SKIN) {
  const bodyHex = typeof skinOrColor === 'string' || skinOrColor?.isColor
    ? skinOrColor
    : (skinOrColor?.body || DEFAULT_SKIN.body)
  const pipHex = skinOrColor?.pip || '#2a2010'

  const root = new THREE.Group()
  const bodyMat = new THREE.MeshStandardMaterial({
    color: bodyHex,
    roughness: 0.48,
    metalness: 0.06,
  })
  const soleMat = new THREE.MeshStandardMaterial({
    color: '#f4f0e8',
    roughness: 0.72,
    metalness: 0,
  })
  const darkMat = new THREE.MeshStandardMaterial({
    color: pipHex,
    roughness: 0.78,
    metalness: 0.02,
  })
  root.userData.mats = [bodyMat, soleMat, darkMat]

  const left = makeLeg(-1, bodyMat, soleMat, darkMat)
  const right = makeLeg(1, bodyMat, soleMat, darkMat)
  root.add(left, right)
  root.userData.left = left
  root.userData.right = right
  root.userData.phase = 0
  return root
}

/**
 * One chubby round sneaker (M&M candy shoes): fat upper sphere + white sole.
 * Rest sole bottom ≈ y −0.34 (see HIP_TO_SOLE).
 */
function makeLeg(side, bodyMat, soleMat, darkMat) {
  const hip = new THREE.Group()
  // Float below the die with a clear gap (like fists beside the body).
  hip.position.set(side * 0.28, -0.05, 0.04)
  hip.userData.side = side
  hip.userData.baseY = -0.05

  const shoe = new THREE.Group()
  shoe.position.set(0, -0.16, -0.02)

  // Chunky round upper — the candy “sneaker” body.
  const upper = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 12), bodyMat)
  upper.scale.set(1.15, 0.92, 1.35)
  upper.position.set(0, 0.02, -0.02)
  upper.castShadow = true
  upper.receiveShadow = true
  shoe.add(upper)

  // Soft ankle cuff peeking up toward the die (still detached).
  const cuff = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), bodyMat)
  cuff.scale.set(1.05, 0.7, 1.05)
  cuff.position.set(0, 0.095, 0.01)
  cuff.castShadow = true
  shoe.add(cuff)

  // Fat white midsole / platform.
  const sole = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), soleMat)
  sole.scale.set(1.35, 0.42, 1.55)
  sole.position.set(0, -0.07, -0.02)
  sole.castShadow = true
  sole.receiveShadow = true
  shoe.add(sole)

  // Dark outsole strip under the white.
  const outsole = new THREE.Mesh(new THREE.SphereGeometry(0.095, 10, 8), darkMat)
  outsole.scale.set(1.32, 0.22, 1.5)
  outsole.position.set(0, -0.105, -0.02)
  outsole.castShadow = true
  outsole.receiveShadow = true
  shoe.add(outsole)

  // Tiny toe bump for read.
  const toe = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), bodyMat)
  toe.scale.set(1.15, 0.85, 1.0)
  toe.position.set(0, -0.01, -0.14)
  toe.castShadow = true
  shoe.add(toe)

  hip.add(shoe)
  hip.userData.boot = shoe
  return hip
}

export function setLegsColor(root, color) {
  if (!root?.userData?.mats?.[0] || color == null) return
  root.userData.mats[0].color.set(color)
}

/**
 * Drive a CubeWorld-style wide stride. Forward = local −Z (matches cube face).
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

  const len = Math.hypot(facingX, facingZ)
  const yaw = len < 1e-6 ? 0 : Math.atan2(-facingX / len, -facingZ / len)
  root.rotation.set(0, yaw, 0)

  const moving = grounded && speed > 0.25
  const pace = Math.min(speed / 5.2, 1.85)
  // Faster, livelier cadence when sprinting.
  const stepRate = 10.5 + pace * 3.2
  if (moving) root.userData.phase += dt * stepRate
  else root.userData.phase *= Math.max(0, 1 - dt * 5.5)

  const ph = root.userData.phase
  // Wide forward swing + high step like CubeWorld toy legs.
  const amp = moving ? 0.42 + pace * 0.38 : 0.028
  const liftAmp = moving ? 0.09 + pace * 0.07 : 0
  const strideZ = moving ? 0.07 + pace * 0.06 : 0
  const spread = moving ? 0.04 + pace * 0.03 : 0.02
  const idle = moving ? 0 : Math.sin(performance.now() * 0.0024) * 0.022

  for (const [leg, offset] of [[left, 0], [right, Math.PI]]) {
    const side = leg.userData.side
    const wave = Math.sin(ph + offset)
    const liftWave = Math.max(0, Math.sin(ph + offset))
    const swing = wave * amp + idle * (offset ? -1 : 1)
    const lift = liftWave * liftAmp

    // Plant farther apart and step forward/back along facing (−Z).
    leg.position.x = side * (0.28 + spread)
    leg.position.y = leg.userData.baseY + lift
    leg.position.z = -wave * strideZ

    leg.rotation.x = -swing
    leg.rotation.z = side * (0.05 + pace * 0.04)
    leg.rotation.y = side * wave * 0.08 * pace

    if (leg.userData.boot) {
      // Toe points down on the forward swing, lifts on the back swing.
      leg.userData.boot.rotation.x = moving ? swing * 0.55 + liftWave * 0.2 : 0.02
    }
  }

  root.userData.gaitAmp = amp
}

export function disposeLegs(root) {
  if (!root) return
  for (const m of root.userData.mats || []) m.dispose?.()
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose()
  })
}
