import * as THREE from 'three'
import {
  markCast, markReceive, POLISHED_POST, POLISHED_POST_NIGHT, POLISHED_SHADOWS, polishedGfx,
} from './gfxPolish.js'
import { toon } from './kit.js'

// Jungle candy sector look for Duel Run track + battle arena.
const MOSS = '#8CDB66'
const MOSS_DEEP = '#6BBC5C'
const DIRT = '#F0D19E'
const WOOD = '#8a6444'
const LEAF = '#7BCF5A'
const LEAF_DARK = '#4f7a4a'
const FIREFLY = '#e8a04a'
const FLOWER = '#ff7ab6'

const TOON = { steps: 7 }

function createBackdrop(scene) {
  const group = new THREE.Group()
  scene.add(group)
  const ground = new THREE.Mesh(
    new THREE.CylinderGeometry(80, 86, 1.2, 28),
    toon('#6b5a45', TOON),
  )
  ground.position.y = -8
  markReceive(ground)
  group.add(ground)

  const grass = toon(LEAF_DARK, TOON)
  const rock = toon('#6a7380', TOON)
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2
    const r = 36 + (i % 3) * 2
    const bush = new THREE.Mesh(new THREE.DodecahedronGeometry(1.2 + (i % 3) * 0.35, 0), grass)
    bush.position.set(Math.cos(a) * r, -6.5, Math.sin(a) * r)
    markCast(bush, 'prop')
    group.add(bush)
    if (i % 2 === 0) {
      const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.9, 0), rock)
      stone.position.set(Math.cos(a + 0.2) * (r + 3), -7, Math.sin(a + 0.2) * (r + 3))
      markCast(stone, 'heavy')
      group.add(stone)
    }
  }

  // Soft cloud pillows under the floating track
  const cloud = toon('#eef6ff', TOON)
  for (let i = 0; i < 10; i++) {
    const c = new THREE.Mesh(new THREE.SphereGeometry(2.2 + (i % 3) * 0.5, 10, 8), cloud)
    const a = (i / 10) * Math.PI * 2
    c.position.set(Math.cos(a) * 18, 6 + (i % 3), Math.sin(a) * 22 - 4)
    c.scale.set(1.6, 0.55, 1.2)
    group.add(c)
  }

  return { update() {}, setDay() {} }
}

function createProps() {
  const wood = toon(WOOD, TOON)
  const leaf = toon(LEAF, TOON)
  function stump(x, z) {
    const g = new THREE.Group()
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 0.55, 8), wood)
    s.position.set(x, 0.25, z)
    g.add(s)
    return g
  }
  function fern(x, z) {
    const g = new THREE.Group()
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.9, 5), leaf)
    f.position.set(x, 0.45, z)
    g.add(f)
    return g
  }
  return {
    byKind: {
      stump,
      fern,
      tree: fern,
      vine: fern,
      rock: stump,
      crate: stump,
    },
    fallback: stump,
    trampoline: () => new THREE.Group(),
  }
}

export default {
  id: 'duelrun',
  singleLevel: true,
  bareFloor: true,
  hideHands: true,
  gridHalf: 4,
  materialSteps: 7,
  arenaLift: 16, // floating sky track
  surface: {
    tileA: MOSS,
    tileB: MOSS_DEEP,
    tileC: '#9EE67A',
    tileD: '#52A34D',
    tileBevel: 0.11,
    tileBevelSegs: 3,
    tileHeightJitter: 0.022,
    base: DIRT,
    rim: [MOSS, MOSS_DEEP],
    rebar: '#78C068',
    grid: ['#C8E890', LEAF],
    frame: FIREFLY,
    fence: MOSS,
    post: WOOD,
    decal: '#A8D888',
    pad: LEAF,
    debris: [WOOD, LEAF_DARK, MOSS],
  },
  accents: [FIREFLY, FLOWER],
  post: POLISHED_POST,
  shadows: {
    ...POLISHED_SHADOWS,
    extent: 56,
    extentY: 58,
    sunOffset: [22, 28, 18],
    bias: -0.00035,
    normalBias: 0.035,
    radius: 5.5,
  },
  gfx: polishedGfx({ fillColor: '#ffe4c4', fillColorNight: '#7a8aa0' }),
  day: {
    sky: '#6EC8E8',
    fogNear: 42,
    fogFar: 135,
    hemiSky: '#E8F4FF',
    hemiGround: '#C8B890',
    hemiIntensity: 0.48,
    sunColor: '#FFE2A8',
    sunIntensity: 4,
    accentIntensity: 0.9,
    underGlow: '#8AD070',
    underGlowIntensity: 0.4,
    spot: '#fff6e8',
    spotIntensity: 2.1,
    bloom: 0.07,
    exposure: 0.81,
    post: { vignette: 0.9, contrast: 1.08, saturation: 1.2, sharpen: 0.04 },
  },
  night: {
    sky: '#1a2e28',
    fogNear: 28,
    fogFar: 110,
    hemiSky: '#4a7060',
    hemiGround: '#3a4830',
    hemiIntensity: 0.4,
    sunColor: '#b8d0ff',
    sunIntensity: 1.45,
    accentIntensity: 0.55,
    underGlow: FIREFLY,
    underGlowIntensity: 0.2,
    spot: '#e0ffe8',
    spotIntensity: 0.3,
    bloom: 0.12,
    exposure: 0.78,
    post: POLISHED_POST_NIGHT,
  },
  createBackdrop,
  createProps,
}
