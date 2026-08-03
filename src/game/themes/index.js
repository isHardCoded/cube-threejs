import { preloadGltf } from '../assets/gltf.js'
import {
  jungleTextureMaps, jungleTextureUrls, preloadToonTextures,
} from '../assets/toonTextures.js'
import cyberpunk from './cyberpunk.js'
import lava from './lava.js'
import desert from './desert.js'
import kawaii from './kawaii.js'
import jungle from './jungle.js'
import ocean from './ocean.js'
import arena from './arena.js'
import freeroam from './freeroam.js'

// A theme owns everything that makes one map look like itself. The arena
// geometry, the rules and the animations are shared by all maps; only colours,
// lighting, the backdrop and the obstacle meshes change.
//
// Shape of a theme:
//
//   id: string                          matches the server map id
//
//   assets?: string[]                   optional GLB urls to preload before boot
//   authoredArena?: boolean             level-0 uses Blender rim/pad (skip procedural fence)
//   createArenaDressing?: () => Object3D|null
//
//   surface: {                          arena furniture colours (platforms.js)
//     tileA, tileB,                     checkerboard floor
//     tileMapA?, tileMapB?, baseMap?,   optional arcade albedo maps
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
//     post?: { vignette, contrast, saturation, sharpen },
//   }
//
//   post?: {...}                        default canvas grade (day look)
//   shadows?: {...}                     soft directional shadow volume
//   gfx?: { ao, godray, fill... }       post extras + quality overrides
//   materialSteps?: number              toon ramp bands for arena tiles
//
//   createBackdrop(scene, fx, opts?)    everything outside the arena
//     -> { update(dt, t), setDay(day), cullToCamera?(cam) }
//
//   createProps(fx)                     obstacle meshes by server kind
//     -> { byKind: { [kind]: (x, z) => Object3D }, fallback, trampoline() }
//
// fx is the shared animation registry: { blinkers, holos, platformSpots }.
// Anything a theme animates itself belongs in its own update().
// Polished maps share post/shadows/AO/godrays via themes/gfxPolish.js until
// authored Blender backdrops replace procedural scenery.
const THEMES = { cyberpunk, lava, desert, kawaii, jungle, ocean, arena, freeroam }

// Networked free-fight PvP reuses the freeroam moss pad look.
const freefight = { ...freeroam, id: 'freefight' }
THEMES.freefight = freefight

export function themeFor(id) {
  return THEMES[id] || cyberpunk
}

// Warm texture + GLB caches before createEnvironment so prop factories can
// clone synchronously. Safe to call for maps with no assets (no-op).
export async function preloadThemeAssets(id) {
  const theme = themeFor(id)
  if (id !== 'jungle') {
    return preloadGltf(theme.assets || [], {
      steps: theme.materialSteps || 4,
      palette: theme.materialPalette || null,
    })
  }

  await preloadToonTextures(jungleTextureUrls())

  const assets = theme.assets || []
  const sceneUrl = assets.find((u) => String(u).includes('/backdrop/scene'))
  const propUrls = assets.filter((u) => u !== sceneUrl)

  // Backdrop: keep Blender materials / atlas / vertex colours exactly.
  if (sceneUrl) {
    await preloadGltf([sceneUrl], { preserveMaterials: true })
  }

  // Arena obstacle props stay on the candy toon path (unchanged look).
  if (propUrls.length) {
    await preloadGltf(propUrls, {
      // Strip photo albedos on prop GLBs — flat candy + palette.
      maps: jungleTextureMaps(),
      palette: theme.materialPalette || null,
      steps: theme.materialSteps || 7,
    })
  }

  // Arena tiles stay flat Fall Guys colour — no moss photo noise.
  theme.surface.tileMapA = null
  theme.surface.tileMapB = null
  theme.surface.baseMap = null
  theme.surface.rimMap = null
}
