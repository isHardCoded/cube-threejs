export const HALF = 4        // each platform spans cells [-HALF..HALF]
export const ARENA_HALF = 13 // PvE Arena ≈ 3× linear (27×27)
export const LEVELS = 3
export const LEVEL_H = 12    // vertical distance between platforms

// Live play half — Arena welcome sets this to ARENA_HALF.
let playHalf = HALF
export function setPlayHalf(h) {
  const n = Number(h)
  playHalf = Number.isFinite(n) && n > 0 ? n : HALF
}
export function getPlayHalf() {
  return playHalf
}

export const levelY = (l) => l * LEVEL_H
// Optional theme.arenaLift raises level-0 so a floating arena reads above the ground.
export const floorY = (level, lift = 0) => levelY(level) + (level === 0 ? lift : 0)
export const cellKey = (x, z) => `${x},${z}`
export const inArena = (x, z) => {
  const h = playHalf
  return x >= -h && x <= h && z >= -h && z <= h
}

export function rimCellCount(half = playHalf) {
  return (2 * half + 1) * 4 - 4
}

// outermost ring size: the fence collapses once all of it is gone
export const RIM_CELLS = (2 * HALF + 1) * 4 - 4

// Obstacle placement is not here on purpose: the server owns it and sends the
// layout in `welcome`, so the two sides can never disagree about what blocks.
