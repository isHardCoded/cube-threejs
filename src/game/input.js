import { sfx } from './sfx.js'

const DOUBLE_TAP_MS = 260
// keep the send rate in lockstep with the server's roll cooldown: extra
// key presses are dropped instead of queueing up and playing after release
const MOVE_GATE_MS = 140

const KEYS = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
}

// Keyboard + swipe. Double tap in the same direction dashes, space jumps.
export function createInput({ canvas, players: pm, send }) {
  let moveGateAt = 0
  let lastDir = null
  let lastDirAt = 0
  let lastMoveDir = [0, -1] // direction the jump will use

  function inputDir(dx, dz) {
    if (!pm.canPlay()) return
    const now = performance.now()
    const isDouble = lastDir && lastDir[0] === dx && lastDir[1] === dz && (now - lastDirAt) < DOUBLE_TAP_MS
    lastDir = [dx, dz]
    lastDirAt = now
    lastMoveDir = [dx, dz]

    if (isDouble && now >= pm.local.dashReadyAt) {
      pm.predictDash(dx, dz)
      send({ t: 'dash', dx, dz })
      moveGateAt = now + MOVE_GATE_MS
      lastDir = null // don't chain triple-tap into two dashes
    } else {
      const me = pm.me()
      if (now < moveGateAt || (me && me.queue.length >= 2)) return
      // walls and obstacles are known client-side: don't send a doomed move
      if (!pm.predictRoll(dx, dz)) return
      moveGateAt = now + MOVE_GATE_MS
      send({ t: 'move', dx, dz })
    }
  }

  function inputJump() {
    if (!pm.canPlay()) return
    if (performance.now() < pm.local.jumpReadyAt) {
      sfx.deny()
      return
    }
    send({ t: 'jump', dx: lastMoveDir[0], dz: lastMoveDir[1] })
  }

  // The server decides whether the mine is actually laid (cooldown, limit, cell),
  // and answers with either "mine" or "denied".
  function inputMine() {
    if (!pm.canPlay()) return
    if (performance.now() < pm.local.mineReadyAt) {
      sfx.deny()
      return
    }
    send({ t: 'mine' })
  }

  function onKeyDown(e) {
    if (e.repeat) return
    if (e.code === 'Space') { e.preventDefault(); inputJump(); return }
    if (e.code === 'KeyE') { e.preventDefault(); inputMine(); return }
    const dir = KEYS[e.code]
    if (dir) { e.preventDefault(); inputDir(dir[0], dir[1]) }
  }

  let touchStart = null
  function onPointerDown(e) {
    touchStart = { x: e.clientX, y: e.clientY, t: performance.now() }
  }
  function onPointerUp(e) {
    if (!touchStart) return
    const dx = e.clientX - touchStart.x
    const dy = e.clientY - touchStart.y
    const dt = performance.now() - touchStart.t
    touchStart = null
    if (Math.hypot(dx, dy) < 24) {
      // quick tap without swipe = jump (mobile)
      if (dt < 220) inputJump()
      return
    }
    if (Math.abs(dx) > Math.abs(dy)) inputDir(Math.sign(dx), 0)
    else inputDir(0, Math.sign(dy))
  }

  function onPointerCancel() {
    touchStart = null
  }

  window.addEventListener('keydown', onKeyDown)
  // pointer events live on the canvas so HUD buttons never trigger a jump
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerCancel)

  function dispose() {
    window.removeEventListener('keydown', onKeyDown)
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointerup', onPointerUp)
    canvas.removeEventListener('pointercancel', onPointerCancel)
  }

  // exposed for the on-screen ability button, which mobile has no key for
  return { dispose, placeMine: inputMine }
}
