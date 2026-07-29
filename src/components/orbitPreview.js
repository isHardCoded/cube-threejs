// Shared orbit + zoom for wardrobe 3D previews (die + mine).
// Zoom only goes inward from the starting distance — you cannot pull out further.

export function createOrbit(camera, {
  targetY = 0,
  dist = 3.2,
  minDist = 1.6,
  yaw = 0.7,
  pitch = 0.45,
  idleSpin = 0.45,
} = {}) {
  let startDist = dist
  const state = {
    yaw,
    pitch,
    dist,
    dragging: false,
    lastX: 0,
    lastY: 0,
    idleSpin,
    moved: false,
  }

  function applyCamera() {
    const phi = Math.PI / 2 - state.pitch
    camera.position.set(
      state.dist * Math.sin(phi) * Math.sin(state.yaw),
      state.dist * Math.cos(phi) + targetY,
      state.dist * Math.sin(phi) * Math.cos(state.yaw),
    )
    camera.lookAt(0, targetY, 0)
  }

  /** Reframe around a newly fitted object (raises zoom-out ceiling). */
  function frame(nextDist, nextYaw = state.yaw, nextPitch = state.pitch) {
    state.dist = nextDist
    startDist = Math.max(startDist, nextDist)
    state.yaw = nextYaw
    state.pitch = nextPitch
    applyCamera()
  }

  function attach(el) {
    function onDown(e) {
      state.dragging = true
      state.moved = false
      state.lastX = e.clientX
      state.lastY = e.clientY
      try { el.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    }

    function onMove(e) {
      if (!state.dragging) return
      const dx = e.clientX - state.lastX
      const dy = e.clientY - state.lastY
      if (Math.abs(dx) + Math.abs(dy) > 2) state.moved = true
      state.lastX = e.clientX
      state.lastY = e.clientY
      state.yaw -= dx * 0.01
      state.pitch = Math.max(-1.2, Math.min(1.35, state.pitch + dy * 0.008))
      applyCamera()
    }

    function onUp(e) {
      state.dragging = false
      try { el.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
    }

    function onWheel(e) {
      e.preventDefault()
      // deltaY > 0 = scroll down = zoom out, but capped at the start distance
      state.dist = Math.max(minDist, Math.min(startDist, state.dist + e.deltaY * 0.004))
      applyCamera()
    }

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    el.addEventListener('wheel', onWheel, { passive: false })

    applyCamera()

    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      el.removeEventListener('wheel', onWheel)
    }
  }

  function tick(dt) {
    if (!state.dragging && state.idleSpin) {
      state.yaw += dt * state.idleSpin
      applyCamera()
    }
  }

  return { attach, tick, applyCamera, frame, state }
}
