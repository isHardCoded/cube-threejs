export const HALF = 4        // each platform spans cells [-HALF..HALF]
export const LEVELS = 3
export const LEVEL_H = 7     // vertical distance between platforms

export const levelY = (l) => l * LEVEL_H
export const cellKey = (x, z) => `${x},${z}`
export const inArena = (x, z) => x >= -HALF && x <= HALF && z >= -HALF && z <= HALF

// outermost ring size: the fence collapses once all of it is gone
export const RIM_CELLS = (2 * HALF + 1) * 4 - 4

// Obstacle placement is not here on purpose: the server owns it and sends the
// layout in `welcome`, so the two sides can never disagree about what blocks.
