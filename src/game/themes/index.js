import cyberpunk from './cyberpunk.js'
import lava from './lava.js'
import desert from './desert.js'

// A theme owns everything that makes one map look like itself. The arena
// geometry, the rules and the animations are shared by all maps; only colours,
// lighting, the backdrop and the obstacle meshes change.
//
// Shape of a theme:
//
//   id: string                          matches the server map id
//
//   surface: {                          arena furniture colours (platforms.js)
//     tileA, tileB,                     checkerboard floor
//     base,                             the chunk of ground under each tile
//     rim: [c1, c2], rebar,             torn edge hanging below the platform
//     grid: [c1, c2],                   lines over the tile seams
//     frame, fence, post,               glowing edge bar and the safety fence
//     decal, pad,                       floor marks
//     debris: [c1, c2],
//   }
//
//   accents: [c1, c2]                   the two accent point lights
//
//   night / day: {                      lighting per mode (environment.js)
//     sky, fogNear, fogFar,
//     hemiSky, hemiGround, hemiIntensity,
//     sunColor, sunIntensity,
//     accentIntensity,
//     underGlow, underGlowIntensity,
//     spot, spotIntensity,              overhead light above each platform
//     bloom, exposure,
//   }
//
//   createBackdrop(scene, fx)           everything outside the arena
//     -> { update(dt, t), setDay(day) }
//
//   createProps(fx)                     obstacle meshes by server kind
//     -> { byKind: { [kind]: (x, z) => Object3D }, fallback, trampoline() }
//
// fx is the shared animation registry: { blinkers, holos, platformSpots }.
// Anything a theme animates itself belongs in its own update().
const THEMES = { cyberpunk, lava, desert }

export function themeFor(id) {
  return THEMES[id] || cyberpunk
}
