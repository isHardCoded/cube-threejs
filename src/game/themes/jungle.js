import * as THREE from 'three'
import { blob, canvasTexture, cellRng, createDrift, geo, glow, pick, solid, toon } from './kit.js'

// Dense cartoon canopy: moss floors, emerald leaves, warm firefly accents.
const MOSS = '#6fad5a'
const MOSS_DEEP = '#4f8a42'
const DIRT = '#5a4028'
const WOOD = '#6b4a2e'
const LEAF = '#3f9a4a'
const LEAF_DARK = '#2d6e36'
const FLOWER = '#ff7eb3'
const FIREFLY = '#d4ff6a'

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

  const floorMat = toon('#3a6b34')
  const hillMat = toon(LEAF)
  const hillDark = toon(LEAF_DARK)
  const trunkMat = toon(WOOD)
  const canopyMat = toon('#4cb05a')
  const discMat = new THREE.MeshBasicMaterial({ color: '#fff4b0', fog: false })
  const hazeMat = new THREE.MeshBasicMaterial({
    color: '#a8e080', fog: false, transparent: true, opacity: 0.16, depthWrite: false,
  })

  const skins = [
    [floorMat, '#3a6b34', '#1e2a3a'],
    [hillMat, LEAF, '#2a4050'],
    [hillDark, LEAF_DARK, '#243848'],
    [trunkMat, WOOD, '#2e2838'],
    [canopyMat, '#4cb05a', '#355060'],
  ]

  const sea = new THREE.Mesh(geo('jungle:sea', () => new THREE.PlaneGeometry(220, 220)), floorMat)
  sea.rotation.x = -Math.PI / 2
  sea.position.y = -24
  group.add(sea)

  const hillGeo = geo('jungle:hill', () => blob(1, 1))
  for (let i = 0; i < 18; i++) {
    const angle = (i / 18) * Math.PI * 2 + Math.random() * 0.2
    const radius = 17 + Math.random() * 14
    const w = 4.5 + Math.random() * 4
    const h = 2.6 + Math.random() * 2
    const hill = new THREE.Mesh(hillGeo, i % 3 === 0 ? hillDark : hillMat)
    hill.scale.set(w, h, w * 0.75)
    hill.position.set(Math.cos(angle) * radius, -22, Math.sin(angle) * radius)
    hill.rotation.y = Math.random() * Math.PI
    group.add(hill)
  }

  // Far canopy trees
  const trunkGeo = geo('jungle:farTrunk', () => new THREE.CylinderGeometry(0.35, 0.55, 10, 7))
  const crownGeo = geo('jungle:farCrown', () => blob(1.6, 0))
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2 + 0.4
    const radius = 30 + Math.random() * 8
    const x = Math.cos(angle) * radius
    const z = Math.sin(angle) * radius
    const s = 0.85 + Math.random() * 0.4
    const trunk = new THREE.Mesh(trunkGeo, trunkMat)
    trunk.scale.setScalar(s)
    trunk.position.set(x, -19 + 5 * s, z)
    group.add(trunk)
    for (const [ly, lr] of [[10.2, 2.2], [9.2, 1.6]]) {
      const crown = new THREE.Mesh(crownGeo, canopyMat)
      crown.scale.set(lr * s, 0.7 * s, lr * s)
      crown.position.set(x, -19 + ly * s, z)
      group.add(crown)
    }
  }

  const disc = new THREE.Mesh(geo('jungle:disc', () => new THREE.CircleGeometry(3, 24)), discMat)
  disc.position.set(-22, -7, -28)
  disc.lookAt(0, -7, 0)
  group.add(disc)
  const haze = new THREE.Mesh(geo('jungle:haze', () => new THREE.CircleGeometry(7.5, 24)), hazeMat)
  haze.position.set(-21.4, -7, -27.2)
  haze.lookAt(0, -7, 0)
  group.add(haze)

  const motes = createDrift({
    count: 220, color: FIREFLY, size: 0.07, opacity: 0.45,
    spread: 34, top: 18, bottom: -4, speed: [-0.4, -0.12], sway: 0.7,
  })
  group.add(motes.points)
  const pollen = createDrift({
    count: 160, color: '#c8e8a0', size: 0.1, opacity: 0.2,
    spread: 50, top: -2, bottom: -20, speed: [-0.9, -0.3], sway: 1.2,
  })
  group.add(pollen.points)

  return {
    update(dt, t) {
      motes.update(dt, t)
      pollen.update(dt, t)
    },
    setDay(day) {
      for (const [m, d, n] of skins) m.color.set(day ? d : n)
      discMat.color.set(day ? '#fff4b0' : '#c8d8ff')
      hazeMat.color.set(day ? '#a8e080' : '#6a88c0')
      hazeMat.opacity = day ? 0.16 : 0.1
      motes.material.opacity = day ? 0.22 : 0.55
      pollen.material.opacity = day ? 0.28 : 0.14
    },
  }
}

function createProps(fx) {
  function tree(x, z) {
    const rnd = cellRng(x, z)
    const landmark = x === 0 && z === 0
    const g = new THREE.Group()
    const trunk = solid(new THREE.Mesh(
      geo('jungle:trunk', () => new THREE.CylinderGeometry(0.1, 0.16, 1.35, 7)), toon(WOOD)))
    trunk.position.y = 0.68
    g.add(trunk)

    const crownMat = toon(LEAF)
    const crownGeo = geo('jungle:crown', () => blob(0.55, 0))
    for (const [oy, s] of [[1.45, 1], [1.7, 0.72]]) {
      const crown = solid(new THREE.Mesh(crownGeo, crownMat))
      crown.position.y = oy
      crown.scale.set(s, s * 0.7, s)
      crown.rotation.y = rnd() * Math.PI
      g.add(crown)
    }

    if (rnd() < 0.5) {
      const flower = new THREE.Mesh(
        geo('jungle:bloom', () => new THREE.SphereGeometry(0.06, 8, 6)),
        glow(FLOWER, 0.7))
      flower.position.set((rnd() - 0.5) * 0.3, 1.55, (rnd() - 0.5) * 0.3)
      g.add(flower)
      fx.blinkers.push({ mesh: flower, phase: rnd() * 6, speed: 1.2 + rnd() })
    }

    g.position.set(x, 0, z)
    if (landmark) g.scale.set(1.15, 1.45, 1.15)
    else g.scale.setScalar(0.9 + rnd() * 0.18)
    g.rotation.y = rnd() * Math.PI
    return g
  }

  function vine(x, z) {
    const rnd = cellRng(x, z)
    const g = new THREE.Group()
    const post = solid(new THREE.Mesh(
      geo('jungle:vinePost', () => new THREE.CylinderGeometry(0.05, 0.07, 1.1, 6)), toon(WOOD)))
    post.position.y = 0.55
    g.add(post)

    const leafMat = toon(LEAF)
    const leafGeo = geo('jungle:leaf', () => {
      const geom = new THREE.ConeGeometry(0.12, 0.28, 4)
      geom.rotateZ(-Math.PI / 2)
      return geom
    })
    for (let i = 0; i < 5; i++) {
      const leaf = new THREE.Mesh(leafGeo, leafMat)
      leaf.position.set((rnd() - 0.5) * 0.15, 0.25 + i * 0.18, (i % 2) * 0.08)
      leaf.rotation.set(0, rnd() * 2, -0.5 - rnd() * 0.4)
      g.add(leaf)
    }
    g.position.set(x, 0, z)
    g.rotation.y = rnd() * Math.PI
    return g
  }

  function stump(x, z) {
    const rnd = cellRng(x, z)
    const g = new THREE.Group()
    const body = solid(new THREE.Mesh(
      geo('jungle:stump', () => new THREE.CylinderGeometry(0.28, 0.32, 0.38, 8)), toon(WOOD)))
    body.position.y = 0.19
    g.add(body)
    const top = solid(new THREE.Mesh(
      geo('jungle:stumpTop', () => new THREE.CylinderGeometry(0.26, 0.26, 0.05, 8)), toon('#8a6540')))
    top.position.y = 0.4
    g.add(top)
    const moss = new THREE.Mesh(
      geo('jungle:moss', () => blob(0.12, 0)), toon(MOSS))
    moss.position.set((rnd() - 0.5) * 0.2, 0.42, (rnd() - 0.5) * 0.2)
    moss.scale.set(1.2, 0.4, 1.2)
    g.add(moss)
    g.position.set(x, 0, z)
    g.rotation.y = rnd() * Math.PI
    return g
  }

  function fern(x, z) {
    const rnd = cellRng(x, z)
    const g = new THREE.Group()
    const frondMat = toon(LEAF)
    const frondGeo = geo('jungle:frond', () => {
      const geom = new THREE.ConeGeometry(0.1, 0.5, 4)
      geom.translate(0, 0.25, 0)
      return geom
    })
    for (let i = 0; i < 6; i++) {
      const frond = new THREE.Mesh(frondGeo, frondMat)
      frond.rotation.set(0.35 + rnd() * 0.25, (i / 6) * Math.PI * 2, 0)
      g.add(frond)
    }
    g.position.set(x, 0, z)
    g.scale.setScalar(0.85 + rnd() * 0.25)
    return g
  }

  function leafPile(x, z) {
    const rnd = cellRng(x, z)
    const g = new THREE.Group()
    const colors = [LEAF, LEAF_DARK, MOSS]
    const chunkGeo = geo('jungle:chunk', () => blob(0.12, 0))
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
      new THREE.CylinderGeometry(0.42, 0.46, 0.14, 20), toon(DIRT)))
    base.position.y = 0.07
    g.add(base)
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.36, 0.05, 10, 24), glow(FIREFLY, 0.9))
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.16
    g.add(ring)
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.3, 0.08, 20), glow(MOSS, 0.85))
    pad.position.y = 0.17
    g.add(pad)
    g.visible = false
    return { g, pad, ring, bounce: 0 }
  }

  return {
    byKind: { tree, vine, stump, fern },
    fallback: leafPile,
    trampoline,
  }
}

export default {
  id: 'jungle',

  surface: {
    tileA: MOSS, tileB: MOSS_DEEP,
    base: DIRT,
    rim: ['#5a8a3e', '#3f6a2e'], rebar: '#4a6e34',
    grid: ['#8fd46a', '#3a7a40'],
    frame: FIREFLY, fence: '#7ecf6a', post: WOOD,
    decal: '#8bc46a', decalTex,
    pad: LEAF, padTex,
    debris: [WOOD, LEAF_DARK, MOSS],
  },

  accents: [FIREFLY, FLOWER],

  night: {
    sky: '#14241c', fogNear: 24, fogFar: 80,
    hemiSky: '#3a6050', hemiGround: '#2a3820', hemiIntensity: 1.15,
    sunColor: '#a8c8ff', sunIntensity: 1.2,
    accentIntensity: 11,
    underGlow: FIREFLY, underGlowIntensity: 9,
    spot: '#d8ffe0', spotIntensity: 10,
    bloom: 0.2, exposure: 0.98,
  },

  day: {
    sky: '#7ec8a0', fogNear: 38, fogFar: 120,
    hemiSky: '#e8fff0', hemiGround: '#6a9a50', hemiIntensity: 1.85,
    sunColor: '#fff8d0', sunIntensity: 2.3,
    accentIntensity: 2.4,
    underGlow: '#90d070', underGlowIntensity: 2.4,
    spot: '#ffffff', spotIntensity: 5.5,
    bloom: 0.06, exposure: 1.0,
  },

  createBackdrop,
  createProps,
}
