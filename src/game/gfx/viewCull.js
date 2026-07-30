import * as THREE from 'three'

const _projScreen = new THREE.Matrix4()
const _sphere = new THREE.Sphere()

/**
 * Camera frustum for "only what you see" culling.
 * Call after camera pose is finalized for the frame.
 */
export function syncViewFrustum(camera, target) {
  camera.updateMatrixWorld()
  _projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  target.setFromProjectionMatrix(_projScreen)
  return target
}

/**
 * Sphere vs frustum with hysteresis so objects don't flicker at the edge.
 * @param {THREE.Frustum} frustum
 * @param {THREE.Vector3} center world-space
 * @param {number} radius
 * @param {boolean} shown currently visible
 * @param {number} padIn extra radius when hidden (must enter farther in)
 * @param {number} padOut extra radius when shown (leaves later)
 */
export function sphereVisible(frustum, center, radius, shown, padIn = 2.5, padOut = 7) {
  _sphere.center.copy(center)
  _sphere.radius = Math.max(0.01, radius) + (shown ? padOut : padIn)
  return frustum.intersectsSphere(_sphere)
}

/** World-space bounding sphere for a mesh (call after updateMatrixWorld). */
export function captureWorldSphere(obj) {
  const center = new THREE.Vector3()
  let radius = 1.5
  if (obj.isMesh && obj.geometry) {
    if (!obj.geometry.boundingSphere) obj.geometry.computeBoundingSphere()
    const bs = obj.geometry.boundingSphere
    if (bs) {
      center.copy(bs.center).applyMatrix4(obj.matrixWorld)
      radius = bs.radius * obj.matrixWorld.getMaxScaleOnAxis()
    } else {
      obj.getWorldPosition(center)
    }
  } else {
    obj.getWorldPosition(center)
  }
  return { center, radius: Math.max(radius, 0.35) }
}

export function createFrustum() {
  return new THREE.Frustum()
}
