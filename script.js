import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

// ---------------------------------------------------------------------------
// Cyberpunk palette
// ---------------------------------------------------------------------------
const NEON_YELLOW = '#fcee0a'
const NEON_CYAN = '#00f0ff'
const NEON_MAGENTA = '#ff2a6d'
const NIGHT = '#07030f'

// ---------------------------------------------------------------------------
// Telegram Mini App
// ---------------------------------------------------------------------------
const tg = window.Telegram?.WebApp
if (tg) {
  tg.ready()
  tg.expand()
  tg.disableVerticalSwipes?.()
  tg.setHeaderColor?.(NIGHT)
  tg.setBackgroundColor?.(NIGHT)
}

const haptic = () => tg?.HapticFeedback?.impactOccurred?.('light')
const hapticError = () => tg?.HapticFeedback?.notificationOccurred?.('error')

// ---------------------------------------------------------------------------
// Renderer / scene
// ---------------------------------------------------------------------------
const canvas = document.querySelector('canvas.webgl')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.0

const scene = new THREE.Scene()
scene.background = new THREE.Color(NIGHT)
scene.fog = new THREE.Fog(NIGHT, 22, 70)

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 160)
camera.position.set(0, 9, 10)

// ---------------------------------------------------------------------------
// Bloom
// ---------------------------------------------------------------------------
const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.32, // strength: subtle halo, not a blinding glow
  0.3,  // radius
  0.7   // threshold: only truly bright things bloom
)
composer.addPass(bloom)
composer.addPass(new OutputPass())

// ---------------------------------------------------------------------------
// Lights: cold moon + neon accents
// ---------------------------------------------------------------------------
const hemi = new THREE.HemisphereLight('#3b2a63', '#141024', 1.0)
scene.add(hemi)

const moon = new THREE.DirectionalLight('#7aa6ff', 1.8)
moon.position.set(12, 26, 10)
moon.castShadow = true
moon.shadow.mapSize.set(2048, 2048)
moon.shadow.camera.left = -16
moon.shadow.camera.right = 16
moon.shadow.camera.top = 20
moon.shadow.camera.bottom = -16
moon.shadow.camera.near = 1
moon.shadow.camera.far = 60
moon.shadow.bias = -0.0005
scene.add(moon)

const magentaLight = new THREE.PointLight(NEON_MAGENTA, 22, 25)
magentaLight.position.set(-7, 4, -7)
scene.add(magentaLight)

const cyanLight = new THREE.PointLight(NEON_CYAN, 22, 25)
cyanLight.position.set(7, 4, 7)
scene.add(cyanLight)

// magenta underglow so the bottom platform floats over pink haze
const underGlow = new THREE.PointLight(NEON_MAGENTA, 28, 20)
underGlow.position.set(0, -4, 0)
scene.add(underGlow)

// ---------------------------------------------------------------------------
// Arena layout: three stacked platforms, each with its own obstacle set.
// Blocked cells must mirror the server's levelBlocked maps.
// ---------------------------------------------------------------------------
const HALF = 4                        // each platform spans cells [-HALF..HALF]
const LEVEL_H = 7                     // vertical distance between platforms
const levelY = (l) => l * LEVEL_H
const cellKey = (x, z) => `${x},${z}`

const LAYOUTS = [
  { // level 0: the junkyard arena
    pylons: [
      [-4, 0, NEON_CYAN, 1.2, true], [-4, 2, NEON_MAGENTA, 1, false],
      [4, -2, NEON_YELLOW, 1.1, true], [2, -4, NEON_CYAN, 0.9, false],
      [-2, 4, NEON_MAGENTA, 1.15, false], [4, 3, NEON_YELLOW, 0.85, false],
    ],
    crates: [[0, -4, NEON_YELLOW, 1.1], [4, 1, NEON_CYAN, 0.9], [-3, 4, NEON_MAGENTA, 1], [-4, -2, NEON_CYAN, 0.8]],
    barrels: [[2, 2]], columns: [[-2, -2]], antennas: [[0, 3]],
    decals: [[3, -1], [-1, 2], [1, -2]],
  },
  { // level 1: tighter maze around the middle
    pylons: [
      [3, 3, NEON_MAGENTA, 1.2, true], [-3, -3, NEON_CYAN, 1.1, true],
      [0, -3, NEON_YELLOW, 0.9, false], [3, 0, NEON_CYAN, 1, false],
    ],
    crates: [[-1, -1, NEON_MAGENTA, 1], [1, 3, NEON_CYAN, 0.9], [-3, 1, NEON_YELLOW, 1.05]],
    barrels: [[-1, 2], [2, -2]], columns: [[2, 0]], antennas: [[-3, -1]],
    decals: [[0, 2], [-2, 0], [2, -3]],
  },
  { // level 2: sparse rooftop with a central obelisk, no trampoline here
    pylons: [
      [0, 0, NEON_MAGENTA, 1.6, true],
      [2, 3, NEON_YELLOW, 1.15, false], [-2, -3, NEON_MAGENTA, 1.05, false],
    ],
    crates: [[3, -3, NEON_CYAN, 1], [-3, 3, NEON_YELLOW, 0.9]],
    barrels: [[1, -1]], columns: [[-1, 1]], antennas: [],
    decals: [[2, 0], [-2, 2], [0, -2]],
  },
]

// obstacle cells per level, derived from the layouts (mirrors server levelBlocked)
const blockedSets = LAYOUTS.map(l => {
  const s = new Set()
  for (const group of [l.pylons, l.crates, l.barrels, l.columns, l.antennas]) {
    for (const def of group) s.add(cellKey(def[0], def[1]))
  }
  return s
})
// crumbled tiles per level, kept in sync with server "tiles" events
const holeSets = [new Set(), new Set(), new Set()]

// shared materials / geometries
const tileGeo = new RoundedBoxGeometry(0.96, 0.3, 0.96, 2, 0.06)
const tileMatA = new THREE.MeshStandardMaterial({ color: '#262638', roughness: 0.5, metalness: 0.45 })
const tileMatB = new THREE.MeshStandardMaterial({ color: '#1a1a29', roughness: 0.5, metalness: 0.45 })
const baseMat = new THREE.MeshStandardMaterial({ color: '#2b211d', roughness: 1 })
const darkMetal = new THREE.MeshStandardMaterial({ color: '#12121c', roughness: 0.35, metalness: 0.7 })

const blinkers = []   // emissive meshes that pulse over time
const holos = []      // rotating holographic shapes

function neonMat(color, intensity = 1.3) {
  return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity })
}

const hazardTex = (() => {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')
  ctx.strokeStyle = NEON_YELLOW
  ctx.lineWidth = 11
  for (let i = -128; i < 256; i += 34) {
    ctx.beginPath()
    ctx.moveTo(i, 128)
    ctx.lineTo(i + 128, 0)
    ctx.stroke()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
})()

const ringTex = (() => {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')
  ctx.strokeStyle = NEON_CYAN
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.arc(64, 64, 48, 0, Math.PI * 2)
  ctx.stroke()
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(64, 64, 34, 0, Math.PI * 2)
  ctx.stroke()
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
})()

// --- props --------------------------------------------------------------

function propPylon([x, z, color, scale = 1, withHolo = false]) {
  const g = new THREE.Group()
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 1.4, 8), darkMetal)
  pole.position.y = 0.7
  pole.castShadow = true
  g.add(pole)

  const ringMat = neonMat(color, 1.5)
  for (const y of [0.35, 0.75, 1.15]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.022, 8, 24), ringMat)
    ring.rotation.x = Math.PI / 2
    ring.position.y = y
    g.add(ring)
  }

  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 10), neonMat(NEON_MAGENTA, 1.8))
  tip.position.y = 1.48
  g.add(tip)
  blinkers.push({ mesh: tip, phase: Math.random() * Math.PI * 2, speed: 2 + Math.random() * 3 })

  if (withHolo) {
    const holo = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.22),
      new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: 1.6,
        transparent: true, opacity: 0.55, wireframe: true,
      })
    )
    holo.position.y = 2.0
    g.add(holo)
    holos.push(holo)
  }

  g.position.set(x, 0, z)
  g.scale.setScalar(scale)
  return g
}

function propCrate([x, z, color, scale = 1]) {
  const g = new THREE.Group()
  const box = new THREE.Mesh(new RoundedBoxGeometry(0.55, 0.55, 0.55, 2, 0.05), darkMetal)
  box.position.y = 0.28
  box.castShadow = true
  box.receiveShadow = true
  g.add(box)

  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.57, 0.035, 0.57), neonMat(color, 1.4))
  strip.position.y = 0.42
  g.add(strip)

  g.position.set(x, 0, z)
  g.scale.setScalar(scale)
  g.rotation.y = (Math.random() - 0.5) * 0.6
  return g
}

function propBarrels([x, z]) {
  const g = new THREE.Group()
  const barrelGeo = new THREE.CylinderGeometry(0.15, 0.16, 0.4, 12)
  const barrelMat = new THREE.MeshStandardMaterial({ color: '#1c2b26', roughness: 0.6, metalness: 0.5 })
  const stripeMat = neonMat(NEON_YELLOW, 1.1)
  const layout = [[-0.14, 0.2, -0.1, 0], [0.16, 0.2, 0.12, 0], [0.0, 0.56, 0.0, 0.12]]
  for (const [bx, by, bz, tilt] of layout) {
    const b = new THREE.Mesh(barrelGeo, barrelMat)
    b.position.set(bx, by, bz)
    b.rotation.z = tilt
    b.castShadow = b.receiveShadow = true
    g.add(b)
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.155, 0.05, 12), stripeMat)
    stripe.position.set(bx, by + 0.08, bz)
    stripe.rotation.z = tilt
    g.add(stripe)
  }
  g.position.set(x, 0, z)
  return g
}

function propColumn([x, z]) {
  const g = new THREE.Group()
  const concrete = new THREE.MeshStandardMaterial({ color: '#3d3d48', roughness: 0.95 })
  const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.55, 8), concrete)
  stump.position.y = 0.28
  stump.castShadow = stump.receiveShadow = true
  g.add(stump)
  const jag = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.28, 5), concrete)
  jag.position.set(0.03, 0.68, -0.02)
  jag.rotation.y = 0.7
  jag.castShadow = true
  g.add(jag)
  const rebarMat = new THREE.MeshStandardMaterial({ color: '#6b5233', roughness: 0.5, metalness: 0.8 })
  for (let i = 0; i < 3; i++) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 5), rebarMat)
    bar.position.set((Math.random() - 0.5) * 0.2, 0.85, (Math.random() - 0.5) * 0.2)
    bar.rotation.set((Math.random() - 0.5) * 0.8, 0, (Math.random() - 0.5) * 0.8)
    g.add(bar)
  }
  g.position.set(x, 0, z)
  g.rotation.y = Math.random() * Math.PI
  return g
}

function propAntenna([x, z]) {
  const g = new THREE.Group()
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 1.9, 6), darkMetal)
  mast.position.y = 0.95
  mast.castShadow = true
  g.add(mast)
  for (const [y, len] of [[1.2, 0.5], [1.55, 0.34]]) {
    const cross = new THREE.Mesh(new THREE.BoxGeometry(len, 0.025, 0.025), darkMetal)
    cross.position.y = y
    g.add(cross)
  }
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8, 0, Math.PI), darkMetal)
  dish.position.set(0.1, 1.4, 0)
  dish.rotation.y = -Math.PI / 2
  g.add(dish)
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), neonMat('#ff2222', 1.8))
  tip.position.y = 1.92
  g.add(tip)
  blinkers.push({ mesh: tip, phase: Math.random() * Math.PI * 2, speed: 3.5 })
  g.position.set(x, 0, z)
  return g
}

// --- trampoline -----------------------------------------------------------

function createTrampoline() {
  const g = new THREE.Group()
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.14, 20), darkMetal)
  base.position.y = 0.07
  base.castShadow = base.receiveShadow = true
  g.add(base)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.045, 10, 28), neonMat(NEON_CYAN, 1.6))
  ring.rotation.x = Math.PI / 2
  ring.position.y = 0.16
  g.add(ring)
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.07, 24), neonMat(NEON_MAGENTA, 1.3))
  pad.position.y = 0.17
  g.add(pad)
  g.visible = false
  return { g, pad, ring, bounce: 0 }
}

// --- platform builder -------------------------------------------------------

// platforms[l] = { group, pieces: Map(key -> [{obj, pos0, quat0}]), tramp, trampKey, rimGone }
const platforms = []
const platformSpots = []   // per-platform overhead spotlights (dimmed at daytime)
const windowMats = []      // tower window materials (glow off at daytime)
const signMats = []        // billboard materials
const RIM_CELLS = (2 * HALF + 1) * 4 - 4 // outermost ring size

function buildPlatform(level) {
  const layout = LAYOUTS[level]
  const group = new THREE.Group()
  group.position.y = levelY(level)
  scene.add(group)

  const pieces = new Map()
  const reg = (x, z, obj) => {
    const key = cellKey(x, z)
    if (!pieces.has(key)) pieces.set(key, [])
    pieces.get(key).push({ obj, pos0: obj.position.clone(), quat0: obj.quaternion.clone() })
  }
  // rim furniture (fence, frame, grid) collapses once the outer ring is gone
  const regRim = (obj) => {
    if (!pieces.has('__rim')) pieces.set('__rim', [])
    pieces.get('__rim').push({ obj, pos0: obj.position.clone(), quat0: obj.quaternion.clone() })
  }

  // tiles + ragged dirt chunks underneath
  for (let x = -HALF; x <= HALF; x++) {
    for (let z = -HALF; z <= HALF; z++) {
      const tile = new THREE.Mesh(tileGeo, (x + z) % 2 === 0 ? tileMatA : tileMatB)
      tile.position.set(x, -0.15, z)
      tile.receiveShadow = true
      tile.castShadow = true
      group.add(tile)
      reg(x, z, tile)

      const baseH = 0.7 + Math.random() * 1.4
      const base = new THREE.Mesh(
        new THREE.BoxGeometry(0.88 + Math.random() * 0.16, baseH, 0.88 + Math.random() * 0.16),
        baseMat
      )
      base.position.set(
        x + (Math.random() - 0.5) * 0.12,
        -0.3 - baseH / 2,
        z + (Math.random() - 0.5) * 0.12
      )
      base.rotation.y = (Math.random() - 0.5) * 0.18
      group.add(base)
      reg(x, z, base)
    }
  }

  // neon grid over tile seams
  const grid = new THREE.GridHelper(9, 9, NEON_MAGENTA, NEON_CYAN)
  grid.position.y = 0.02
  grid.material.transparent = true
  grid.material.opacity = 0.25
  grid.material.depthWrite = false
  group.add(grid)
  regRim(grid)

  // glowing yellow frame
  const barGeo = new THREE.BoxGeometry(9.14, 0.05, 0.05)
  const barMat = new THREE.MeshStandardMaterial({
    color: NEON_YELLOW, emissive: NEON_YELLOW, emissiveIntensity: 0.4,
  })
  for (const [x, z, rot] of [[0, -4.55, 0], [0, 4.55, 0], [-4.55, 0, 1], [4.55, 0, 1]]) {
    const bar = new THREE.Mesh(barGeo, barMat)
    bar.position.set(x, 0.02, z)
    if (rot) bar.rotation.y = Math.PI / 2
    group.add(bar)
    regRim(bar)
  }

  // obstacles per layout
  for (const def of layout.pylons) {
    const g = propPylon(def)
    group.add(g)
    reg(def[0], def[1], g)
  }
  for (const def of layout.crates) {
    const g = propCrate(def)
    group.add(g)
    reg(def[0], def[1], g)
  }
  for (const def of layout.barrels) {
    const g = propBarrels(def)
    group.add(g)
    reg(def[0], def[1], g)
  }
  for (const def of layout.columns) {
    const g = propColumn(def)
    group.add(g)
    reg(def[0], def[1], g)
  }
  for (const def of layout.antennas) {
    const g = propAntenna(def)
    group.add(g)
    reg(def[0], def[1], g)
  }

  // perimeter fence
  {
    const postGeo = new THREE.CylinderGeometry(0.028, 0.04, 0.62, 6)
    const railMat = new THREE.MeshStandardMaterial({
      color: NEON_CYAN, emissive: NEON_CYAN, emissiveIntensity: 0.5,
    })
    const railGeo = new THREE.BoxGeometry(9.3, 0.028, 0.028)
    for (let i = -HALF; i <= HALF; i++) {
      for (const [px, pz] of [[i, -4.62], [i, 4.62], [-4.62, i], [4.62, i]]) {
        const post = new THREE.Mesh(postGeo, darkMetal)
        post.position.set(px, 0.31, pz)
        post.castShadow = true
        group.add(post)
        regRim(post)
      }
    }
    for (const y of [0.3, 0.56]) {
      for (const [x, z, rot] of [[0, -4.62, 0], [0, 4.62, 0], [-4.62, 0, 1], [4.62, 0, 1]]) {
        const rail = new THREE.Mesh(railGeo, railMat)
        rail.position.set(x, y, z)
        if (rot) rail.rotation.y = Math.PI / 2
        group.add(rail)
        regRim(rail)
      }
    }
  }

  // torn-earth rim: hanging rock spikes, ragged slabs, rebar
  {
    const rockMat = new THREE.MeshStandardMaterial({ color: '#372c25', roughness: 1 })
    const rockDark = new THREE.MeshStandardMaterial({ color: '#241c17', roughness: 1 })
    const rebarMat = new THREE.MeshStandardMaterial({ color: '#5e4a35', roughness: 0.55, metalness: 0.8 })

    for (let x = -HALF; x <= HALF; x++) {
      for (let z = -HALF; z <= HALF; z++) {
        const onRim = Math.abs(x) === HALF || Math.abs(z) === HALF
        if (!onRim) continue
        const ox = Math.abs(x) === HALF ? Math.sign(x) : 0
        const oz = Math.abs(z) === HALF ? Math.sign(z) : 0

        const n = 1 + Math.floor(Math.random() * 2)
        for (let i = 0; i < n; i++) {
          const spike = new THREE.Mesh(
            new THREE.ConeGeometry(0.14 + Math.random() * 0.16, 0.7 + Math.random() * 1.2, 5),
            Math.random() < 0.5 ? rockMat : rockDark
          )
          spike.rotation.x = Math.PI
          spike.rotation.y = Math.random() * Math.PI
          spike.position.set(
            x + ox * 0.3 + (Math.random() - 0.5) * 0.4,
            -1.5 - Math.random() * 0.9,
            z + oz * 0.3 + (Math.random() - 0.5) * 0.4
          )
          group.add(spike)
          reg(x, z, spike)
        }

        if (Math.random() < 0.75) {
          const slab = new THREE.Mesh(
            new THREE.BoxGeometry(0.45 + Math.random() * 0.5, 0.16 + Math.random() * 0.18, 0.45 + Math.random() * 0.5),
            Math.random() < 0.5 ? rockMat : baseMat
          )
          slab.position.set(
            x + ox * (0.6 + Math.random() * 0.3),
            -0.35 - Math.random() * 0.7,
            z + oz * (0.6 + Math.random() * 0.3)
          )
          slab.rotation.set((Math.random() - 0.5) * 0.5, Math.random() * Math.PI, (Math.random() - 0.5) * 0.5)
          group.add(slab)
          reg(x, z, slab)
        }

        if (Math.random() < 0.4) {
          const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.45 + Math.random() * 0.4, 5), rebarMat)
          bar.position.set(x + ox * 0.62, -0.6 - Math.random() * 0.7, z + oz * 0.62)
          bar.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI)
          group.add(bar)
          reg(x, z, bar)
        }
      }
    }
  }

  // floor decals + debris
  {
    for (const [x, z] of layout.decals) {
      const decal = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.85), new THREE.MeshStandardMaterial({
        map: hazardTex, transparent: true, opacity: 0.3, depthWrite: false,
        emissive: NEON_YELLOW, emissiveMap: hazardTex, emissiveIntensity: 0.25,
      }))
      decal.rotation.x = -Math.PI / 2
      decal.position.set(x, 0.022, z)
      group.add(decal)
      reg(x, z, decal)
    }

    if (level === 0) {
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshStandardMaterial({
        map: ringTex, transparent: true, opacity: 0.5, depthWrite: false,
        emissive: NEON_CYAN, emissiveMap: ringTex, emissiveIntensity: 0.5,
      }))
      pad.rotation.x = -Math.PI / 2
      pad.position.set(0, 0.022, 0)
      group.add(pad)
      reg(0, 0, pad)
    }

    const debrisMats = [
      new THREE.MeshStandardMaterial({ color: '#3a3a46', roughness: 0.9 }),
      new THREE.MeshStandardMaterial({ color: '#2e2622', roughness: 1 }),
    ]
    for (let i = 0; i < 14; i++) {
      const debris = new THREE.Mesh(
        new THREE.BoxGeometry(0.06 + Math.random() * 0.1, 0.04 + Math.random() * 0.04, 0.06 + Math.random() * 0.1),
        debrisMats[i % 2]
      )
      const dx = (Math.random() - 0.5) * 8.6
      const dz = (Math.random() - 0.5) * 8.6
      debris.position.set(dx, 0.04, dz)
      debris.rotation.y = Math.random() * Math.PI
      debris.castShadow = true
      group.add(debris)
      reg(Math.round(dx), Math.round(dz), debris)
    }
  }

  // cool overhead spot so the arena reads clearly
  const spot = new THREE.SpotLight('#cfe6ff', 260, 30, Math.PI / 4.5, 0.55, 1.6)
  spot.position.set(0, 12, 2)
  spot.target.position.set(0, 0, 0)
  group.add(spot, spot.target)
  platformSpots.push(spot)

  // accent light for the upper platforms
  if (level === 1) {
    const accent = new THREE.PointLight(NEON_CYAN, 16, 18)
    accent.position.set(6, 3.5, -6)
    group.add(accent)
  } else if (level === 2) {
    const accent = new THREE.PointLight(NEON_MAGENTA, 16, 18)
    accent.position.set(-6, 3.5, 6)
    group.add(accent)
  }

  const tramp = createTrampoline()
  group.add(tramp.g)

  platforms.push({ group, pieces, tramp, trampKey: null, rimGone: 0 })
}

for (let l = 0; l < 3; l++) buildPlatform(l)

// --- destruction ------------------------------------------------------------

const fallingPieces = []

function destroyCellVisual(level, x, z, animate = true) {
  holeSets[level].add(cellKey(x, z))
  const plat = platforms[level]
  const arr = plat.pieces.get(cellKey(x, z))
  if (arr) {
    for (const e of arr) {
      if (!e.obj.visible) continue
      if (animate) {
        fallingPieces.push({
          ...e,
          vy: 0.4 + Math.random() * 0.8,
          rx: (Math.random() - 0.5) * 3,
          rz: (Math.random() - 0.5) * 3,
          t: -Math.random() * 0.15,
        })
      } else {
        e.obj.visible = false
      }
    }
  }
  // trampoline sits on a cell too — it goes down with it
  if (plat.trampKey === cellKey(x, z)) {
    plat.tramp.g.visible = false
    plat.trampKey = null
  }
  // once the whole outer ring is gone, the fence/frame/grid collapse as well
  if (Math.max(Math.abs(x), Math.abs(z)) === HALF) {
    plat.rimGone++
    if (plat.rimGone === RIM_CELLS) {
      for (const e of plat.pieces.get('__rim') || []) {
        if (!e.obj.visible) continue
        if (animate) {
          fallingPieces.push({ ...e, vy: 0.3, rx: (Math.random() - 0.5) * 1.5, rz: (Math.random() - 0.5) * 1.5, t: 0 })
        } else {
          e.obj.visible = false
        }
      }
    }
  }
}

function restorePlatforms() {
  fallingPieces.length = 0
  for (const s of holeSets) s.clear()
  for (const plat of platforms) {
    for (const arr of plat.pieces.values()) {
      for (const e of arr) {
        e.obj.visible = true
        e.obj.position.copy(e.pos0)
        e.obj.quaternion.copy(e.quat0)
      }
    }
    plat.tramp.g.visible = false
    plat.trampKey = null
    plat.rimGone = 0
  }
}

function showTramp(level, x, z) {
  const plat = platforms[level]
  plat.tramp.g.position.set(x, 0, z)
  plat.tramp.g.visible = true
  plat.trampKey = cellKey(x, z)
}

// ---------------------------------------------------------------------------
// Night City skyline: towers with glowing windows below and around
// ---------------------------------------------------------------------------
function makeWindowTexture() {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 128
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#05050a'
  ctx.fillRect(0, 0, c.width, c.height)
  const palette = [NEON_YELLOW, NEON_CYAN, NEON_MAGENTA, '#f7f7ff']
  for (let y = 4; y < c.height - 4; y += 8) {
    for (let x = 4; x < c.width - 4; x += 8) {
      if (Math.random() < 0.32) {
        ctx.fillStyle = palette[Math.floor(Math.random() * palette.length)]
        ctx.globalAlpha = 0.4 + Math.random() * 0.6
        ctx.fillRect(x, y, 4, 5)
      }
    }
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

const windowTextures = [makeWindowTexture(), makeWindowTexture(), makeWindowTexture()]
const roofMat = new THREE.MeshStandardMaterial({ color: '#08080f', roughness: 0.9 })
const signGeo = new THREE.PlaneGeometry(1.6, 0.5)

for (let i = 0; i < 42; i++) {
  const angle = Math.random() * Math.PI * 2
  const radius = 14 + Math.random() * 20
  const w = 1.5 + Math.random() * 2.5
  const d = 1.5 + Math.random() * 2.5
  const h = 13 + Math.random() * 17

  const tex = windowTextures[i % windowTextures.length]
  const sideMat = new THREE.MeshStandardMaterial({
    map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0.85,
    color: '#ffffff', roughness: 0.9,
  })
  windowMats.push(sideMat)
  const tower = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    [sideMat, sideMat, roofMat, roofMat, sideMat, sideMat]
  )
  tower.position.set(Math.cos(angle) * radius, -22 + h / 2, Math.sin(angle) * radius)
  tower.rotation.y = Math.random() * Math.PI
  scene.add(tower)

  if (h > 26) {
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), neonMat('#ff2222', 1.8))
    beacon.position.set(tower.position.x, -22 + h + 0.15, tower.position.z)
    scene.add(beacon)
    blinkers.push({ mesh: beacon, phase: Math.random() * Math.PI * 2, speed: 3 })
  }

  if (i % 5 === 0) {
    const color = [NEON_YELLOW, NEON_CYAN, NEON_MAGENTA][i % 3]
    const sign = new THREE.Mesh(signGeo, new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 1.5, side: THREE.DoubleSide,
    }))
    signMats.push(sign.material)
    sign.position.set(tower.position.x, -22 + h * (0.55 + Math.random() * 0.3), tower.position.z)
    sign.lookAt(0, sign.position.y, 0)
    sign.translateZ(Math.max(w, d) * 0.75)
    scene.add(sign)
  }
}

// ---------------------------------------------------------------------------
// Flying cars streaming around the city
// ---------------------------------------------------------------------------
const cars = []
for (let i = 0; i < 7; i++) {
  const car = new THREE.Group()
  const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.2), darkMetal)
  car.add(bodyMesh)
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.18), neonMat('#eaffff', 2))
  head.position.x = 0.26
  car.add(head)
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.18), neonMat(NEON_MAGENTA, 2))
  tail.position.x = -0.26
  car.add(tail)

  const angle = (i / 7) * Math.PI * 2
  const radius = 10 + Math.random() * 9
  car.userData = {
    angle, radius,
    speed: (0.12 + Math.random() * 0.2) * (i % 2 === 0 ? 1 : -1),
    y: -3 + Math.random() * 9,
  }
  scene.add(car)
  cars.push(car)
}

// ---------------------------------------------------------------------------
// Rain
// ---------------------------------------------------------------------------
const RAIN_COUNT = 500
const rainPos = new Float32Array(RAIN_COUNT * 3)
const rainSpeed = new Float32Array(RAIN_COUNT)
for (let i = 0; i < RAIN_COUNT; i++) {
  rainPos[i * 3] = (Math.random() - 0.5) * 40
  rainPos[i * 3 + 1] = Math.random() * 28 - 4
  rainSpeed[i] = 9 + Math.random() * 7
  rainPos[i * 3 + 2] = (Math.random() - 0.5) * 40
}
const rainGeo = new THREE.BufferGeometry()
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3))
const rain = new THREE.Points(rainGeo, new THREE.PointsMaterial({
  color: '#6fe3ff', size: 0.05, transparent: true, opacity: 0.45, depthWrite: false,
}))
scene.add(rain)

// ---------------------------------------------------------------------------
// Day / night toggle
// ---------------------------------------------------------------------------
let isDay = localStorage.getItem('cube2077-day') === '1'
let neonBase = 22             // breathing base for the magenta/cyan accents
const dayBtn = document.getElementById('daybtn')

function setDayMode(day) {
  isDay = day
  localStorage.setItem('cube2077-day', day ? '1' : '0')
  dayBtn.textContent = day ? 'НОЧЬ' : 'ДЕНЬ'

  scene.background.set(day ? '#8fb8e8' : NIGHT)
  scene.fog.color.set(day ? '#8fb8e8' : NIGHT)
  scene.fog.near = day ? 30 : 22
  scene.fog.far = day ? 110 : 70

  hemi.color.set(day ? '#dfeeff' : '#3b2a63')
  hemi.groundColor.set(day ? '#8fa0b5' : '#141024')
  hemi.intensity = day ? 1.25 : 1.0

  // the same directional light acts as sun by day and moon by night
  moon.color.set(day ? '#fff2d0' : '#7aa6ff')
  moon.intensity = day ? 3.4 : 1.8

  bloom.strength = day ? 0.12 : 0.32
  renderer.toneMappingExposure = day ? 1.05 : 1.0

  neonBase = day ? 4 : 22
  underGlow.intensity = day ? 5 : 28
  for (const s of platformSpots) s.intensity = day ? 60 : 260
  for (const m of windowMats) m.emissiveIntensity = day ? 0.05 : 0.85
  for (const m of signMats) m.emissiveIntensity = day ? 0.5 : 1.5
  rain.material.opacity = day ? 0.28 : 0.45
}

dayBtn.addEventListener('click', () => setDayMode(!isDay))
setDayMode(isDay)

// ---------------------------------------------------------------------------
// Die factory: black chrome cube with glowing pips (opposite faces sum to 7)
// ---------------------------------------------------------------------------
const dieGeo = new RoundedBoxGeometry(1, 1, 1, 4, 0.09)
const pipGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.04, 20)
const O = 0.24
const pipLayouts = {
  1: [[0, 0]],
  2: [[-O, -O], [O, O]],
  3: [[-O, -O], [0, 0], [O, O]],
  4: [[-O, -O], [-O, O], [O, -O], [O, O]],
  5: [[-O, -O], [-O, O], [0, 0], [O, -O], [O, O]],
  6: [[-O, -O], [-O, 0], [-O, O], [O, -O], [O, 0], [O, O]],
}
// initial mesh orientation: top=1, east(+x)=3, south(+z)=2 — must match the server
const faceDefs = [
  { value: 1, normal: new THREE.Vector3(0, 1, 0) },
  { value: 6, normal: new THREE.Vector3(0, -1, 0) },
  { value: 2, normal: new THREE.Vector3(0, 0, 1) },
  { value: 5, normal: new THREE.Vector3(0, 0, -1) },
  { value: 3, normal: new THREE.Vector3(1, 0, 0) },
  { value: 4, normal: new THREE.Vector3(-1, 0, 0) },
]
const yAxis = new THREE.Vector3(0, 1, 0)

const OTHER_COLORS = [NEON_CYAN, NEON_MAGENTA, '#39ff14', '#ff9f1c', '#b26bff', '#ff5555']
const colorForId = (id) => {
  let hash = 0
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return OTHER_COLORS[hash % OTHER_COLORS.length]
}

function createDie(pipColor) {
  const group = new THREE.Group()
  const bodyMat = new THREE.MeshStandardMaterial({ color: '#0d0d13', roughness: 0.22, metalness: 0.85 })
  const body = new THREE.Mesh(dieGeo, bodyMat)
  body.castShadow = true
  body.receiveShadow = true
  group.add(body)

  const pipMat = new THREE.MeshStandardMaterial({
    color: pipColor, emissive: pipColor, emissiveIntensity: 1.5, roughness: 0.3,
  })
  for (const { value, normal } of faceDefs) {
    const quat = new THREE.Quaternion().setFromUnitVectors(yAxis, normal)
    for (const [u, v] of pipLayouts[value]) {
      const pip = new THREE.Mesh(pipGeo, pipMat)
      pip.position.set(u, 0.495, v).applyQuaternion(quat)
      pip.quaternion.copy(quat)
      group.add(pip)
    }
  }
  return { group, bodyMat }
}

// ---------------------------------------------------------------------------
// Orientation lookup: (top, east, south) -> quaternion, all 24 rotations
// ---------------------------------------------------------------------------
const orientTable = new Map()
{
  const n = new THREE.Vector3()
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) {
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(i * Math.PI / 2, j * Math.PI / 2, k * Math.PI / 2))
    let top, east, south
    for (const { value, normal } of faceDefs) {
      n.copy(normal).applyQuaternion(q)
      if (n.y > 0.9) top = value
      if (n.x > 0.9) east = value
      if (n.z > 0.9) south = value
    }
    const key = `${top},${east},${south}`
    if (!orientTable.has(key)) orientTable.set(key, q)
  }
}
const quatForOrient = (o) => orientTable.get(`${o.top},${o.east},${o.south}`)

// ---------------------------------------------------------------------------
// Nameplate: nickname + HP bar + dash strip on one sprite above the die
// ---------------------------------------------------------------------------
const MAX_HP = 30

function createHpBar(name, isMe) {
  const c = document.createElement('canvas')
  c.width = 160
  c.height = 56
  const tex = new THREE.CanvasTexture(c)
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false,
  }))
  sprite.scale.set(1.25, 0.4375, 1)
  scene.add(sprite)
  return { sprite, ctx: c.getContext('2d'), tex, name: name || 'PLAYER', isMe }
}

// dashFrac: 0..1 readiness of the dash; null hides the dash strip (other players)
function drawHpBar(bar, hp, dashFrac = null) {
  const { ctx, tex } = bar
  const w = 160
  ctx.clearRect(0, 0, w, 56)

  // nickname, mine highlighted in yellow
  ctx.font = 'bold 17px Verdana'
  ctx.textAlign = 'center'
  const nameColor = bar.isMe ? '#fcee0a' : '#eaf6ff'
  ctx.fillStyle = nameColor
  ctx.shadowColor = nameColor
  ctx.shadowBlur = 6
  ctx.fillText(bar.name.toUpperCase(), w / 2, 18)
  ctx.shadowBlur = 0

  ctx.fillStyle = 'rgba(5,5,12,.8)'
  ctx.fillRect(16, 26, w - 32, 14)
  const frac = Math.max(0, hp / MAX_HP)
  ctx.fillStyle = frac > 0.5 ? '#39ff14' : frac > 0.25 ? '#fcee0a' : '#ff2a6d'
  ctx.fillRect(18, 28, (w - 36) * frac, 10)
  ctx.strokeStyle = 'rgba(0,240,255,.7)'
  ctx.lineWidth = 2
  ctx.strokeRect(17, 27, w - 34, 12)

  if (dashFrac !== null) {
    ctx.fillStyle = 'rgba(5,5,12,.8)'
    ctx.fillRect(16, 44, w - 32, 8)
    ctx.fillStyle = dashFrac >= 1 ? '#fcee0a' : 'rgba(252,238,10,.55)'
    ctx.fillRect(18, 46, (w - 36) * Math.min(1, dashFrac), 4)
    ctx.strokeStyle = 'rgba(252,238,10,.6)'
    ctx.lineWidth = 1
    ctx.strokeRect(16.5, 44.5, w - 33, 7)
  }
  tex.needsUpdate = true
}

// ---------------------------------------------------------------------------
// Damage popups
// ---------------------------------------------------------------------------
const popups = []
function spawnPopup(text, color, worldPos) {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 64
  const ctx = c.getContext('2d')
  ctx.font = 'bold 44px Verdana'
  ctx.textAlign = 'center'
  ctx.fillStyle = color
  ctx.shadowColor = color
  ctx.shadowBlur = 12
  ctx.fillText(text, 64, 48)
  const tex = new THREE.CanvasTexture(c)
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false,
  }))
  sprite.scale.set(0.9, 0.45, 1)
  sprite.position.copy(worldPos)
  scene.add(sprite)
  popups.push({ sprite, life: 1 })
}

// ---------------------------------------------------------------------------
// Sound: tiny WebAudio synth, no asset files
// ---------------------------------------------------------------------------
let audioCtx = null
function ensureAudio() {
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return
  if (!audioCtx) audioCtx = new AC()
  if (audioCtx.state === 'suspended') audioCtx.resume()
}
window.addEventListener('pointerdown', ensureAudio)
window.addEventListener('keydown', ensureAudio)

function envGain(t0, peak, dur) {
  const g = audioCtx.createGain()
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(peak, t0 + 0.006)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  g.connect(audioCtx.destination)
  return g
}

function makeNoise(dur) {
  const n = Math.floor(audioCtx.sampleRate * dur)
  const buf = audioCtx.createBuffer(1, n, audioCtx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1
  const src = audioCtx.createBufferSource()
  src.buffer = buf
  return src
}

const sfx = {
  // dull wooden knock of a die tipping onto the next tile
  roll() {
    if (!audioCtx) return
    const t0 = audioCtx.currentTime
    const o = audioCtx.createOscillator()
    o.type = 'triangle'
    o.frequency.setValueAtTime(190 + Math.random() * 40, t0)
    o.frequency.exponentialRampToValueAtTime(85, t0 + 0.07)
    o.connect(envGain(t0, 0.1, 0.09))
    o.start(t0)
    o.stop(t0 + 0.1)
  },
  // rising whoosh
  dash() {
    if (!audioCtx) return
    const t0 = audioCtx.currentTime
    const src = makeNoise(0.25)
    const f = audioCtx.createBiquadFilter()
    f.type = 'bandpass'
    f.Q.value = 1.4
    f.frequency.setValueAtTime(350, t0)
    f.frequency.exponentialRampToValueAtTime(3400, t0 + 0.18)
    src.connect(f).connect(envGain(t0, 0.22, 0.24))
    src.start(t0)
  },
  // springy hop
  jump() {
    if (!audioCtx) return
    const t0 = audioCtx.currentTime
    const o = audioCtx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(240, t0)
    o.frequency.exponentialRampToValueAtTime(560, t0 + 0.14)
    o.connect(envGain(t0, 0.14, 0.18))
    o.start(t0)
    o.stop(t0 + 0.2)
  },
  // big trampoline boing up to the next platform
  launch() {
    if (!audioCtx) return
    const t0 = audioCtx.currentTime
    const o = audioCtx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(150, t0)
    o.frequency.exponentialRampToValueAtTime(880, t0 + 0.4)
    o.connect(envGain(t0, 0.25, 0.5))
    o.start(t0)
    o.stop(t0 + 0.5)
    const src = makeNoise(0.3)
    const f = audioCtx.createBiquadFilter()
    f.type = 'bandpass'
    f.Q.value = 1.2
    f.frequency.setValueAtTime(500, t0)
    f.frequency.exponentialRampToValueAtTime(4000, t0 + 0.3)
    src.connect(f).connect(envGain(t0, 0.12, 0.3))
    src.start(t0)
  },
  // a tile breaking off and dropping away
  crumble() {
    if (!audioCtx) return
    const t0 = audioCtx.currentTime
    const src = makeNoise(0.22)
    const f = audioCtx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.setValueAtTime(700, t0)
    f.frequency.exponentialRampToValueAtTime(120, t0 + 0.2)
    src.connect(f).connect(envGain(t0, 0.16, 0.22))
    src.start(t0)
    const o = audioCtx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(90, t0)
    o.frequency.exponentialRampToValueAtTime(40, t0 + 0.18)
    o.connect(envGain(t0, 0.18, 0.2))
    o.start(t0)
    o.stop(t0 + 0.2)
  },
  // alarm when a platform starts to crumble
  alarm() {
    if (!audioCtx) return
    const t0 = audioCtx.currentTime
    for (const dt of [0, 0.22, 0.44]) {
      const o = audioCtx.createOscillator()
      o.type = 'square'
      o.frequency.setValueAtTime(660, t0 + dt)
      o.frequency.setValueAtTime(880, t0 + dt + 0.09)
      o.connect(envGain(t0 + dt, 0.06, 0.16))
      o.start(t0 + dt)
      o.stop(t0 + dt + 0.18)
    }
  },
  // heavy impact: low thump + noise crack
  hit() {
    if (!audioCtx) return
    const t0 = audioCtx.currentTime
    const o = audioCtx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(130, t0)
    o.frequency.exponentialRampToValueAtTime(42, t0 + 0.16)
    o.connect(envGain(t0, 0.4, 0.2))
    o.start(t0)
    o.stop(t0 + 0.2)
    const src = makeNoise(0.12)
    const f = audioCtx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = 900
    src.connect(f).connect(envGain(t0, 0.24, 0.11))
    src.start(t0)
  },
  // falling pitch + rumble
  death() {
    if (!audioCtx) return
    const t0 = audioCtx.currentTime
    const o = audioCtx.createOscillator()
    o.type = 'sawtooth'
    o.frequency.setValueAtTime(320, t0)
    o.frequency.exponentialRampToValueAtTime(38, t0 + 0.55)
    o.connect(envGain(t0, 0.22, 0.6))
    o.start(t0)
    o.stop(t0 + 0.6)
    const src = makeNoise(0.5)
    const f = audioCtx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.setValueAtTime(2600, t0)
    f.frequency.exponentialRampToValueAtTime(120, t0 + 0.5)
    src.connect(f).connect(envGain(t0, 0.2, 0.5))
    src.start(t0)
  },
  // short double blip for a denied action
  deny() {
    if (!audioCtx) return
    const t0 = audioCtx.currentTime
    for (const dt of [0, 0.09]) {
      const o = audioCtx.createOscillator()
      o.type = 'square'
      o.frequency.value = 150
      o.connect(envGain(t0 + dt, 0.07, 0.06))
      o.start(t0 + dt)
      o.stop(t0 + dt + 0.07)
    }
  },
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------
const players = new Map()   // id -> player object
let myId = null

const hint = document.getElementById('hint')
const statusEl = document.getElementById('status')
const timerEl = document.getElementById('timer')
let moved = false

let dashCooldownMs = 5000
let dashReadyAt = 0
let jumpCooldownMs = 1200
let jumpReadyAt = 0
let shake = 0               // camera shake amount

// round phase, driven by server messages; endsAt is in performance.now() time
const phase = { mode: 'calm', level: 0, endsAt: 0 }
function applyPhase(ph) {
  if (!ph) return
  phase.mode = ph.mode
  phase.level = ph.level
  phase.endsAt = ph.remainMs != null ? performance.now() + ph.remainMs : 0
}

function addPlayer(data) {
  if (players.has(data.id)) return players.get(data.id)
  const isMe = data.id === myId
  const color = isMe ? NEON_YELLOW : colorForId(data.id)
  const { group, bodyMat } = createDie(color)
  // every die glows in its own color, mine slightly stronger
  const glow = new THREE.PointLight(color, isMe ? 3 : 2.2, 4)
  glow.position.y = 0.2
  group.add(glow)
  group.position.set(data.x, levelY(data.level || 0) + 0.5, data.z)
  const q = quatForOrient(data)
  if (q) group.quaternion.copy(q)
  scene.add(group)

  const bar = createHpBar(data.name, isMe)
  drawHpBar(bar, data.hp)

  const p = {
    id: data.id, group, bodyMat, bar,
    cell: { x: data.x, z: data.z },
    confirmedCell: { x: data.x, z: data.z },
    level: data.level || 0,
    hp: data.hp, dead: data.dead || false,
    orient: { top: data.top, east: data.east, south: data.south },
    confirmedOrient: { top: data.top, east: data.east, south: data.south },
    queue: [], anim: null,
    flash: 0, deathAnim: null, spawnAnim: null,
    pendingDeath: null,           // death animation deferred until move anims finish
    gone: data.dead || false,     // fully hidden (dead, waiting for respawn)
  }
  players.set(data.id, p)
  return p
}

function startDeathAnim(p, mode) {
  p.deathAnim = { t: 0, mode, vy: 2 }
  sfx.death()
}

function removePlayer(id) {
  const p = players.get(id)
  if (!p) return
  scene.remove(p.group)
  scene.remove(p.bar.sprite)
  players.delete(id)
}

// ---------------------------------------------------------------------------
// Movement animation (server events drive everything)
// ---------------------------------------------------------------------------
const ROLL_TIME = 0.13
const DASH_TIME = 0.10
const JUMP_TIME = 0.36
const smoothstep = t => t * t * (3 - 2 * t)

// mirrors server/dice.go — used for instant local roll prediction
function rollOrient(o, dx, dz) {
  switch (true) {
    case dx === 1: return { top: 7 - o.east, east: o.top, south: o.south }
    case dx === -1: return { top: o.east, east: 7 - o.top, south: o.south }
    case dz === 1: return { top: 7 - o.south, east: o.east, south: o.top }
    case dz === -1: return { top: o.south, east: o.east, south: 7 - o.top }
    default: return o
  }
}

function syncConfirmed(p, data) {
  p.orient = { top: data.top, east: data.east, south: data.south }
  p.confirmedCell = { x: data.x, z: data.z }
  p.confirmedOrient = { ...p.orient }
}

// FIFO of cells my unconfirmed predicted moves should land on
let myPredictions = []

function rollbackPrediction(p) {
  if (!p?.confirmedCell) return
  myPredictions = []
  p.queue = p.queue.filter(m => !m.predicted)
  p.anim = null
  p.cell = { ...p.confirmedCell }
  p.orient = { ...p.confirmedOrient }
  p.group.position.set(p.cell.x, levelY(p.level) + 0.5, p.cell.z)
  p.group.scale.set(1, 1, 1)
  const q = quatForOrient(p.orient)
  if (q) p.group.quaternion.copy(q)
}

// cell checks mirroring the server, so predictions never phase through walls
const inArena = (x, z) => x >= -HALF && x <= HALF && z >= -HALF && z <= HALF
const isBlockedC = (l, x, z) => blockedSets[l].has(cellKey(x, z)) && !holeSets[l].has(cellKey(x, z))
const isHoleC = (l, x, z) => holeSets[l].has(cellKey(x, z))
const isTrampC = (l, x, z) => platforms[l].trampKey === cellKey(x, z)
function playerAtCell(l, x, z) {
  for (const p of players.values()) {
    if (p.id !== myId && !p.dead && !p.gone && p.level === l && p.cell.x === x && p.cell.z === z) return p
  }
  return null
}

// returns false when the move must not even be sent (wall/obstacle)
function predictRoll(dx, dz) {
  const me = players.get(myId)
  if (!me || me.dead || me.gone) return true
  const l = me.level
  const nx = me.cell.x + dx
  const nz = me.cell.z + dz
  if (!inArena(nx, nz) || isBlockedC(l, nx, nz)) return false
  // an occupied cell means attack: send the move but keep the cube in place
  if (playerAtCell(l, nx, nz)) return true
  const next = rollOrient(me.orient || { top: 1, east: 3, south: 2 }, dx, dz)
  myPredictions.push({ x: nx, z: nz })
  enqueueMove(me, {
    predicted: true,
    p: { id: myId, level: l, x: nx, z: nz, ...next },
  })
  me.cell = { x: nx, z: nz }
  me.orient = next
  return true
}

// walks up to two cells with the same stop rules as the server
function predictDash(dx, dz) {
  const me = players.get(myId)
  if (!me || me.dead || me.gone) return
  const l = me.level
  let { x, z } = me.cell
  let steps = 0
  for (let i = 0; i < 2; i++) {
    const nx = x + dx
    const nz = z + dz
    if (!inArena(nx, nz) || isBlockedC(l, nx, nz) || playerAtCell(l, nx, nz)) break
    x = nx
    z = nz
    steps++
    if (isHoleC(l, nx, nz) || isTrampC(l, nx, nz)) break
  }
  if (steps === 0) return
  myPredictions.push({ x, z })
  enqueueMove(me, {
    predicted: true, dash: true,
    p: { id: myId, level: l, x, z, ...me.orient },
  })
  me.cell = { x, z }
}

function enqueueMove(p, data) {
  p.queue.push(data)
  // if animations fall behind the server, fast-forward everything but the last
  while (p.queue.length > 2) applyMoveInstantly(p, p.queue.shift())
}

function applyMoveInstantly(p, m) {
  p.anim = null
  if (m.t === 'launch') p.level = m.p.level
  p.cell = { x: m.p.x, z: m.p.z }
  if (m.p.top != null) syncConfirmed(p, m.p)
  p.group.position.set(m.p.x, levelY(p.level) + 0.5, m.p.z)
  const q = quatForOrient(m.p)
  if (q) p.group.quaternion.copy(q)
}

function startNextAnim(p) {
  if (p.anim || p.queue.length === 0) return
  const m = p.queue.shift()

  // trampoline launch to the next platform: big soaring arc with flips
  if (m.t === 'launch') {
    const fromLevel = p.level
    p.level = m.p.level
    p.anim = {
      type: 'launch', t: 0,
      from: p.group.position.clone(),
      to: new THREE.Vector3(m.p.x, levelY(p.level) + 0.5, m.p.z),
      axis: new THREE.Vector3(1, 0, 0),
      startQuat: p.group.quaternion.clone(),
      arc: 2.6,
      target: m.p,
      time: 1.45,
    }
    // the pad visibly kicks the cube off
    const plat = platforms[fromLevel]
    if (plat) plat.tramp.bounce = 1
    sfx.launch()
    if (p.id === myId) tg?.HapticFeedback?.impactOccurred?.('heavy')
    return
  }

  const dx = Math.sign(m.p.x - p.cell.x)
  const dz = Math.sign(m.p.z - p.cell.z)
  const dist = Math.abs(m.p.x - p.cell.x) + Math.abs(m.p.z - p.cell.z)
  const baseY = levelY(p.level) + 0.5

  if (m.jump) {
    const dir = new THREE.Vector3(dx, 0, dz)
    p.anim = {
      type: 'jump', t: 0,
      from: p.group.position.clone(),
      to: new THREE.Vector3(m.p.x, baseY, m.p.z),
      axis: dir.lengthSq() > 0 ? new THREE.Vector3().crossVectors(yAxis, dir).normalize() : null,
      startQuat: p.group.quaternion.clone(),
      arc: 1.4,
      target: m.p,
      time: JUMP_TIME,
    }
    sfx.jump()
  } else if (m.dash || m.knock || dist > 1 || dist === 0) {
    p.anim = {
      type: 'dash', t: 0,
      from: p.group.position.clone(),
      to: new THREE.Vector3(m.p.x, baseY, m.p.z),
      dir: new THREE.Vector3(dx, 0, dz),
      target: m.p,
      time: DASH_TIME * Math.max(1, dist * 0.7),
    }
    if (m.dash) sfx.dash() // knockback slides are voiced by the hit sound
  } else {
    p.anim = {
      type: 'roll', t: 0,
      axis: new THREE.Vector3().crossVectors(yAxis, new THREE.Vector3(dx, 0, dz)),
      pivot: p.group.position.clone().add(new THREE.Vector3(dx * 0.5, -0.5, dz * 0.5)),
      startPos: p.group.position.clone(),
      startQuat: p.group.quaternion.clone(),
      target: m.p,
      time: ROLL_TIME,
    }
    sfx.roll()
  }
}

function updatePlayerAnim(p, dt) {
  startNextAnim(p)
  const a = p.anim
  if (!a) return
  a.t = Math.min(a.t + dt / a.time, 1)
  const e = smoothstep(a.t)

  if (a.type === 'roll') {
    const q = new THREE.Quaternion().setFromAxisAngle(a.axis, e * Math.PI / 2)
    p.group.quaternion.copy(q).multiply(a.startQuat)
    p.group.position.copy(a.startPos).sub(a.pivot).applyQuaternion(q).add(a.pivot)
  } else if (a.type === 'jump') {
    p.group.position.lerpVectors(a.from, a.to, e)
    p.group.position.y += a.arc * 4 * e * (1 - e)
    // full flip in the air: ends in the same orientation it started with
    const axis = a.axis || new THREE.Vector3(1, 0, 0)
    const q = new THREE.Quaternion().setFromAxisAngle(axis, e * Math.PI * 2)
    p.group.quaternion.copy(q).multiply(a.startQuat)
  } else if (a.type === 'launch') {
    // trampoline pop: shoots up fast, floats over the apex, settles down softly
    p.group.position.x = a.from.x + (a.to.x - a.from.x) * e
    p.group.position.z = a.from.z + (a.to.z - a.from.z) * e
    const ve = 1 - Math.pow(1 - a.t, 2.4)
    p.group.position.y = a.from.y + (a.to.y - a.from.y) * ve + a.arc * 4 * a.t * (1 - a.t)
    // double front flip, slowing towards the landing; ends where it started
    const q = new THREE.Quaternion().setFromAxisAngle(a.axis, e * Math.PI * 4)
    p.group.quaternion.copy(q).multiply(a.startQuat)
    // stretch on take-off, relax mid-air
    const st = 1 + 0.4 * Math.sin(Math.PI * Math.min(a.t * 2.5, 1)) * (1 - a.t)
    p.group.scale.set(1 / Math.sqrt(st), st, 1 / Math.sqrt(st))
  } else {
    p.group.position.lerpVectors(a.from, a.to, e)
    // dash stretch: elongate along travel direction mid-dash
    const s = 1 + Math.sin(a.t * Math.PI) * 0.25
    const sq = 1 / Math.sqrt(s)
    p.group.scale.set(
      a.dir.x !== 0 ? s : sq,
      sq,
      a.dir.z !== 0 ? s : sq
    )
  }

  if (a.t >= 1) {
    p.cell = { x: a.target.x, z: a.target.z }
    p.group.position.set(a.target.x, levelY(p.level) + 0.5, a.target.z)
    p.group.scale.set(1, 1, 1)
    const q = quatForOrient(a.target)
    if (q) p.group.quaternion.copy(q)
    p.anim = null
    if (p.id === myId) haptic()
    startNextAnim(p)
    if (!p.anim && p.pendingDeath) {
      startDeathAnim(p, p.pendingDeath)
      p.pendingDeath = null
    }
  }
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------
const WS_BASE = import.meta.env.VITE_WS_URL
  || (location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? 'ws://localhost:8090/ws'
    : 'wss://104-171-132-140.sslip.io/ws') // production game server (VPS)

let myName = ''
const wsUrl = () => `${WS_BASE}?name=${encodeURIComponent(myName)}`

let ws = null
let reconnectDelay = 500
let statusTimeout = null

function setStatus(text, autoClearMs = 0) {
  clearTimeout(statusTimeout)
  statusEl.textContent = text
  statusEl.classList.toggle('hidden', !text)
  if (text && autoClearMs) {
    statusTimeout = setTimeout(() => setStatus(''), autoClearMs)
  }
}

function connect() {
  setStatus('ПОДКЛЮЧЕНИЕ...')
  ws = new WebSocket(wsUrl())

  ws.onopen = () => {
    reconnectDelay = 500
    setStatus('')
  }

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    handleMessage(msg)
  }

  ws.onclose = () => {
    // wipe everything; the server will resend the world on reconnect
    for (const id of [...players.keys()]) removePlayer(id)
    myId = null
    myPredictions = []
    setStatus('ПЕРЕПОДКЛЮЧЕНИЕ...')
    setTimeout(connect, reconnectDelay)
    reconnectDelay = Math.min(reconnectDelay * 2, 8000)
  }
}

function send(obj) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj))
}

function handleMessage(msg) {
  switch (msg.t) {
    case 'welcome': {
      myId = msg.id
      dashCooldownMs = msg.dashCooldownMs || 5000
      jumpCooldownMs = msg.jumpCooldownMs || 1200
      restorePlatforms()
      if (msg.destroyed) {
        msg.destroyed.forEach((cells, l) => {
          for (const [x, z] of cells || []) destroyCellVisual(l, x, z, false)
        })
      }
      if (msg.tramps) {
        msg.tramps.forEach((tr, l) => { if (tr) showTramp(l, tr[0], tr[1]) })
      }
      applyPhase(msg.phase)
      for (const pd of msg.players) addPlayer(pd)
      break
    }
    case 'join':
      addPlayer(msg.p)
      break
    case 'leave':
      removePlayer(msg.id)
      break
    case 'move': {
      const p = players.get(msg.p.id)
      if (!p) { addPlayer(msg.p); break }
      syncConfirmed(p, msg.p)

      if (msg.p.id === myId) {
        if (msg.dash) dashReadyAt = performance.now() + dashCooldownMs
        if (msg.jump) jumpReadyAt = performance.now() + jumpCooldownMs

        // regular rolls/dashes were already animated by the prediction:
        // just confirm them, never enqueue the same move twice
        if (myPredictions.length > 0 && !msg.knock && !msg.jump) {
          const pred = myPredictions.shift()
          if (pred.x === msg.p.x && pred.z === msg.p.z) break
          rollbackPrediction(p) // server disagreed: snap to its state
          break
        }
        // knockback/jump arrive unpredicted; drop stale predictions first
        if (myPredictions.length > 0) rollbackPrediction(p)
      }

      enqueueMove(p, msg)
      break
    }
    case 'hit': {
      const a = players.get(msg.a)
      const d = players.get(msg.d)
      if (a) {
        a.hp = msg.hpA
        a.flash = 1
        drawHpBar(a.bar, a.hp)
        spawnPopup(`-${msg.dmgToA}`, NEON_MAGENTA, a.group.position.clone().add(new THREE.Vector3(0, 1.4, 0)))
      }
      if (d) {
        d.hp = msg.hpD
        d.flash = 1
        drawHpBar(d.bar, d.hp)
        spawnPopup(`-${msg.dmgToD}`, NEON_MAGENTA, d.group.position.clone().add(new THREE.Vector3(0, 1.4, 0)))
      }
      sfx.hit()
      if (msg.a === myId || msg.d === myId) {
        shake = 0.35
        tg?.HapticFeedback?.impactOccurred?.('heavy')
      }
      // a predicted step may have raced into a cell someone just occupied
      if (msg.a === myId && myPredictions.length > 0) rollbackPrediction(players.get(myId))
      break
    }
    case 'death': {
      const p = players.get(msg.id)
      if (!p) break
      if (msg.id === myId) myPredictions = []
      p.dead = true
      const mode = msg.cause === 'fall' ? 'fall' : 'shrink'
      // let pending move animations (e.g. the jump arc off the platform)
      // play out first, otherwise the cube "falls through" its own tile
      if (p.anim || p.queue.length > 0) p.pendingDeath = mode
      else startDeathAnim(p, mode)
      if (msg.id === myId) {
        setStatus(msg.cause === 'fall' ? 'ПАДЕНИЕ — РЕСПАУН...' : 'УНИЧТОЖЕН — РЕСПАУН...')
      }
      break
    }
    case 'respawn': {
      const p = players.get(msg.p.id)
      if (!p) { addPlayer(msg.p); break }
      if (msg.p.id === myId) myPredictions = []
      p.dead = false
      p.hp = msg.p.hp
      p.level = msg.p.level
      p.cell = { x: msg.p.x, z: msg.p.z }
      p.queue = []
      p.anim = null
      p.deathAnim = null
      p.pendingDeath = null
      p.gone = false
      p.group.position.set(msg.p.x, levelY(p.level) + 0.5, msg.p.z)
      p.group.scale.set(1, 1, 1)
      const q = quatForOrient(msg.p)
      if (q) p.group.quaternion.copy(q)
      p.spawnAnim = { t: 0 }
      drawHpBar(p.bar, p.hp)
      if (msg.p.id === myId) setStatus('')
      break
    }
    case 'phase': {
      applyPhase(msg)
      if (msg.mode === 'crumble') {
        sfx.alarm()
        hapticError()
      }
      break
    }
    case 'tiles': {
      for (const [x, z] of msg.cells || []) {
        destroyCellVisual(msg.level, x, z, true)
      }
      const me = players.get(myId)
      if (me && me.level === msg.level) {
        shake = Math.max(shake, 0.12)
        if (Math.random() < 0.5) sfx.crumble()
      }
      break
    }
    case 'tramp':
      showTramp(msg.level, msg.x, msg.z)
      break
    case 'launch': {
      const p = players.get(msg.p.id)
      if (!p) { addPlayer(msg.p); break }
      if (msg.p.id === myId) myPredictions = []
      // queued after the move that stepped onto the trampoline,
      // so the roll finishes first and the launch starts from the pad
      enqueueMove(p, msg)
      break
    }
    case 'reset': {
      myPredictions = []
      restorePlatforms()
      applyPhase(msg.phase)
      for (const pd of msg.players || []) {
        const p = players.get(pd.id) || addPlayer(pd)
        p.dead = false
        p.hp = pd.hp
        p.level = pd.level
        p.cell = { x: pd.x, z: pd.z }
        p.queue = []
        p.anim = null
        p.deathAnim = null
        p.pendingDeath = null
        p.gone = false
        p.group.position.set(pd.x, levelY(pd.level) + 0.5, pd.z)
        p.group.scale.set(1, 1, 1)
        const q = quatForOrient(pd)
        if (q) p.group.quaternion.copy(q)
        p.spawnAnim = { t: 0 }
        drawHpBar(p.bar, p.hp)
      }
      sfx.crumble()
      setStatus('НОВЫЙ РАУНД', 2500)
      break
    }
    case 'denied':
      if (msg.reason === 'dash_cooldown' || msg.reason === 'jump_cooldown') {
        hapticError()
        sfx.deny()
      }
      if ((msg.reason === 'blocked' || msg.reason === 'cooldown') && myPredictions.length > 0) {
        rollbackPrediction(players.get(myId))
      }
      break
  }
}

// ---------------------------------------------------------------------------
// Login: nickname gate before joining the arena
// ---------------------------------------------------------------------------
const loginEl = document.getElementById('login')
const nickInput = document.getElementById('nick')
const playBtn = document.getElementById('play')
let inGame = false

nickInput.value = localStorage.getItem('cube2077-nick') || ''

function startGame() {
  const nick = nickInput.value.trim().slice(0, 14)
  if (!nick) {
    nickInput.focus()
    nickInput.placeholder = 'ВВЕДИ НИК!'
    return
  }
  myName = nick
  localStorage.setItem('cube2077-nick', nick)
  loginEl.classList.add('hidden')
  inGame = true
  ensureAudio()
  connect()
}

playBtn.addEventListener('click', startGame)
nickInput.addEventListener('keydown', (e) => {
  e.stopPropagation() // typing WASD in the input must not move the cube
  if (e.key === 'Enter') startGame()
})
nickInput.focus()

// ---------------------------------------------------------------------------
// Input: keyboard + swipe, double-tap = dash, space = jump
// ---------------------------------------------------------------------------
const DOUBLE_TAP_MS = 260
// keep the send rate in lockstep with the server's roll cooldown: extra
// key presses are dropped instead of queueing up and playing after release
const MOVE_GATE_MS = 140
let moveGateAt = 0
let lastDir = null
let lastDirAt = 0
let lastMoveDir = [0, -1]   // direction the jump will use

function inputDir(dx, dz) {
  if (!inGame) return
  const now = performance.now()
  const isDouble = lastDir && lastDir[0] === dx && lastDir[1] === dz && (now - lastDirAt) < DOUBLE_TAP_MS
  lastDir = [dx, dz]
  lastDirAt = now
  lastMoveDir = [dx, dz]
  if (isDouble && now >= dashReadyAt) {
    predictDash(dx, dz)
    send({ t: 'dash', dx, dz })
    moveGateAt = now + MOVE_GATE_MS
    lastDir = null // don't chain triple-tap into two dashes
  } else {
    const me = players.get(myId)
    if (now < moveGateAt || (me && me.queue.length >= 2)) return
    // walls and obstacles are known client-side: don't send a doomed move
    if (!predictRoll(dx, dz)) return
    moveGateAt = now + MOVE_GATE_MS
    send({ t: 'move', dx, dz })
  }
  if (!moved) { moved = true; hint.classList.add('faded') }
}

function inputJump() {
  if (!inGame) return
  if (performance.now() < jumpReadyAt) {
    sfx.deny()
    return
  }
  send({ t: 'jump', dx: lastMoveDir[0], dz: lastMoveDir[1] })
}

const KEYS = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
}
window.addEventListener('keydown', (e) => {
  if (e.repeat) return
  if (e.code === 'Space') { e.preventDefault(); inputJump(); return }
  const dir = KEYS[e.code]
  if (dir) { e.preventDefault(); inputDir(dir[0], dir[1]) }
})

let touchStart = null
window.addEventListener('pointerdown', (e) => { touchStart = { x: e.clientX, y: e.clientY, t: performance.now() } })
window.addEventListener('pointerup', (e) => {
  if (!touchStart) return
  const dx = e.clientX - touchStart.x
  const dy = e.clientY - touchStart.y
  const dt = performance.now() - touchStart.t
  touchStart = null
  if (Math.hypot(dx, dy) < 24) {
    // quick tap without swipe = jump (mobile)
    if (dt < 220) inputJump()
    return
  }
  if (Math.abs(dx) > Math.abs(dy)) inputDir(Math.sign(dx), 0)
  else inputDir(0, Math.sign(dy))
})

// ---------------------------------------------------------------------------
// Camera follow + resize + loop
// ---------------------------------------------------------------------------
const camOffset = new THREE.Vector3(0, 8.5, 9.5)
const camTarget = new THREE.Vector3()
const lookTarget = new THREE.Vector3(0, 0.5, 0)
const lookGoal = new THREE.Vector3()

function resize() {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  composer.setSize(window.innerWidth, window.innerHeight)
}
window.addEventListener('resize', resize)
tg?.onEvent?.('viewportChanged', resize)

const clock = new THREE.Clock()
let lastTimerText = ''

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05)
  const t = clock.elapsedTime

  // platforms above mine are hidden so they don't block the view of the arena
  const myLevel = players.get(myId)?.level ?? 0

  // gentle platform hover, slightly out of phase per level
  for (let l = 0; l < platforms.length; l++) {
    platforms[l].group.visible = l <= myLevel
    platforms[l].group.position.y = levelY(l) + Math.sin(t * 0.6 + l * 1.3) * 0.05
  }

  // crumbled pieces tumble down into the void
  for (let i = fallingPieces.length - 1; i >= 0; i--) {
    const f = fallingPieces[i]
    f.t += dt
    if (f.t < 0) continue
    f.vy += dt * 9
    f.obj.position.y -= f.vy * dt
    f.obj.rotation.x += f.rx * dt
    f.obj.rotation.z += f.rz * dt
    if (f.t > 2.2) {
      f.obj.visible = false
      f.obj.position.copy(f.pos0)
      f.obj.quaternion.copy(f.quat0)
      fallingPieces.splice(i, 1)
    }
  }

  // trampolines pulse invitingly; a fresh launch makes the pad dip and flash
  for (const plat of platforms) {
    const tr = plat.tramp
    if (tr.bounce > 0) tr.bounce = Math.max(0, tr.bounce - dt * 2)
    if (!tr.g.visible) continue
    const kick = Math.sin(tr.bounce * Math.PI)
    tr.pad.position.y = 0.17 + Math.abs(Math.sin(t * 5)) * 0.08 - kick * 0.16
    tr.pad.material.emissiveIntensity = 1.3 + kick * 2.2
    tr.ring.material.emissiveIntensity = 1.2 + Math.sin(t * 6) * 0.6 + kick * 1.8
  }

  // players: movement, flashes, death/spawn animations, hp bars
  for (const p of players.values()) {
    updatePlayerAnim(p, dt)

    // cubes on hidden (upper) platforms are hidden along with them
    p.group.visible = !p.gone && p.level <= myLevel

    if (p.flash > 0) {
      p.flash = Math.max(0, p.flash - dt * 4)
      p.bodyMat.emissive.set('#ff2222')
      p.bodyMat.emissiveIntensity = p.flash * 1.2
    } else {
      p.bodyMat.emissiveIntensity = 0
    }

    if (p.deathAnim) {
      const da = p.deathAnim
      da.t += dt
      if (da.mode === 'fall') {
        // plunge off the platform, tumbling
        da.vy += dt * 16
        p.group.position.y -= da.vy * dt
        p.group.rotation.x += dt * 5
        p.group.rotation.z += dt * 3.2
        const k = Math.min(da.t / 1.1, 1)
        p.group.scale.setScalar(1 - k * 0.5)
        if (k >= 1) { p.gone = true; p.group.visible = false; p.deathAnim = null }
      } else {
        const k = Math.min(da.t * 1.6, 1)
        p.group.scale.setScalar(Math.max(0.001, 1 - k * 0.999))
        p.group.rotation.y += dt * 10
        p.group.position.y = levelY(p.level) + 0.5 + k * 1.2
        if (k >= 1) { p.gone = true; p.group.visible = false; p.deathAnim = null }
      }
    }

    if (p.spawnAnim) {
      p.spawnAnim.t += dt * 3
      const k = Math.min(p.spawnAnim.t, 1)
      p.group.scale.setScalar(Math.max(0.001, smoothstep(k)))
      if (k >= 1) { p.group.scale.set(1, 1, 1); p.spawnAnim = null }
    }

    // hp bar floats above the die (hidden while dead)
    p.bar.sprite.visible = !p.dead && p.group.visible
    p.bar.sprite.position.set(p.group.position.x, p.group.position.y + 1.15, p.group.position.z)
  }

  // my bar also shows dash readiness, redrawn every frame while recharging
  const meBar = players.get(myId)
  if (meBar && !meBar.dead) {
    const remainMs = Math.max(0, dashReadyAt - performance.now())
    drawHpBar(meBar.bar, meBar.hp, 1 - remainMs / dashCooldownMs)
  }

  // round timer HUD
  {
    let txt = ''
    let danger = false
    if (phase.mode === 'calm') {
      const remain = Math.max(0, phase.endsAt - performance.now())
      const s = Math.ceil(remain / 1000)
      txt = `ПЛАТФОРМА ${phase.level + 1}/3 · РАЗРУШЕНИЕ ЧЕРЕЗ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
    } else {
      danger = true
      txt = phase.level < 2
        ? `⚠ ПЛАТФОРМА ${phase.level + 1} РУШИТСЯ — К БАТУТУ!`
        : '⚠ ФИНАЛЬНАЯ ПЛАТФОРМА РУШИТСЯ!'
    }
    if (txt !== lastTimerText) {
      timerEl.textContent = txt
      timerEl.classList.toggle('danger', danger)
      lastTimerText = txt
    }
  }

  // damage popups float up and fade
  for (let i = popups.length - 1; i >= 0; i--) {
    const pop = popups[i]
    pop.life -= dt * 1.1
    pop.sprite.position.y += dt * 1.2
    pop.sprite.material.opacity = Math.max(0, pop.life)
    if (pop.life <= 0) {
      scene.remove(pop.sprite)
      pop.sprite.material.map.dispose()
      pop.sprite.material.dispose()
      popups.splice(i, 1)
    }
  }

  // flying cars stream in circles, facing their direction of travel
  for (const c of cars) {
    const u = c.userData
    u.angle += u.speed * dt
    const nx = Math.cos(u.angle) * u.radius
    const nz = Math.sin(u.angle) * u.radius
    c.position.set(nx, u.y, nz)
    const ahead = u.angle + Math.sign(u.speed) * 0.05
    c.lookAt(Math.cos(ahead) * u.radius, u.y, Math.sin(ahead) * u.radius)
    c.rotateY(Math.PI / 2) // body is modeled along +x
  }

  // rain falls and wraps around
  const pos = rainGeo.attributes.position.array
  for (let i = 0; i < RAIN_COUNT; i++) {
    pos[i * 3 + 1] -= rainSpeed[i] * dt
    if (pos[i * 3 + 1] < -6) pos[i * 3 + 1] = 24
  }
  rainGeo.attributes.position.needsUpdate = true

  // pulsing beacons and rotating holograms
  for (const b of blinkers) {
    b.mesh.material.emissiveIntensity = 1.1 + Math.sin(t * b.speed + b.phase) * 0.7
  }
  for (const h of holos) {
    h.rotation.y = t * 1.2
    h.position.y = 2.0 + Math.sin(t * 2) * 0.08
  }

  // neon accent lights breathe slightly
  magentaLight.intensity = neonBase + Math.sin(t * 1.7) * neonBase * 0.18
  cyanLight.intensity = neonBase + Math.cos(t * 1.3) * neonBase * 0.18

  // camera smoothly follows my die with a subtle sway + hit shake,
  // riding up together with the platforms
  const me = players.get(myId)
  const fx = me ? me.group.position.x : 0
  const fz = me ? me.group.position.z : 0
  const myLvlY = me ? levelY(me.level) : 0
  camTarget.set(
    fx * 0.55 + Math.sin(t * 0.25) * 0.6,
    myLvlY,
    fz * 0.55
  ).add(camOffset)
  camera.position.lerp(camTarget, 1 - Math.pow(0.001, dt))
  if (shake > 0) {
    shake = Math.max(0, shake - dt * 1.4)
    camera.position.x += (Math.random() - 0.5) * shake * 0.3
    camera.position.y += (Math.random() - 0.5) * shake * 0.3
  }
  lookGoal.set(fx * 0.6, myLvlY + 0.5, fz * 0.6)
  lookTarget.lerp(lookGoal, 1 - Math.pow(0.001, dt))
  camera.lookAt(lookTarget)

  composer.render()
  requestAnimationFrame(tick)
}

resize()
tick()
