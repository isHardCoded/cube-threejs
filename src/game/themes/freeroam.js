import * as THREE from 'three'
import {
  markCast, markReceive, POLISHED_POST, POLISHED_POST_NIGHT, POLISHED_SHADOWS, polishedGfx,
} from './gfxPolish.js'
import { canvasTexture, toon } from './kit.js'

// Local free-roam test map — PvE Arena moss palette, one seamless grass pad (no sectors).
const MOSS = '#8CDB66'
const MOSS_DEEP = '#6BBC5C'
const DIRT = '#6b5a45'
const GRASS = '#4f7a4a'
const WOOD = '#8a6444'
const LEAF = '#7BCF5A'
const ACCENT = '#e8a04a'

const TOON = { steps: 5 }

const decalTex = canvasTexture((ctx) => {
  ctx.fillStyle = '#9fd48a'
  ctx.globalAlpha = 0.55
  for (let i = 0; i < 14; i++) {
    const x = 10 + (i % 5) * 24
    const y = 14 + Math.floor(i / 5) * 40 + (i % 2) * 10
    ctx.beginPath()
    ctx.ellipse(x, y, 14, 7, (i % 3) * 0.35, 0, Math.PI * 2)
    ctx.fill()
  }
})

/** Playable pad half-extent in world units (clamp radius for the cube). */
export const FREEROAM_RADIUS = 14
export const FREEROAM_FLOOR = FREEROAM_RADIUS * 2 + 2

function createBackdrop(scene) {
  const group = new THREE.Group()
  scene.add(group)

  const dirtMat = toon(DIRT, TOON)
  const grassMat = toon(GRASS, TOON)
  const rockMat = toon('#6a7380', TOON)

  const ground = new THREE.Mesh(new THREE.CylinderGeometry(48, 52, 1.4, 32), dirtMat)
  ground.position.y = -1.2
  markReceive(ground)
  group.add(ground)

  const ring = new THREE.Mesh(new THREE.TorusGeometry(30, 2.4, 6, 36), grassMat)
  ring.rotation.x = Math.PI / 2
  ring.position.y = -0.4
  markReceive(ring)
  group.add(ring)

  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2
    const r = 32 + (i % 3) * 1.8
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.9 + (i % 3) * 0.4, 0),
      rockMat,
    )
    rock.position.set(Math.cos(a) * r, -0.2, Math.sin(a) * r)
    rock.rotation.set(i * 0.3, a, i * 0.2)
    markCast(rock, 'heavy')
    group.add(rock)
  }

  const skins = [
    [dirtMat, DIRT, '#3a4255'],
    [grassMat, GRASS, '#2f4a48'],
    [rockMat, '#6a7380', '#4a5568'],
  ]

  return {
    update() {},
    setDay(day) {
      for (const [mat, d, n] of skins) mat.color.set(day ? d : n)
    },
  }
}

function createProps() {
  function trampoline() {
    const g = new THREE.Group()
    g.visible = false
    return { g, pad: null, ring: null, bounce: 0 }
  }
  return {
    byKind: {},
    fallback: () => new THREE.Group(),
    trampoline,
  }
}

export default {
  id: 'freeroam',
  singleLevel: true,
  bareFloor: true,
  seamlessFloor: true,
  floorSize: FREEROAM_FLOOR,
  playRadius: FREEROAM_RADIUS,
  gridHalf: Math.ceil(FREEROAM_RADIUS),
  materialSteps: 5,
  surface: {
    tileA: MOSS,
    tileB: MOSS_DEEP,
    tileC: '#9EE67A',
    tileD: '#52A34D',
    tileBevel: 0.14,
    tileBevelSegs: 3,
    base: DIRT,
    rim: [MOSS, MOSS_DEEP],
    rebar: '#78C068',
    grid: ['#C8E890', LEAF],
    frame: ACCENT,
    fence: MOSS,
    post: WOOD,
    decal: '#A8D888',
    decalTex,
    pad: LEAF,
    debris: [WOOD, '#4a7a3a', MOSS],
  },
  accents: [ACCENT, '#7ec8e8'],
  post: POLISHED_POST,
  shadows: {
    ...POLISHED_SHADOWS,
    extent: 56,
    extentY: 56,
    sunOffset: [24, 30, 18],
  },
  gfx: polishedGfx({ fillColor: '#ffe4c4', fillColorNight: '#7a8aa0' }),
  day: {
    sky: '#6EC8E8',
    fogNear: 40,
    fogFar: 130,
    hemiSky: '#E8F4FF',
    hemiGround: '#C8B890',
    hemiIntensity: 0.5,
    sunColor: '#FFE2A8',
    sunIntensity: 3.8,
    accentIntensity: 0.35,
    underGlow: '#3a4555',
    underGlowIntensity: 0.08,
    spot: '#e0ffe8',
    spotIntensity: 0.2,
    bloom: 0.07,
    exposure: 0.9,
    post: POLISHED_POST,
  },
  night: {
    sky: '#1a2e28',
    fogNear: 24,
    fogFar: 95,
    hemiSky: '#4a7060',
    hemiGround: '#3a4830',
    hemiIntensity: 0.4,
    sunColor: '#b8d0ff',
    sunIntensity: 1.5,
    accentIntensity: 0.55,
    underGlow: '#1a2230',
    underGlowIntensity: 0.12,
    spot: '#e0ffe8',
    spotIntensity: 0.25,
    bloom: 0.12,
    exposure: 0.78,
    post: POLISHED_POST_NIGHT,
  },
  createBackdrop,
  createProps,
}
