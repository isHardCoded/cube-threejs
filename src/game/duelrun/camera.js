import * as THREE from 'three'

const RunnerCam = {
  offset: new THREE.Vector3(0, 5.5, -9),
  lookAhead: 14,
  baseFov: 55,
  maxFov: 68,
  lerp: 8,
}

const BattleCam = {
  offset: new THREE.Vector3(0, 14, 12),
  lookAt: new THREE.Vector3(0, 0, 0),
  fov: 48,
  lerp: 6,
}

const TransitionCam = {
  lerp: 3,
}

export function createDuelCamera(camera) {
  let mode = 'runner' // runner | battle | transition
  const target = new THREE.Vector3()
  const look = new THREE.Vector3()

  function setMode(next) {
    if (next === mode) return
    mode = next === 'battle' ? 'battle' : next === 'transition' ? 'transition' : 'runner'
  }

  function update(dt, opts) {
    const {
      playerPos = new THREE.Vector3(),
      speed = 8,
      jumping = false,
      dashing = false,
      opponentPos = null,
    } = opts || {}

    const lerp = mode === 'battle' ? BattleCam.lerp : mode === 'transition' ? TransitionCam.lerp : RunnerCam.lerp
    const k = 1 - Math.exp(-lerp * dt)

    if (mode === 'battle') {
      const mid = opponentPos
        ? playerPos.clone().add(opponentPos).multiplyScalar(0.5)
        : playerPos.clone()
      target.copy(mid).add(BattleCam.offset)
      look.copy(mid)
      camera.fov += (BattleCam.fov - camera.fov) * k
    } else {
      const bumpY = (jumping ? 0.4 : 0) + (dashing ? 0.2 : 0)
      target.set(
        playerPos.x * 0.35,
        playerPos.y + RunnerCam.offset.y + bumpY,
        playerPos.z + RunnerCam.offset.z,
      )
      look.set(playerPos.x * 0.2, playerPos.y + 1, playerPos.z + RunnerCam.lookAhead)
      const fov = THREE.MathUtils.clamp(
        RunnerCam.baseFov + (speed - 8) * 0.6,
        RunnerCam.baseFov,
        RunnerCam.maxFov,
      )
      camera.fov += (fov - camera.fov) * k
    }

    camera.position.lerp(target, k)
    camera.lookAt(look)
    camera.updateProjectionMatrix()
  }

  return { setMode, update, profiles: { RunnerCam, BattleCam, TransitionCam } }
}
