import * as THREE from 'three'
import {
  markCast, markReceive, POLISHED_POST, POLISHED_POST_NIGHT, POLISHED_SHADOWS, polishedGfx,
} from './gfxPolish.js'
import { blob, canvasTexture, cellRng, createDrift, geo, glow, solid, toon } from './kit.js'

// Volcanic arena, cel shaded like the city map. The heat is carried by the
// lights and the warm rock tones, not by glare: the cubes have to stay the
// brightest things on screen even with a sea of magma under the platforms.
const LAVA = '#ff6a1e'
const EMBER = '#ffa347'
const DEEP = '#d33418'

// Plum-charcoal basalt. Kept well above black on purpose: against a glowing
// magma horizon anything darker turns into a flat cutout with no shape at all.
const CRUST = '#573f47'
const CRUST_LIT = '#6d525b'
const OBSIDIAN = '#41303c'

// cracked earth: kinked cracks radiating from the cell centre
const decalTex = canvasTexture((ctx) => {
  ctx.strokeStyle = EMBER
  ctx.lineCap = 'round'
  for (let i = 0; i < 7; i++) {
    const angle = (i / 7) * Math.PI * 2
    ctx.lineWidth = 7 - (i % 3) * 2
    ctx.beginPath()
    ctx.moveTo(64, 64)
    let x = 64
    let y = 64
    for (let s = 1; s <= 3; s++) {
      const bend = angle + Math.sin(i * 2.3 + s) * 0.5
      x += Math.cos(bend) * 22
      y += Math.sin(bend) * 22
      ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
})

// magma ring for the centre landing pad
const padTex = canvasTexture((ctx) => {
  ctx.strokeStyle = LAVA
  ctx.lineWidth = 9
  ctx.beginPath()
  ctx.arc(64, 64, 46, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = EMBER
  ctx.lineWidth = 4
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    ctx.beginPath()
    ctx.arc(64, 64, 32, a, a + 0.5)
    ctx.stroke()
  }
})

function createBackdrop(scene, fx, opts = {}) {
  const castMode = opts.shadowCast || 'heavy'
  const group = new THREE.Group()
  scene.add(group)

  // Truncated cone rather than a real cone: the flat top gives the crater glow
  // somewhere to sit, and one geometry scaled per volcano beats twelve cones.
  const coneGeo = geo('lava:cone', () => new THREE.CylinderGeometry(0.22, 1, 1, 7, 1))
  const craterGeo = geo('lava:crater', () => new THREE.CircleGeometry(1, 12))
  const ridgeGeo = geo('lava:ridge', () => new THREE.ConeGeometry(1, 1, 5))
  const fallGeo = geo('lava:fall', () => new THREE.PlaneGeometry(1, 1))

  // The horizon gets no local light, so a faint self-glow is what keeps the
  // volcanoes from flattening into black paper cutouts against the magma.
  const rockMats = [
    toon('#5c434c', { emissive: '#3a2228', emissiveIntensity: 0.5 }),
    toon('#4b353d', { emissive: '#301c22', emissiveIntensity: 0.5 }),
  ]
  const craterMats = [glow(LAVA, 0.9), glow(DEEP, 0.8)]
  // A self-lit magma sea filled two thirds of the screen and outshone the arena;
  // this reads as distant molten rock and leaves the platform as the bright spot.
  const seaMat = glow('#c9391b', 0.35)
  const fallMat = glow(EMBER, 0.8, { transparent: true, opacity: 0.7, side: THREE.DoubleSide })

  // the molten sea the whole arena floats over
  const sea = new THREE.Mesh(geo('lava:sea', () => new THREE.PlaneGeometry(150, 150)), seaMat)
  sea.rotation.x = -Math.PI / 2
  sea.position.y = -24
  markReceive(sea)
  group.add(sea)

  // cooled crust drifting on the sea, so the magma is not one flat orange field
  const raftGeo = geo('lava:raft', () => blob(1, 0))
  for (let i = 0; i < 7; i++) {
    const angle = (i / 7) * Math.PI * 2 + Math.random()
    const dist = 12 + Math.random() * 30
    const raft = new THREE.Mesh(raftGeo, rockMats[i % 2])
    raft.scale.set(4 + Math.random() * 7, 0.6, 3 + Math.random() * 6)
    raft.position.set(Math.cos(angle) * dist, -23.6, Math.sin(angle) * dist)
    raft.rotation.y = Math.random() * Math.PI
    markReceive(raft)
    group.add(raft)
  }

  // horizon ring of volcanoes
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2 + Math.random() * 0.24
    const dist = 16 + Math.random() * 18
    const r = 3 + Math.random() * 4.5
    const h = 9 + Math.random() * 13
    const cx = Math.cos(angle) * dist
    const cz = Math.sin(angle) * dist

    const cone = new THREE.Mesh(coneGeo, rockMats[i % 2])
    cone.scale.set(r, h, r)
    cone.position.set(cx, -22 + h / 2, cz)
    cone.rotation.y = Math.random() * Math.PI
    markCast(cone, i % 3 === 0 ? 'core' : 'heavy', castMode)
    group.add(cone)

    if (i % 2 === 0) {
      const crater = new THREE.Mesh(craterGeo, craterMats[(i / 2) % 2])
      crater.rotation.x = -Math.PI / 2
      crater.scale.setScalar(r * 0.2)
      crater.position.set(cx, -22 + h + 0.06, cz)
      group.add(crater)
    }

    if (i % 3 === 1) {
      const fall = new THREE.Mesh(fallGeo, fallMat)
      fall.scale.set(r * 0.16, h * 0.5, 1)
      fall.position.set(cx, -22 + h * 0.5, cz)
      fall.lookAt(0, fall.position.y, 0)
      fall.translateZ(r * 0.62)
      group.add(fall)
    }
  }

  // broken caldera rim just outside the arena, so the drop has a near edge
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2 + Math.random() * 0.3
    const dist = 14 + Math.random() * 2.5
    const h = 3 + Math.random() * 3.5
    const shard = new THREE.Mesh(ridgeGeo, rockMats[i % 2])
    shard.scale.set(1.4 + Math.random() * 1.6, h, 1.4 + Math.random() * 1.6)
    shard.position.set(Math.cos(angle) * dist, -6 + h / 2, Math.sin(angle) * dist)
    shard.rotation.set((Math.random() - 0.5) * 0.2, Math.random() * Math.PI, (Math.random() - 0.5) * 0.2)
    markCast(shard, 'heavy', castMode)
    group.add(shard)
  }

  const ash = createDrift({
    count: 300, color: '#c8b6b8', size: 0.09, opacity: 0.4,
    spread: 46, top: 22, bottom: -8, speed: [1.1, 2.4], sway: 0.5,
  })
  group.add(ash.points)

  // negative speed: embers climb out of the magma instead of falling
  const embers = createDrift({
    count: 240, color: EMBER, size: 0.13, opacity: 0.8,
    spread: 40, top: 20, bottom: -22, speed: [-3.4, -1.3], sway: 0.4,
    blending: THREE.AdditiveBlending,
  })
  group.add(embers.points)

  let craterBase = 0.9
  let seaBase = 0.8

  return {
    update(dt, t) {
      // craters breathe out of phase with each other
      craterMats[0].emissiveIntensity = craterBase + Math.sin(t * 0.9) * 0.12
      craterMats[1].emissiveIntensity = craterBase * 0.85 + Math.cos(t * 0.6) * 0.1
      seaMat.emissiveIntensity = seaBase + Math.sin(t * 0.45) * 0.06
      ash.update(dt, t)
      embers.update(dt, t)
    },
    setDay(day) {
      craterBase = day ? 0.5 : 0.9
      seaBase = day ? 0.45 : 0.8
      fallMat.opacity = day ? 0.4 : 0.7
      fallMat.emissiveIntensity = day ? 0.45 : 0.8
      ash.material.opacity = day ? 0.5 : 0.4
      embers.material.opacity = day ? 0.4 : 0.8
    },
  }
}

function createProps(fx) {
  // Shared per-role materials. Only the pulsing vent cores get their own, because
  // a blinker writes emissiveIntensity on its material every frame.
  const rock = toon(CRUST)
  const rockLit = toon(CRUST_LIT)
  const obsidian = toon(OBSIDIAN)
  const crack = glow(LAVA, 0.7)
  const seam = glow(DEEP, 0.55)

  function spire(x, z) {
    const rnd = cellRng(x, z)
    // the centre spire is the arena's landmark, so it towers over the rest
    const scale = x === 0 && z === 0 ? 1.45 : 0.95 + rnd() * 0.2
    const g = new THREE.Group()

    const shard = solid(new THREE.Mesh(
      geo('lava:spire', () => new THREE.ConeGeometry(0.26, 1.5, 5)), obsidian))
    shard.position.y = 0.75
    shard.rotation.y = rnd() * Math.PI
    g.add(shard)

    const splinter = solid(new THREE.Mesh(
      geo('lava:splinter', () => new THREE.ConeGeometry(0.12, 0.72, 4)), obsidian))
    splinter.position.set(0.16, 0.36, -0.13)
    splinter.rotation.set(0, rnd() * Math.PI, 0.2)
    g.add(splinter)

    const crackGeo = geo('lava:crack', () => new THREE.BoxGeometry(0.025, 0.42, 0.025))
    for (let i = 0; i < 3; i++) {
      const line = new THREE.Mesh(crackGeo, crack)
      const a = rnd() * Math.PI * 2
      line.position.set(Math.cos(a) * 0.12, 0.3 + rnd() * 0.6, Math.sin(a) * 0.12)
      line.rotation.set((rnd() - 0.5) * 0.35, a, (rnd() - 0.5) * 0.4)
      g.add(line)
    }

    g.position.set(x, 0, z)
    g.scale.setScalar(scale)
    return g
  }

  function boulder(x, z) {
    const rnd = cellRng(x, z)
    const g = new THREE.Group()

    const body = solid(new THREE.Mesh(geo('lava:boulder', () => blob(0.34, 1)), rock))
    body.position.y = 0.3
    body.scale.set(1, 0.85, 1.05)
    body.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3)
    g.add(body)

    const chipGeo = geo('lava:chip', () => blob(0.1, 0))
    for (let i = 0; i < 2; i++) {
      const chip = solid(new THREE.Mesh(chipGeo, rockLit))
      const a = rnd() * Math.PI * 2
      chip.position.set(Math.cos(a) * 0.26, 0.08, Math.sin(a) * 0.26)
      chip.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3)
      chip.scale.y = 0.7
      g.add(chip)
    }

    g.position.set(x, 0, z)
    g.rotation.y = rnd() * Math.PI
    return g
  }

  function vent(x, z) {
    const rnd = cellRng(x, z)
    const g = new THREE.Group()

    const lip = solid(new THREE.Mesh(
      geo('lava:ventLip', () => new THREE.CylinderGeometry(0.32, 0.4, 0.18, 7)), rock))
    lip.position.y = 0.09
    g.add(lip)

    const core = new THREE.Mesh(
      geo('lava:ventCore', () => new THREE.CylinderGeometry(0.24, 0.24, 0.06, 12)), glow(LAVA, 0.7))
    core.position.y = 0.18
    g.add(core)
    fx.blinkers.push({ mesh: core, phase: rnd() * Math.PI * 2, speed: 1.2 + rnd() * 1.3 })

    const toothGeo = geo('lava:ventTooth', () => new THREE.ConeGeometry(0.07, 0.28, 4))
    for (let i = 0; i < 3; i++) {
      const tooth = solid(new THREE.Mesh(toothGeo, rockLit))
      const a = (i / 3) * Math.PI * 2 + rnd() * 0.5
      tooth.position.set(Math.cos(a) * 0.24, 0.3, Math.sin(a) * 0.24)
      tooth.rotation.set(Math.cos(a) * 0.3, 0, -Math.sin(a) * 0.3)
      g.add(tooth)
    }

    g.position.set(x, 0, z)
    g.rotation.y = rnd() * Math.PI
    return g
  }

  function basalt(x, z) {
    const rnd = cellRng(x, z)
    const g = new THREE.Group()

    const colGeo = geo('lava:column', () => new THREE.CylinderGeometry(0.13, 0.13, 1, 6))
    const cluster = [[-0.13, -0.1, 0.86], [0.15, -0.04, 0.58], [0.01, 0.16, 0.7]]
    for (let i = 0; i < cluster.length; i++) {
      const [cx, cz, h] = cluster[i]
      const col = solid(new THREE.Mesh(colGeo, i === 1 ? rockLit : rock))
      col.scale.y = h * (0.9 + rnd() * 0.15)
      col.position.set(cx, col.scale.y / 2, cz)
      col.rotation.y = rnd() * Math.PI
      g.add(col)
    }

    // molten seam welding the broken columns together
    const glue = new THREE.Mesh(
      geo('lava:seam', () => new THREE.CylinderGeometry(0.3, 0.32, 0.05, 12)), seam)
    glue.position.y = 0.025
    g.add(glue)

    g.position.set(x, 0, z)
    g.rotation.y = rnd() * Math.PI
    return g
  }

  // Scorched rubble: the fallback for any kind this theme does not know.
  function rubble(x, z) {
    const rnd = cellRng(x, z)
    const g = new THREE.Group()
    for (let i = 0; i < 4; i++) {
      const chunk = solid(new THREE.Mesh(blob(0.1 + rnd() * 0.12, 0), i % 2 ? rock : rockLit))
      chunk.position.set((rnd() - 0.5) * 0.5, 0.1 + rnd() * 0.18, (rnd() - 0.5) * 0.5)
      chunk.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3)
      g.add(chunk)
    }
    g.position.set(x, 0, z)
    return g
  }

  // Geyser vent: same silhouette as the city trampoline so it still reads as
  // "jump here", only it launches you on a jet of magma.
  function trampoline() {
    const g = new THREE.Group()
    const base = solid(new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.46, 0.14, 20), toon(CRUST)))
    base.position.y = 0.07
    g.add(base)
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.36, 0.05, 10, 24), glow(EMBER, 0.9))
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.16
    g.add(ring)
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.3, 0.08, 20), glow(LAVA, 0.8))
    pad.position.y = 0.17
    g.add(pad)
    g.visible = false
    return { g, pad, ring, bounce: 0 }
  }

  return {
    byKind: { spire, boulder, vent, basalt },
    fallback: rubble,
    trampoline,
  }
}

export default {
  id: 'lava',

  surface: {
    tileA: '#5e444c', tileB: '#523a42',
    base: '#3f2d35',
    rim: ['#4c363e', '#3a2830'], rebar: '#8a5a34',
    grid: ['#c06a3a', '#9c4526'],
    frame: LAVA, fence: '#a9786a', post: '#42303a',
    decal: EMBER, decalTex,
    pad: LAVA, padTex,
    debris: ['#5b414a', '#3f2d34'],
  },

  accents: [LAVA, DEEP],

  night: {
    sky: '#1b0f14', fogNear: 24, fogFar: 78,
    hemiSky: '#7c3a26', hemiGround: '#2a1620', hemiIntensity: 1.6,
    sunColor: '#ffbc8e', sunIntensity: 1.4,
    accentIntensity: 9,
    underGlow: LAVA, underGlowIntensity: 13,
    spot: '#fff0e2', spotIntensity: 14,
    bloom: 0.16, exposure: 1.02,
    post: POLISHED_POST_NIGHT,
  },

  day: {
    // ash-grey with warmth; lighting stack matches desert/jungle polish.
    sky: '#d2b6a6', fogNear: 42, fogFar: 130,
    hemiSky: '#f2e9e2', hemiGround: '#8c7568', hemiIntensity: 0.55,
    sunColor: '#fff0c4', sunIntensity: 3.8,
    accentIntensity: 1.4,
    underGlow: LAVA, underGlowIntensity: 1.2,
    spot: '#ffffff', spotIntensity: 2.4,
    bloom: 0.07, exposure: 0.84,
    post: POLISHED_POST,
  },

  createBackdrop,
  createProps,

  post: POLISHED_POST,
  shadows: POLISHED_SHADOWS,
  gfx: polishedGfx({
    fillColor: '#ffe0c0',
    fillColorNight: '#806050',
  }),
  materialSteps: 7,
}
