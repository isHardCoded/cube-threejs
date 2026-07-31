import * as THREE from 'three'
import {
  markCast, markReceive, POLISHED_POST, POLISHED_POST_NIGHT, POLISHED_SHADOWS, polishedGfx,
} from './gfxPolish.js'
import { blob, canvasTexture, cellRng, createDrift, geo, glow, pick, solid, toon } from './kit.js'

// Underwater reef arena: teal water column, coral props, rising bubbles.
const SAND = '#d8c48a'
const SAND_DEEP = '#c4ae6e'
const TEAL = '#2ec4b6'
const TEAL_DEEP = '#1a8f9a'
const CORAL = '#ff6b7a'
const CORAL_SOFT = '#ff9a6b'
const KELP = '#2f8f5b'
const ROCK = '#6a7a8a'
const BUBBLE = '#c8f4ff'

const decalTex = canvasTexture((ctx) => {
  ctx.strokeStyle = '#fff8d8'
  ctx.lineWidth = 3
  ctx.globalAlpha = 0.55
  for (let i = 0; i < 6; i++) {
    ctx.beginPath()
    ctx.arc(30 + (i % 3) * 36, 36 + Math.floor(i / 3) * 48, 10 + (i % 2) * 4, 0, Math.PI * 2)
    ctx.stroke()
  }
})

const padTex = canvasTexture((ctx) => {
  ctx.strokeStyle = '#b8fff4'
  ctx.lineWidth = 7
  ctx.beginPath()
  ctx.arc(64, 64, 48, 0, Math.PI * 2)
  ctx.stroke()
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.arc(64, 64, 28, 0, Math.PI * 2)
  ctx.stroke()
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    ctx.beginPath()
    ctx.arc(64 + Math.cos(a) * 38, 64 + Math.sin(a) * 38, 5, 0, Math.PI * 2)
    ctx.stroke()
  }
})

function createBackdrop(scene, _fx, opts = {}) {
  const castMode = opts.shadowCast || 'heavy'
  const group = new THREE.Group()
  scene.add(group)

  const floorMat = toon('#1a6a78')
  const ridgeMat = toon(TEAL_DEEP)
  const ridgeLite = toon(TEAL)
  const rockMat = toon(ROCK)
  const discMat = new THREE.MeshBasicMaterial({ color: '#ffe8a0', fog: false })
  const hazeMat = new THREE.MeshBasicMaterial({
    color: '#5ad4e8', fog: false, transparent: true, opacity: 0.22, depthWrite: false,
  })

  const skins = [
    [floorMat, '#1a6a78', '#0e2438'],
    [ridgeMat, TEAL_DEEP, '#1a3048'],
    [ridgeLite, TEAL, '#244058'],
    [rockMat, ROCK, '#3a4458'],
  ]

  const sea = new THREE.Mesh(geo('ocean:sea', () => new THREE.PlaneGeometry(220, 220)), floorMat)
  sea.rotation.x = -Math.PI / 2
  sea.position.y = -24
  markReceive(sea)
  group.add(sea)

  const ridgeGeo = geo('ocean:ridge', () => blob(1, 1))
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2 + Math.random() * 0.2
    const radius = 16 + Math.random() * 14
    const w = 4 + Math.random() * 4
    const h = 2 + Math.random() * 2.4
    const ridge = new THREE.Mesh(ridgeGeo, i % 2 ? ridgeMat : ridgeLite)
    ridge.scale.set(w, h, w * 0.7)
    ridge.position.set(Math.cos(angle) * radius, -22, Math.sin(angle) * radius)
    ridge.rotation.y = Math.random() * Math.PI
    markReceive(ridge)
    group.add(ridge)
  }

  // Distant rock arches
  const pillarGeo = geo('ocean:pillar', () => new THREE.CylinderGeometry(0.6, 0.9, 8, 7))
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2 + 0.5
    const radius = 32 + Math.random() * 6
    const x = Math.cos(angle) * radius
    const z = Math.sin(angle) * radius
    const pillar = new THREE.Mesh(pillarGeo, rockMat)
    pillar.position.set(x, -18, z)
    pillar.scale.set(1, 1 + Math.random() * 0.4, 1)
    markCast(pillar, 'core', castMode)
    group.add(pillar)
  }

  // Surface light disc (sun filtered through water)
  const disc = new THREE.Mesh(geo('ocean:disc', () => new THREE.CircleGeometry(4, 28)), discMat)
  disc.position.set(10, 8, -26)
  disc.lookAt(0, -4, 0)
  group.add(disc)
  const haze = new THREE.Mesh(geo('ocean:haze', () => new THREE.CircleGeometry(10, 28)), hazeMat)
  haze.position.set(9.5, 7.5, -25)
  haze.lookAt(0, -4, 0)
  group.add(haze)

  // Bubbles rise (negative speed = upward in createDrift convention used by desert motes)
  const bubbles = createDrift({
    count: 280, color: BUBBLE, size: 0.09, opacity: 0.35,
    spread: 40, top: 16, bottom: -18, speed: [-1.4, -0.45], sway: 0.9,
  })
  group.add(bubbles.points)
  const silt = createDrift({
    count: 180, color: '#8ec8c0', size: 0.06, opacity: 0.18,
    spread: 55, top: 4, bottom: -22, speed: [-0.5, -0.15], sway: 1.4,
  })
  group.add(silt.points)

  return {
    update(dt, t) {
      bubbles.update(dt, t)
      silt.update(dt, t)
      disc.position.y = 8 + Math.sin(t * 0.4) * 0.35
    },
    setDay(day) {
      for (const [m, d, n] of skins) m.color.set(day ? d : n)
      discMat.color.set(day ? '#ffe8a0' : '#a8c8ff')
      hazeMat.color.set(day ? '#5ad4e8' : '#4060a0')
      hazeMat.opacity = day ? 0.22 : 0.14
      bubbles.material.opacity = day ? 0.32 : 0.4
      silt.material.opacity = day ? 0.2 : 0.12
    },
  }
}

function createProps(fx) {
  function coral(x, z) {
    const rnd = cellRng(x, z)
    const landmark = x === 0 && z === 0
    const g = new THREE.Group()
    const colors = [CORAL, CORAL_SOFT, '#ff8fd0']
    const branchGeo = geo('ocean:branch', () => new THREE.CylinderGeometry(0.05, 0.09, 0.55, 6))
    const tipGeo = geo('ocean:tip', () => new THREE.SphereGeometry(0.1, 8, 6))
    const count = landmark ? 7 : 4 + Math.floor(rnd() * 3)
    for (let i = 0; i < count; i++) {
      const mat = toon(pick(rnd, colors))
      const branch = solid(new THREE.Mesh(branchGeo, mat))
      const ang = (i / count) * Math.PI * 2
      branch.position.set(Math.cos(ang) * 0.12, 0.35, Math.sin(ang) * 0.12)
      branch.rotation.set(0.35 + rnd() * 0.3, ang, 0)
      g.add(branch)
      const tip = new THREE.Mesh(tipGeo, glow(pick(rnd, colors), 0.55))
      tip.position.set(Math.cos(ang) * 0.22, 0.7 + rnd() * 0.1, Math.sin(ang) * 0.22)
      g.add(tip)
      fx.blinkers.push({ mesh: tip, phase: rnd() * 6, speed: 0.9 + rnd() })
    }
    const base = solid(new THREE.Mesh(
      geo('ocean:coralBase', () => blob(0.22, 0)), toon(ROCK)))
    base.position.y = 0.12
    g.add(base)
    g.position.set(x, 0, z)
    if (landmark) g.scale.setScalar(1.35)
    else g.scale.setScalar(0.9 + rnd() * 0.2)
    g.rotation.y = rnd() * Math.PI
    return g
  }

  function kelp(x, z) {
    const rnd = cellRng(x, z)
    const g = new THREE.Group()
    const stalkMat = toon(KELP)
    const stalkGeo = geo('ocean:stalk', () => new THREE.CylinderGeometry(0.04, 0.07, 1.2, 6))
    for (let i = 0; i < 3; i++) {
      const stalk = solid(new THREE.Mesh(stalkGeo, stalkMat))
      stalk.position.set((i - 1) * 0.12, 0.6, (i % 2) * 0.06)
      stalk.rotation.z = (rnd() - 0.5) * 0.25
      g.add(stalk)
      const leaf = new THREE.Mesh(
        geo('ocean:kelpLeaf', () => new THREE.CapsuleGeometry(0.08, 0.2, 4, 6)),
        toon('#3aaa68'))
      leaf.position.set((i - 1) * 0.12, 1.15, 0)
      leaf.rotation.z = (rnd() - 0.5) * 0.6
      g.add(leaf)
    }
    g.position.set(x, 0, z)
    g.rotation.y = rnd() * Math.PI
    return g
  }

  function serock(x, z) {
    const rnd = cellRng(x, z)
    const g = new THREE.Group()
    const boulder = solid(new THREE.Mesh(geo('ocean:rock', () => blob(0.32, 0)), toon(ROCK)))
    boulder.position.y = 0.26
    boulder.scale.set(1 + rnd() * 0.1, 0.75 + rnd() * 0.15, 1 + rnd() * 0.1)
    boulder.rotation.set(rnd() * 2, rnd() * 2, rnd() * 2)
    g.add(boulder)
    if (rnd() < 0.6) {
      const patch = new THREE.Mesh(
        geo('ocean:algae', () => blob(0.1, 0)), toon(KELP))
      patch.position.set((rnd() - 0.5) * 0.25, 0.4, (rnd() - 0.5) * 0.25)
      patch.scale.set(1.1, 0.35, 1.1)
      g.add(patch)
    }
    g.position.set(x, 0, z)
    return g
  }

  function anemone(x, z) {
    const rnd = cellRng(x, z)
    const g = new THREE.Group()
    const body = solid(new THREE.Mesh(
      geo('ocean:anemBody', () => new THREE.CylinderGeometry(0.16, 0.2, 0.28, 10)),
      toon(CORAL_SOFT)))
    body.position.y = 0.14
    g.add(body)
    const tentGeo = geo('ocean:tent', () => new THREE.CapsuleGeometry(0.035, 0.22, 4, 6))
    for (let i = 0; i < 8; i++) {
      const tent = new THREE.Mesh(tentGeo, glow(pick(rnd, [CORAL, '#ffa0d0', TEAL]), 0.5))
      const a = (i / 8) * Math.PI * 2
      tent.position.set(Math.cos(a) * 0.12, 0.42, Math.sin(a) * 0.12)
      tent.rotation.set(0.5, a, 0)
      g.add(tent)
      fx.blinkers.push({ mesh: tent, phase: rnd() * 6 + i, speed: 1.4 + rnd() })
    }
    g.position.set(x, 0, z)
    g.scale.setScalar(0.9 + rnd() * 0.2)
    return g
  }

  function shellPile(x, z) {
    const rnd = cellRng(x, z)
    const g = new THREE.Group()
    const colors = [SAND, CORAL_SOFT, TEAL, ROCK]
    const chunkGeo = geo('ocean:shell', () => blob(0.11, 0))
    for (let i = 0; i < 4; i++) {
      const chunk = solid(new THREE.Mesh(chunkGeo, toon(pick(rnd, colors))))
      chunk.position.set((rnd() - 0.5) * 0.45, 0.08 + rnd() * 0.12, (rnd() - 0.5) * 0.45)
      chunk.scale.setScalar(0.7 + rnd() * 0.7)
      chunk.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3)
      g.add(chunk)
    }
    g.position.set(x, 0, z)
    return g
  }

  function trampoline() {
    const g = new THREE.Group()
    const base = solid(new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.46, 0.14, 20), toon(ROCK)))
    base.position.y = 0.07
    g.add(base)
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.36, 0.05, 10, 24), glow(TEAL, 0.95))
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.16
    g.add(ring)
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.3, 0.08, 20), glow(BUBBLE, 0.8))
    pad.position.y = 0.17
    g.add(pad)
    g.visible = false
    return { g, pad, ring, bounce: 0 }
  }

  return {
    byKind: { coral, kelp, serock, anemone },
    fallback: shellPile,
    trampoline,
  }
}

export default {
  id: 'ocean',

  surface: {
    tileA: SAND, tileB: SAND_DEEP,
    base: '#7a6a40',
    rim: [TEAL, TEAL_DEEP], rebar: '#4a8a80',
    grid: [TEAL, CORAL],
    frame: TEAL, fence: BUBBLE, post: ROCK,
    decal: TEAL_DEEP, decalTex,
    pad: TEAL, padTex,
    debris: [ROCK, CORAL_SOFT, KELP],
  },

  accents: [TEAL, CORAL],

  night: {
    sky: '#0a1e30', fogNear: 18, fogFar: 70,
    hemiSky: '#2a6088', hemiGround: '#1a3040', hemiIntensity: 1.1,
    sunColor: '#80c0ff', sunIntensity: 1.1,
    accentIntensity: 12,
    underGlow: TEAL, underGlowIntensity: 10,
    spot: '#c0e8ff', spotIntensity: 9,
    bloom: 0.22, exposure: 0.98,
    post: POLISHED_POST_NIGHT,
  },

  day: {
    sky: '#3aa8c8', fogNear: 42, fogFar: 130,
    hemiSky: '#b8f0ff', hemiGround: '#3a8a90', hemiIntensity: 0.55,
    sunColor: '#e8fff8', sunIntensity: 3.6,
    accentIntensity: 1.6,
    underGlow: '#40d0c8', underGlowIntensity: 1.0,
    spot: '#ffffff', spotIntensity: 2.4,
    bloom: 0.08, exposure: 0.86,
    post: POLISHED_POST,
  },

  createBackdrop,
  createProps,

  post: POLISHED_POST,
  shadows: POLISHED_SHADOWS,
  gfx: polishedGfx({
    fillColor: '#c8f0ff',
    fillColorNight: '#4a7088',
  }),
  materialSteps: 7,
}
