import * as THREE from 'three'
import { assetUrl, cloneGltf } from '../assets/gltf.js'
import { blob, canvasTexture, cellRng, createDrift, geo, glow, pick, solid, toon } from './kit.js'

// Jungle map: Blender review scene → public/assets/maps/jungle.
// Visual language: Fall Guys candy — flat pastel plastic, soft toon, almost no albedo.
// Stage 2 kit sync with art/jungle MAT_* (warm board / mid bush / cool distant foliage).
const MOSS = '#8CDB66'       // MAT_Grass_A
const MOSS_DEEP = '#6BBC5C'  // MAT_Grass_B
const DIRT = '#F0D19E'       // MAT_Dirt
const WOOD = '#E69E6B'       // MAT_Wood
const WOOD_DARK = '#C78057'  // MAT_Wood_Dark
const LEAF = '#5CBC7A'       // MAT_Foliage_Mid (cooler bush)
const LEAF_LIGHT = '#7AD694' // MAT_Foliage_Light (distant)
const LEAF_DARK = '#38946B'  // MAT_Foliage_Dark
const ROCK = '#DBD6E0'       // MAT_Rock
const ROCK_DARK = '#ADA8BD'  // MAT_Rock_Dark
const WATER = '#4DC7E0'      // MAT_Water
const WATER_DEEP = '#2E9EC7' // MAT_Water_Deep
const GOLDIE = '#F2C747'     // MAT_Goldie
const FLOWER = '#F070B8'
const FIREFLY = '#F0E060'
const PIRANHA = '#E85868'
const PIRANHA_BELLY = '#F0C070'
const PIRANHA_FIN = '#D04058'

// Lake surface height in Three.js after glTF (Blender Z → Y).
const LAKE_Y = -3.15
const LAKE_SWIM_R = 10.5

const SCENE_URL = assetUrl('jungle', 'backdrop', 'scene') + '?v=gfx18'
const TREE_URL = assetUrl('jungle', 'props', 'tree')
const STUMP_URL = assetUrl('jungle', 'props', 'stump')
const FERN_URL = assetUrl('jungle', 'props', 'fern')
const VINE_URL = assetUrl('jungle', 'props', 'vine')
const PIRANHA_URL = assetUrl('jungle', 'props', 'piranha')

const ASSETS = [SCENE_URL, TREE_URL, STUMP_URL, FERN_URL, VINE_URL, PIRANHA_URL]

// Shared so day/night can recolour backdrop after both exist.
const importedMats = []

// Fall Guys candy remaps for imported mesh materials (by Blender material name).
const DAY_PALETTE = {
  Wood: WOOD, WoodDark: WOOD_DARK, PalmWood: WOOD, ArenaWood: WOOD,
  // Canopy: mid bush + cool distant (no autumn yellow)
  Leaf: LEAF, LeafDark: LEAF_DARK, LeafYellow: LEAF,
  PalmLeafYellow: LEAF, PalmLeaf: LEAF, ObsLeafYellow: LEAF_DARK, BushLeaf: LEAF,
  Moss: MOSS, MossDeep: MOSS_DEEP, ArenaMoss: MOSS,
  Dirt: DIRT, ArenaSoil: DIRT, ArenaRoot: WOOD_DARK, RiverBank: DIRT,
  Hill: LEAF_LIGHT, HillDark: LEAF_DARK,
  Mountain: '#B8C7E0', MountainDark: '#8594B3',
  Stone: ROCK, StoneDark: ROCK_DARK,
  ArenaStone: ROCK, ArenaStoneDark: ROCK_DARK, ObsStone: ROCK,
  ArenaTileA: MOSS, ArenaTileB: MOSS_DEEP,
  ArenaPad: MOSS_DEEP, ArenaPadLine: '#9EE67A',
  ArenaGold: GOLDIE, TempleGold: GOLDIE, RuneGlow: GOLDIE,
  ArenaCrystal: '#68D0E8',
  FlowerRed: '#E86080', FlowerYellow: '#E8D850', FlowerPurple: '#B078E8',
  Water: WATER, WaterDeep: WATER_DEEP, WaterFoam: '#E6F7FA', WaterSpark: '#E6F7FA',
  WaterRipple: '#B2EAF8', WaterShoreRing: '#D9F5FA', WaterPad: '#52B86B', WaterPadVein: '#38944D',
  Vine: LEAF_DARK,
  BeeYellow: '#E8D850', BeeBlack: '#4A4058', Wing: '#E8F0F8',
  ButterflyBlue: '#5898E0', ButterflyOrange: '#E88850',
  CaterpillarGreen: LEAF, CaterpillarStripe: '#E8D850',
  // Quaternius / Kenney fish materials (common names)
  Piranha: '#E85868', PiranhaBelly: '#F0C070', PiranhaFin: '#D04058',
  Body: '#E85868', Fin: '#D04058', Eye: '#2A2030',
  // Stage 2 kit names (if ever present on meshes)
  MAT_Grass_A: MOSS, MAT_Grass_B: MOSS_DEEP, MAT_Grass_C: '#9EE67A', MAT_Grass_D: '#52A34D',
  MAT_Rock: ROCK, MAT_Rock_Dark: ROCK_DARK,
  MAT_Wood: WOOD, MAT_Wood_Dark: WOOD_DARK,
  MAT_Foliage_Light: LEAF_LIGHT, MAT_Foliage_Mid: LEAF, MAT_Foliage_Dark: LEAF_DARK,
  MAT_Dirt: DIRT, MAT_Water: WATER, MAT_Water_Deep: WATER_DEEP, MAT_Goldie: GOLDIE,
  FarLeaf: '#619E94', FarLeafDark: '#477A80',
  FrameLeaf: '#52B86B', FrameLeafDark: '#388C57',
  DepthHaze: '#8CB8D1',
  // Dressed-card NatureKit / DesertKit / ground: keep Blender colours (no candy remap)
}
const NIGHT_PALETTE = {
  Wood: '#6a5868', WoodDark: '#5a4a52', PalmWood: '#6a5868', ArenaWood: '#6a5868',
  Leaf: '#4a6870', LeafDark: '#3a5860', LeafYellow: '#4a6870',
  PalmLeafYellow: '#4a6870', PalmLeaf: '#4a6870', ObsLeafYellow: '#3a5860', BushLeaf: '#4a6870',
  Moss: '#4a6858', MossDeep: '#3a5848', ArenaMoss: '#4a6858',
  Dirt: '#6a5a50', ArenaSoil: '#6a5a50', ArenaRoot: '#5a4a42',
  Hill: '#4a6870', HillDark: '#3a5860',
  Mountain: '#6a6870', MountainDark: '#585860',
  ArenaStone: '#6a6870', ArenaStoneDark: '#585860', ObsStone: '#6a6870',
  ArenaTileA: '#4a6858', ArenaTileB: '#3a5848',
  ArenaPad: '#4a6858', ArenaPadLine: '#a0c080',
  ArenaGold: '#8a6840', ArenaCrystal: '#5080aa',
  FlowerRed: '#804050', FlowerYellow: '#807040', FlowerPurple: '#604080',
  Water: '#3a5a68', WaterDeep: '#2a4858', WaterFoam: '#708090',
}

function matKey(name) {
  return (name || '').replace(/\.\d+$/, '')
}

function paletteHex(palette, name) {
  if (!palette || !name) return null
  if (palette[name]) return palette[name]
  const stripped = matKey(name)
  if (palette[stripped]) return palette[stripped]
  return null
}

function isAuthoredBackdropMat(name) {
  const n = name || ''
  return n.startsWith('PixelPalette')
    || n === 'MAT_GroundMix'
    || n === 'Material'
    || n.startsWith('Material.')
}

function tintByMaterialName(root, palette) {
  if (!root || !palette) return root
  root.traverse((obj) => {
    if (!obj.isMesh) return
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const m of mats) {
      if (m?.vertexColors) continue // baked ground / colour attributes
      if (m?.map) continue // NatureKit atlas / water maps
      if (isAuthoredBackdropMat(m?.name)) continue
      const hex = paletteHex(palette, m?.name)
      if (hex && m?.color) m.color.set(hex)
    }
  })
  return root
}

function collectMats(root, into) {
  const seen = new Set(into)
  root.traverse((obj) => {
    if (!obj.isMesh) return
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const m of mats) {
      if (m?.color && !seen.has(m)) {
        seen.add(m)
        into.push(m)
      }
    }
  })
}

function prepareImported(root, { shadows = true, cast = true } = {}) {
  root.traverse((obj) => {
    if (!obj.isMesh) return
    obj.castShadow = shadows && cast
    obj.receiveShadow = shadows
    // Backdrop must never include the old Blender arena frame / plinth "logs".
    // Arena/Obs/Col = collision proxies; VisCell_ = Blender-only playfield double.
    if (
      obj.name.startsWith('Arena_')
      || obj.name.startsWith('Obs_')
      || obj.name.startsWith('Col_')
      || obj.name.startsWith('VisCell_')
    ) {
      obj.visible = false
    }
  })
  return root
}

/** Selective shadow casters — palms/cliffs/bushes/rocks cast; grass/reeds receive-only. */
function applyBackdropShadows(root, { castMode = 'heavy' } = {}) {
  root.traverse((obj) => {
    if (!obj.isMesh) return
    const n = obj.name || ''
    obj.receiveShadow = true

    const isWaterish = n.startsWith('LakeWater_')
      || n.startsWith('Ripple_')
      || n.startsWith('ShoreRing_')
      || n.startsWith('Sparkle_')
      || n.startsWith('Foam_')
      || n.startsWith('LilyPad_')
      || n.startsWith('GROUND_')

    const receiveOnly = isWaterish
      || n.startsWith('VEG_Grass')
      || n.startsWith('VEG_Reed')
      || n.startsWith('VEG_Pebble')
      || n.startsWith('VEG_Fern')
      || n.startsWith('VEG_CornerGrass')
      || n.startsWith('VEG_CornerFern')
      || n.startsWith('VEG_OuterGrass')
      || n.startsWith('VEG_RimGrass')
      || n.startsWith('VEG_GrassFill')
      || n.startsWith('VEG_FernFill')

    const castCore = n.startsWith('VEG_Palm')
      || n.startsWith('NatureKit_M_Cliff')

    const castHeavy = castCore
      || n.startsWith('VEG_Bush')
      || n.startsWith('VEG_OuterBush')
      || n.startsWith('VEG_RimBush')
      || n.startsWith('VEG_CornerBush')
      || n.startsWith('VEG_BushFill')
      || n.startsWith('VEG_Boulder')
      || n.startsWith('VEG_Stone')
      || n.startsWith('VEG_WaterStone')

    if (receiveOnly) {
      obj.castShadow = false
      obj.userData.shadowCastTier = 'never'
    } else if (castCore) {
      obj.userData.shadowCastTier = 'core'
      obj.castShadow = true
    } else if (castHeavy) {
      obj.userData.shadowCastTier = 'heavy'
      obj.castShadow = castMode === 'heavy'
    } else {
      obj.castShadow = false
      obj.userData.shadowCastTier = 'never'
    }
  })
  return root
}

function cloneProp(url) {
  const root = cloneGltf(url)
  if (!root) return null
  root.traverse((obj) => {
    if (!obj.isMesh) return
    if (Array.isArray(obj.material)) obj.material = obj.material.map((m) => m.clone())
    else if (obj.material) obj.material = obj.material.clone()
    solid(obj)
  })
  tintByMaterialName(root, DAY_PALETTE)
  return root
}

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

function matNamesOf(obj) {
  const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
  return mats.map((m) => matKey(m?.name)).filter(Boolean)
}

/** Prefer Kenney-style authored piranha GLB; procedural candy fallback. */
function makePiranha(rnd) {
  const authored = cloneGltf(PIRANHA_URL)
  if (authored) {
    authored.traverse((obj) => {
      if (!obj.isMesh) return
      if (Array.isArray(obj.material)) obj.material = obj.material.map((m) => m.clone())
      else if (obj.material) obj.material = obj.material.clone()
      solid(obj)
    })
    tintByMaterialName(authored, DAY_PALETTE)
    const s = 0.85 + rnd() * 0.4
    authored.scale.setScalar(s)
    return authored
  }

  const g = new THREE.Group()
  const bodyMat = toon(PIRANHA, { steps: 7 })
  const bellyMat = toon(PIRANHA_BELLY, { steps: 7 })
  const finMat = toon(PIRANHA_FIN, { steps: 7 })
  const eyeMat = toon('#2A2030', { steps: 7 })
  const toothMat = toon('#F8F0E0', { steps: 7 })

  const body = solid(new THREE.Mesh(
    geo('jungle:piranhaBody', () => new THREE.SphereGeometry(0.28, 10, 8)),
    bodyMat))
  body.scale.set(1.35, 0.85, 0.95)
  g.add(body)

  const belly = new THREE.Mesh(
    geo('jungle:piranhaBelly', () => new THREE.SphereGeometry(0.2, 8, 6)),
    bellyMat)
  belly.position.set(0, -0.1, 0.02)
  belly.scale.set(1.1, 0.7, 0.85)
  g.add(belly)

  const snout = solid(new THREE.Mesh(
    geo('jungle:piranhaSnout', () => new THREE.ConeGeometry(0.14, 0.28, 7)),
    bodyMat))
  snout.rotation.z = -Math.PI / 2
  snout.position.set(0.32, -0.02, 0)
  g.add(snout)

  for (const side of [-1, 1]) {
    const jaw = new THREE.Mesh(
      geo('jungle:piranhaJaw', () => new THREE.BoxGeometry(0.16, 0.05, 0.14)),
      bodyMat)
    jaw.position.set(0.38, side * 0.07, 0)
    g.add(jaw)
    for (let i = 0; i < 3; i++) {
      const tooth = new THREE.Mesh(
        geo('jungle:piranhaTooth', () => new THREE.ConeGeometry(0.02, 0.06, 4)),
        toothMat)
      tooth.position.set(0.42, side * 0.04, (i - 1) * 0.04)
      tooth.rotation.z = side > 0 ? Math.PI : 0
      g.add(tooth)
    }
  }

  const dorsal = new THREE.Mesh(
    geo('jungle:piranhaDorsal', () => new THREE.ConeGeometry(0.12, 0.28, 5)),
    finMat)
  dorsal.position.set(-0.02, 0.28, 0)
  dorsal.rotation.z = 0.15
  g.add(dorsal)

  const tail = new THREE.Mesh(
    geo('jungle:piranhaTail', () => new THREE.ConeGeometry(0.16, 0.3, 5)),
    finMat)
  tail.rotation.z = Math.PI / 2
  tail.position.set(-0.38, 0.02, 0)
  g.add(tail)

  for (const side of [-1, 1]) {
    const fin = new THREE.Mesh(
      geo('jungle:piranhaPec', () => new THREE.ConeGeometry(0.08, 0.18, 5)),
      finMat)
    fin.position.set(0.05, -0.05, side * 0.22)
    fin.rotation.set(side * 0.6, 0, side * 0.4)
    g.add(fin)
  }

  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(
      geo('jungle:piranhaEye', () => new THREE.SphereGeometry(0.045, 6, 6)),
      eyeMat)
    eye.position.set(0.18, 0.08, side * 0.16)
    g.add(eye)
  }

  const s = 0.75 + rnd() * 0.35
  g.scale.setScalar(s)
  return g
}

function createPiranhas(parent) {
  const fish = []
  const n = 11
  for (let i = 0; i < n; i++) {
    const rnd = () => Math.random()
    const mesh = makePiranha(rnd)
    parent.add(mesh)
    const orbitR = 3.2 + Math.random() * LAKE_SWIM_R * 0.55
    fish.push({
      mesh,
      phase: Math.random() * Math.PI * 2,
      speed: 0.35 + Math.random() * 0.55,
      dir: Math.random() < 0.5 ? 1 : -1,
      radius: orbitR,
      radiusWobble: 0.4 + Math.random() * 0.9,
      depth: LAKE_Y - 0.25 - Math.random() * 0.55,
      jumpEvery: 4.5 + Math.random() * 7,
      jumpPhase: Math.random() * 10,
      jumpDur: 0.85 + Math.random() * 0.35,
      jumpH: 1.6 + Math.random() * 1.4,
    })
  }
  return fish
}

function updatePiranhas(fish, t) {
  for (const f of fish) {
    const a = t * f.speed * f.dir + f.phase
    const r = f.radius + Math.sin(a * 0.7) * f.radiusWobble
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r

    const cycle = (t + f.jumpPhase) % f.jumpEvery
    let y = f.depth
    let pitch = Math.sin(a * 2.2) * 0.12
    let roll = Math.sin(a * 3.1) * 0.18
    if (cycle < f.jumpDur) {
      const u = cycle / f.jumpDur
      const arc = Math.sin(u * Math.PI)
      y = LAKE_Y + arc * f.jumpH
      pitch = (u < 0.5 ? -0.9 : 1.1) * arc
      roll = Math.sin(u * Math.PI * 2) * 0.35
      // Splash once at the start of each leap (leaving water)
      if (!f._jumpSplash && u < 0.08) {
        f._jumpSplash = true
        f._pendingSplash = { x, z, s: 0.35 }
      }
      if (u > 0.92) f._jumpSplash = false
    } else {
      y += Math.sin(a * 2.4) * 0.08
      f._jumpSplash = false
    }

    f.mesh.position.set(x, y, z)
    f.mesh.rotation.order = 'YXZ'
    f.mesh.rotation.y = a * f.dir + Math.PI / 2
    f.mesh.rotation.x = pitch
    f.mesh.rotation.z = roll
  }
}

/** Candy lake splash: expanding ring + droplet burst. Pooled, capped. */
function createLakeSplashes(parent) {
  const MAX = 5
  const DROP_N = 14
  const ringGeo = geo('jungle:splashRing', () => new THREE.TorusGeometry(1, 0.06, 6, 28))
  const dropGeo = geo('jungle:splashDrop', () => new THREE.SphereGeometry(0.09, 6, 5))
  const mistGeo = geo('jungle:splashMist', () => new THREE.SphereGeometry(0.16, 6, 5))
  const waterMat = toon('#9AE8F5', { steps: 7 })
  waterMat.transparent = true
  waterMat.opacity = 0.85
  waterMat.depthWrite = false
  const foamMat = toon('#F2FCFF', { steps: 7 })
  foamMat.transparent = true
  foamMat.opacity = 0.9
  foamMat.depthWrite = false

  const pool = []
  for (let i = 0; i < MAX; i++) {
    const g = new THREE.Group()
    g.visible = false
    const ring = new THREE.Mesh(ringGeo, waterMat.clone())
    ring.rotation.x = Math.PI / 2
    g.add(ring)
    const ring2 = new THREE.Mesh(ringGeo, foamMat.clone())
    ring2.rotation.x = Math.PI / 2
    ring2.scale.setScalar(0.7)
    g.add(ring2)
    const drops = []
    for (let d = 0; d < DROP_N; d++) {
      const drop = new THREE.Mesh(dropGeo, d % 3 === 0 ? foamMat.clone() : waterMat.clone())
      drop.visible = false
      g.add(drop)
      drops.push({
        mesh: drop,
        vx: 0, vy: 0, vz: 0,
      })
    }
    const mists = []
    for (let m = 0; m < 6; m++) {
      const mist = new THREE.Mesh(mistGeo, foamMat.clone())
      mist.visible = false
      g.add(mist)
      mists.push(mist)
    }
    parent.add(g)
    pool.push({
      g, ring, ring2, drops, mists,
      alive: false, t: 0, dur: 1.1, strength: 1,
    })
  }

  let cursor = 0

  function splash(x, z, strength = 1) {
    const dist = Math.hypot(x, z)
    if (dist > LAKE_SWIM_R + 3.5) return false
    const s = pool[cursor]
    cursor = (cursor + 1) % MAX
    s.alive = true
    s.t = 0
    s.dur = 0.85 + strength * 0.35
    s.strength = Math.min(1.6, Math.max(0.35, strength))
    s.g.visible = true
    s.g.position.set(x, LAKE_Y + 0.04, z)
    s.ring.scale.setScalar(0.15)
    s.ring2.scale.setScalar(0.1)
    s.ring.material.opacity = 0.9
    s.ring2.material.opacity = 0.85
    for (let d = 0; d < DROP_N; d++) {
      const drop = s.drops[d]
      const a = (d / DROP_N) * Math.PI * 2 + Math.random() * 0.4
      const speed = (1.8 + Math.random() * 3.2) * s.strength
      drop.mesh.visible = true
      drop.mesh.position.set(0, 0.05, 0)
      drop.mesh.scale.setScalar(0.6 + Math.random() * 0.9)
      drop.vx = Math.cos(a) * speed * (0.55 + Math.random() * 0.5)
      drop.vy = (3.5 + Math.random() * 4.5) * s.strength
      drop.vz = Math.sin(a) * speed * (0.55 + Math.random() * 0.5)
      if (drop.mesh.material.opacity != null) drop.mesh.material.opacity = 0.95
    }
    for (let m = 0; m < s.mists.length; m++) {
      const mist = s.mists[m]
      const a = Math.random() * Math.PI * 2
      const r = Math.random() * 0.4
      mist.visible = true
      mist.position.set(Math.cos(a) * r, 0.1, Math.sin(a) * r)
      mist.scale.setScalar(0.8 + Math.random())
      if (mist.material.opacity != null) mist.material.opacity = 0.55
    }
    return true
  }

  function update(dt) {
    for (const s of pool) {
      if (!s.alive) continue
      s.t += dt
      const u = Math.min(1, s.t / s.dur)
      const grow = 0.2 + u * (1.8 + s.strength * 1.2)
      s.ring.scale.setScalar(grow)
      s.ring2.scale.setScalar(grow * 0.72 + u * 0.5)
      s.ring.material.opacity = 0.85 * (1 - u)
      s.ring2.material.opacity = 0.75 * (1 - u * u)

      for (const drop of s.drops) {
        if (!drop.mesh.visible) continue
        drop.vy -= 18 * dt
        drop.mesh.position.x += drop.vx * dt
        drop.mesh.position.y += drop.vy * dt
        drop.mesh.position.z += drop.vz * dt
        if (drop.mesh.material.opacity != null) {
          drop.mesh.material.opacity = Math.max(0, 0.95 * (1 - u))
        }
        // Hit lake again → hide
        if (drop.mesh.position.y < 0) {
          drop.mesh.visible = false
        }
      }
      for (const mist of s.mists) {
        mist.position.y += dt * 1.2
        mist.scale.multiplyScalar(1 + dt * 1.8)
        if (mist.material.opacity != null) mist.material.opacity *= 1 - dt * 2.2
      }

      if (u >= 1) {
        s.alive = false
        s.g.visible = false
        for (const drop of s.drops) drop.mesh.visible = false
        for (const mist of s.mists) mist.visible = false
      }
    }
  }

  return { splash, update }
}

function createBackdrop(scene, _fx, opts = {}) {
  const group = new THREE.Group()
  scene.add(group)

  const flyers = []
  const crawlers = []
  const waterMaps = []
  const waterFxMeshes = [] // Ripple / ShoreRing / Sparkle / Foam / LilyPad
  const piranhas = []
  const lakeFx = createLakeSplashes(group)
  let authored = false
  const mobile = !!opts.mobile
  const castMode = opts.shadowCast || (mobile ? 'core' : 'heavy')

  const sceneRoot = cloneGltf(SCENE_URL)
  if (sceneRoot) {
    authored = true
    prepareImported(sceneRoot, { cast: false })
    applyBackdropShadows(sceneRoot, { castMode })
    collectMats(sceneRoot, importedMats)
    // Do NOT candy-tint backdrop — colours come from Blender GLB as-is.
    group.add(sceneRoot)

    // After glTF, multi-material insects often share local (0,0,0) under
    // different parents — group by world position so each insect wanders alone.
    sceneRoot.updateMatrixWorld(true)
    const flyerParts = new Map()
    const crawlerParts = new Map()
    const _wp = new THREE.Vector3()
    const insectKey = (obj) => {
      obj.getWorldPosition(_wp)
      return `${_wp.x.toFixed(1)},${_wp.y.toFixed(1)},${_wp.z.toFixed(1)}`
    }
    sceneRoot.traverse((obj) => {
      if (!obj.isMesh) return
      const names = matNamesOf(obj)
      const meshName = obj.name || ''
      const isFlyer = names.some((n) =>
        n === 'BeeYellow' || n === 'BeeBlack' || n === 'Wing'
        || n.startsWith('Butterfly'))
      const isCrawler = names.some((n) => n.startsWith('Caterpillar'))
      const isWater = names.some((n) =>
        n === 'Water' || n === 'WaterDeep' || n === 'WaterFoam'
        || n === 'WaterRipple' || n === 'WaterShoreRing' || n === 'WaterSpark'
        || n === 'WaterPad' || n === 'WaterPadVein')

      if (isWater) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
        const isDeep = names.some((x) => x === 'WaterDeep')
        const isSurface = names.some((x) => x === 'Water')
        for (const m of mats) {
          if (!m) continue
          if (isSurface || isDeep) {
            // Stable lake colour — no fresnel / UV scroll (those strobed blue↔grey)
            m.transparent = true
            m.depthWrite = false
            m.opacity = isDeep ? 0.58 : 0.4
            if (m.color) m.color.set(isDeep ? WATER_DEEP : WATER)
            // Kill sun specular “flashlight” that tracks shadow-follow
            if ('roughness' in m) m.roughness = 1
            if ('metalness' in m) m.metalness = 0
            if ('envMapIntensity' in m) m.envMapIntensity = 0
            if ('specularIntensity' in m) m.specularIntensity = 0
            if (m.map) {
              m.map.offset.set(0, 0)
              m.map.needsUpdate = true
            }
            m.needsUpdate = true
          }
          if (names.some((x) => x === 'WaterFoam' || x === 'WaterRipple'
            || x === 'WaterShoreRing' || x === 'WaterSpark')) {
            m.transparent = true
            m.opacity = names.some((x) => x === 'WaterSpark') ? 0.55
              : names.some((x) => x === 'WaterRipple') ? 0.4
                : names.some((x) => x === 'WaterShoreRing') ? 0.5
                  : 0.75
            m.depthWrite = false
            // Only scroll decorative FX maps, not the lake body
            if (m.map && !waterMaps.includes(m.map)) {
              m.map.wrapS = THREE.RepeatWrapping
              m.map.wrapT = THREE.RepeatWrapping
              waterMaps.push(m.map)
            }
          }
        }
        obj.castShadow = false
        obj.renderOrder = isDeep ? 1 : isSurface ? 2 : 3
        if (obj.material) {
          const ms = Array.isArray(obj.material) ? obj.material : [obj.material]
          for (const m of ms) {
            if (m) {
              m.polygonOffset = true
              m.polygonOffsetFactor = isDeep ? -1 : -2
              m.polygonOffsetUnits = 1
            }
          }
        }
      }

      if (
        meshName.startsWith('Ripple_')
        || meshName.startsWith('ShoreRing_')
        || meshName.startsWith('Sparkle_')
        || meshName.startsWith('Foam_')
        || meshName.startsWith('LilyPad_')
      ) {
        waterFxMeshes.push({
          mesh: obj,
          kind: meshName.split('_')[0],
          homeY: obj.position.y,
          homeScale: obj.scale.clone(),
          phase: Math.random() * Math.PI * 2,
          speed: 0.35 + Math.random() * 0.55,
        })
      }

      if (isFlyer) {
        const k = `f:${insectKey(obj)}`
        if (!flyerParts.has(k)) flyerParts.set(k, [])
        flyerParts.get(k).push(obj)
      } else if (isCrawler) {
        const k = `c:${insectKey(obj)}`
        if (!crawlerParts.has(k)) crawlerParts.set(k, [])
        crawlerParts.get(k).push(obj)
      }
    })
    for (const meshes of flyerParts.values()) {
      const homes = meshes.map((m) => m.position.clone())
      const names = matNamesOf(meshes[0])
      const isButterfly = names.some((n) => n.startsWith('Butterfly'))
      const heading = Math.random() * Math.PI * 2
      const dir = Math.random() < 0.5 ? 1 : -1
      flyers.push({
        meshes,
        homes,
        phase: Math.random() * Math.PI * 2,
        heading,
        dir,
        radiusX: (isButterfly ? 0.55 : 0.9) + Math.random() * 1.2,
        radiusZ: (isButterfly ? 0.45 : 0.7) + Math.random() * 1.3,
        speed: (isButterfly ? 0.55 : 0.75) + Math.random() * 0.85,
        bob: (isButterfly ? 0.28 : 0.2) + Math.random() * 0.2,
        bobRate: 1.2 + Math.random() * 1.4,
      })
    }
    for (const meshes of crawlerParts.values()) {
      const homes = meshes.map((m) => m.position.clone())
      const heading = Math.random() * Math.PI * 2
      crawlers.push({
        meshes,
        homes,
        phase: Math.random() * Math.PI * 2,
        heading,
        dir: Math.random() < 0.5 ? 1 : -1,
        speed: 0.25 + Math.random() * 0.45,
        amp: 0.35 + Math.random() * 0.55,
      })
    }

    piranhas.push(...createPiranhas(group))
  } else {
    // Procedural fallback if the authored scene failed to preload.
    const floorMat = toon('#3a6b34')
    const hillMat = toon(LEAF)
    const hillDark = toon(LEAF_DARK)
    const sea = new THREE.Mesh(geo('jungle:sea', () => new THREE.PlaneGeometry(220, 220)), floorMat)
    sea.rotation.x = -Math.PI / 2
    sea.position.y = -24
    group.add(sea)
    const lake = new THREE.Mesh(
      geo('jungle:lakeFallback', () => new THREE.CircleGeometry(LAKE_SWIM_R + 2, 48)),
      toon('#48C8E0', { steps: 7 }))
    lake.rotation.x = -Math.PI / 2
    lake.position.y = LAKE_Y
    group.add(lake)
    piranhas.push(...createPiranhas(group))
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
  }

  const motes = createDrift({
    count: authored ? 140 : 220, color: FIREFLY, size: 0.07, opacity: 0.45,
    spread: authored ? 28 : 34, top: 14, bottom: -2, speed: [-0.4, -0.12], sway: 0.7,
  })
  group.add(motes.points)

  return {
    update(dt, t) {
      motes.update(dt, t)
      lakeFx.update(dt)
      // Gentle lake swirl (both axes, slower than the old river current)
      const flow = (t * 0.035) % 1
      for (const map of waterMaps) {
        map.offset.x = flow
        map.offset.y = Math.sin(t * 0.12) * 0.08
        map.needsUpdate = true
      }
      // Idle toy water FX (not ocean sim)
      for (const fx of waterFxMeshes) {
        const a = t * fx.speed + fx.phase
        const m = fx.mesh
        if (fx.kind === 'Ripple') {
          const pulse = 1 + Math.sin(a) * 0.12
          m.scale.set(fx.homeScale.x * pulse, fx.homeScale.y, fx.homeScale.z * pulse)
          m.position.y = fx.homeY + Math.sin(a * 0.7) * 0.02
          if (m.material?.opacity != null) {
            m.material.opacity = 0.28 + (Math.sin(a) * 0.5 + 0.5) * 0.22
          }
        } else if (fx.kind === 'ShoreRing') {
          m.position.y = fx.homeY + Math.sin(a * 0.5) * 0.015
          if (m.material?.opacity != null) {
            m.material.opacity = 0.38 + Math.sin(a * 0.8) * 0.08
          }
        } else if (fx.kind === 'Sparkle') {
          m.position.y = fx.homeY + Math.abs(Math.sin(a * 1.4)) * 0.04
          if (m.material?.opacity != null) {
            m.material.opacity = 0.25 + (Math.sin(a * 2.2) * 0.5 + 0.5) * 0.45
          }
        } else if (fx.kind === 'Foam') {
          m.position.y = fx.homeY + Math.sin(a * 0.9) * 0.025
        } else if (fx.kind === 'LilyPad') {
          m.position.y = fx.homeY + Math.sin(a * 0.6) * 0.03
          m.rotation.y = a * 0.08
        }
      }
      updatePiranhas(piranhas, t)
      for (const f of piranhas) {
        if (f._pendingSplash) {
          lakeFx.splash(f._pendingSplash.x, f._pendingSplash.z, f._pendingSplash.s)
          f._pendingSplash = null
        }
      }
      for (const f of flyers) {
        const a = t * f.speed * f.dir + f.phase
        const dx = Math.cos(a + f.heading) * f.radiusX
        const dz = Math.sin(a + f.heading) * f.radiusZ
        const dy = Math.sin(a * f.bobRate) * f.bob
        const ry = a * f.dir + f.heading + Math.PI / 2
        const rz = Math.sin(a * 2.1) * 0.28
        for (let i = 0; i < f.meshes.length; i++) {
          const home = f.homes[i]
          const mesh = f.meshes[i]
          mesh.position.set(home.x + dx, home.y + dy, home.z + dz)
          mesh.rotation.y = ry
          mesh.rotation.z = rz
        }
      }
      for (const c of crawlers) {
        const a = t * c.speed * c.dir + c.phase
        const dx = Math.cos(c.heading) * Math.sin(a) * c.amp
        const dz = Math.sin(c.heading) * Math.sin(a) * c.amp
        const dy = Math.abs(Math.sin(a * 2)) * 0.04
        const ry = c.heading + (Math.cos(a) * c.dir >= 0 ? 0 : Math.PI)
        for (let i = 0; i < c.meshes.length; i++) {
          const home = c.homes[i]
          const mesh = c.meshes[i]
          mesh.position.set(home.x + dx, home.y + dy, home.z + dz)
          mesh.rotation.y = ry
        }
      }
    },
    setDay(day) {
      // Backdrop keeps Blender colours day and night; only motes dim.
      motes.material.opacity = day ? 0.1 : 0.55
    },
    splash(x, z, strength = 1) {
      return lakeFx.splash(x, z, strength)
    },
  }
}

function createProps(fx) {
  function treeProcedural(x, z, rnd, landmark) {
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

  function placeProp(url, x, z, rnd, { landmark = false, scale = 1 } = {}) {
    const authored = cloneProp(url)
    if (!authored) return null
    authored.position.set(x, 0, z)
    const s = (landmark ? 1.25 : 0.9 + rnd() * 0.2) * scale
    authored.scale.setScalar(s)
    authored.rotation.y = rnd() * Math.PI
    return authored
  }

  function tree(x, z) {
    const rnd = cellRng(x, z)
    const landmark = x === 0 && z === 0
    return placeProp(TREE_URL, x, z, rnd, { landmark }) || treeProcedural(x, z, rnd, landmark)
  }

  function vine(x, z) {
    const rnd = cellRng(x, z)
    const authored = placeProp(VINE_URL, x, z, rnd, { scale: 0.95 })
    if (authored) return authored
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
    const authored = placeProp(STUMP_URL, x, z, rnd, { scale: 1.05 })
    if (authored) return authored
    const g = new THREE.Group()
    const body = solid(new THREE.Mesh(
      geo('jungle:stump', () => new THREE.CylinderGeometry(0.28, 0.32, 0.38, 8)), toon(WOOD)))
    body.position.y = 0.19
    g.add(body)
    const top = solid(new THREE.Mesh(
      geo('jungle:stumpTop', () => new THREE.CylinderGeometry(0.26, 0.26, 0.05, 8)), toon('#8a6540')))
    top.position.y = 0.4
    g.add(top)
    g.position.set(x, 0, z)
    g.rotation.y = rnd() * Math.PI
    return g
  }

  function fern(x, z) {
    const rnd = cellRng(x, z)
    const authored = placeProp(FERN_URL, x, z, rnd, { scale: 0.85 })
    if (authored) return authored
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
  assets: ASSETS,
  // Level 0 matches L1/L2: procedural floating tiles + fence; only obstacles differ.

  surface: {
    tileA: MOSS, tileB: MOSS_DEEP,
    // Warm board greens (kit Grass C/D)
    tileC: '#9EE67A', tileD: '#52A34D',
    tileBevel: 0.11, tileBevelSegs: 3,
    tileHeightJitter: 0.022,
    base: DIRT,
    rim: [MOSS, MOSS_DEEP], rebar: '#78C068',
    grid: ['#C8E890', LEAF],
    frame: FIREFLY, fence: MOSS, post: WOOD,
    decal: '#A8D888', decalTex,
    pad: LEAF, padTex,
    debris: [WOOD, LEAF_DARK, MOSS],
  },

  accents: [FIREFLY, FLOWER],

  night: {
    sky: '#1a2e28', fogNear: 28, fogFar: 110,
    hemiSky: '#4a7060', hemiGround: '#3a4830', hemiIntensity: 1.05,
    sunColor: '#b8d0ff', sunIntensity: 1.45,
    accentIntensity: 10,
    underGlow: FIREFLY, underGlowIntensity: 8,
    spot: '#e0ffe8', spotIntensity: 9,
    bloom: 0.16, exposure: 1.02,
    post: { vignette: 0.34, contrast: 1.06, saturation: 1.03, sharpen: 0.04 },
  },

  day: {
    // Player-tuned Jul 2026 (Light panel) — keep as jungle day baseline
    sky: '#6EC8E8', fogNear: 42, fogFar: 135,
    hemiSky: '#E8F4FF', hemiGround: '#C8B890', hemiIntensity: 0.48,
    sunColor: '#FFE2A8', sunIntensity: 4,
    accentIntensity: 0.9,
    underGlow: '#8AD070', underGlowIntensity: 0.4,
    spot: '#fff6e8', spotIntensity: 2.1,
    bloom: 0.07, exposure: 0.81,
    post: { vignette: 0.9, contrast: 1.08, saturation: 1.2, sharpen: 0.04 },
  },

  createBackdrop,
  createProps,

  // Stage 9: opt-in canvas grade (UI untouched). Matches approved day look.
  post: { vignette: 0.9, contrast: 1.08, saturation: 1.2, sharpen: 0.04 },

  // Lower / wider sun so soft light covers more of lake + arena
  // Base shadow volume; quality profiles scale mapSize + extent at runtime.
  shadows: {
    mapSize: 2048,
    mapSizeMobile: 1024,
    extent: 56,
    extentY: 58,
    near: 2,
    far: 120,
    bias: -0.00035,
    normalBias: 0.035,
    radius: 5.5,
    follow: true,
    sunOffset: [22, 28, 18],
  },

  // Post extras — quality profiles keep these ON, often at half-res.
  gfx: {
    ao: true,
    aoIntensity: 0.12,
    aoIntensityNight: 0.26,
    aoRadius: 0.3,
    godray: true,
    // Soft wide wash — no visible cone/tracers on props
    godrayIntensity: 0.21,
    godraySpread: 1.45,
    fillIntensity: 0.21,
    fillIntensityNight: 0.12,
    fillColor: '#ffe8c8',
    fillColorNight: '#7a8aa0',
  },

  // Softer multi-band toon + candy palette applied at GLB preload (Fall Guys).
  materialSteps: 7,
  materialPalette: DAY_PALETTE,
  // Lake surface used by fall/splash hooks (Three.js Y after glTF).
  lakeY: LAKE_Y,
  lakeRadius: LAKE_SWIM_R + 3,
}
