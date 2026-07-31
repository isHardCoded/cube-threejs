import * as THREE from 'three'
import {
  markCast, markReceive, POLISHED_POST, POLISHED_POST_NIGHT, POLISHED_SHADOWS, polishedGfx,
} from './gfxPolish.js'
import { canvasTexture, toon } from './kit.js'
import { ARENA_HALF } from '../layouts.js'

// Flat jungle-coloured plaza for PvE Arena — wide open sectors, no fences.
const MOSS = '#8CDB66'
const MOSS_DEEP = '#6BBC5C'
const TILE_C = '#9EE67A'
const TILE_D = '#52A34D'
const DIRT = '#6b5a45'
const GRASS = '#4f7a4a'
const WOOD = '#8a6444'
const LEAF = '#7BCF5A'
const ACCENT = '#e8a04a'

const TOON = { steps: 5 }

// Same moss blotches / spawn pad as jungle sectors.
const decalTex = canvasTexture((ctx) => {
  ctx.fillStyle = '#9fd48a'
  ctx.globalAlpha = 0.7
  for (let i = 0; i < 10; i++) {
    const x = 12 + (i % 5) * 24
    const y = 18 + Math.floor(i / 5) * 50 + (i % 2) * 8
    ctx.beginPath()
    ctx.ellipse(x, y, 10, 5, (i % 3) * 0.4, 0, Math.PI * 2)
    ctx.fill()
  }
})

const padTex = canvasTexture((ctx) => {
  ctx.strokeStyle = '#c8f0a0'
  ctx.lineWidth = 7
  ctx.beginPath()
  ctx.arc(64, 64, 48, 0, Math.PI * 2)
  ctx.stroke()
  ctx.lineWidth = 4
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    ctx.beginPath()
    ctx.moveTo(64 + Math.cos(a) * 22, 64 + Math.sin(a) * 22)
    ctx.lineTo(64 + Math.cos(a) * 42, 64 + Math.sin(a) * 42)
    ctx.stroke()
  }
})

function createBackdrop(scene) {
  const group = new THREE.Group()
  scene.add(group)

  const dirtMat = toon(DIRT, TOON)
  const grassMat = toon(GRASS, TOON)
  const rockMat = toon('#6a7380', TOON)

  // Wide enough to read past a 27×27 sector floor.
  const ground = new THREE.Mesh(new THREE.CylinderGeometry(72, 78, 1.4, 32), dirtMat)
  ground.position.y = -1.2
  markReceive(ground)
  group.add(ground)

  const ring = new THREE.Mesh(new THREE.TorusGeometry(46, 3.2, 6, 40), grassMat)
  ring.rotation.x = Math.PI / 2
  ring.position.y = -0.4
  markReceive(ring)
  group.add(ring)

  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2
    const r = 48 + (i % 3) * 2.2
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(1.0 + (i % 3) * 0.45, 0),
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
    const padMat = new THREE.MeshStandardMaterial({
      color: ACCENT, emissive: ACCENT, emissiveIntensity: 0,
    })
    const ringMat = new THREE.MeshStandardMaterial({
      color: ACCENT, emissive: ACCENT, emissiveIntensity: 0,
    })
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.08, 12), padMat)
    pad.position.y = 0.17
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.04, 6, 16), ringMat)
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.16
    g.add(pad, ring)
    g.visible = false
    return { g, pad, ring, bounce: 0 }
  }

  return {
    byKind: {},
    fallback: () => new THREE.Group(),
    trampoline,
  }
}

export default {
  id: 'arena',
  singleLevel: true,
  bareFloor: true, // no fence / frame / rim rocks
  gridHalf: ARENA_HALF,
  materialSteps: 5,
  surface: {
    // Same candy moss sectors as jungle
    tileA: MOSS,
    tileB: MOSS_DEEP,
    tileC: TILE_C,
    tileD: TILE_D,
    tileBevel: 0.11,
    tileBevelSegs: 3,
    tileHeightJitter: 0.022,
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
    padTex,
    debris: [WOOD, '#4a7a3a', MOSS],
  },
  accents: [ACCENT, '#7ec8e8'],
  post: POLISHED_POST,
  shadows: {
    ...POLISHED_SHADOWS,
    extent: 72,
    extentY: 72,
    sunOffset: [28, 34, 22],
  },
  gfx: polishedGfx({ fillColor: '#ffe4c4', fillColorNight: '#7a8aa0' }),
  day: {
    sky: '#6EC8E8',
    fogNear: 50,
    fogFar: 160,
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
    fogNear: 28,
    fogFar: 110,
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
