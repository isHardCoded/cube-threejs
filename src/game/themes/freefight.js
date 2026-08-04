import freeroam from './freeroam.js'
import jungle, { LAKE_Y, LAKE_SWIM_R } from './jungle.js'

/**
 * Free-fight: same jungle world, but the lake is plastered with grass
 * (no freeroam moss platform, no water, no piranhas).
 * Players run on the filled lake basin.
 */
function createBackdrop(scene, fx, opts = {}) {
  return jungle.createBackdrop(scene, fx, { ...opts, noLake: true })
}

/** Top of the grass fill that replaced the water surface. */
const FIELD_Y = LAKE_Y + 0.22

const freefight = {
  ...jungle,
  id: 'freefight',
  singleLevel: true,
  bareFloor: true,
  // No procedural tile pad / raised platform — the meadow IS the floor.
  noArenaFloor: true,
  // Stand on the grass that covers the old lake.
  arenaLift: FIELD_Y,
  playRadius: LAKE_SWIM_R - 0.4,
  gridHalf: Math.floor(LAKE_SWIM_R - 0.5),
  createBackdrop,
  createProps: freeroam.createProps,
  lakeY: undefined,
  lakeRadius: undefined,
}

export default freefight
