import * as THREE from 'three'
import { cloneGltf, preloadGltf } from './assets/gltf.js'
import { toon, glow } from './themes/kit.js'

export const DEFAULT_HAT = 'none'

/** Catalog mirrored by the server (`server/hats.go`). */
export const HATS = [
  { id: 'none', name: 'Без шапки', swatch: '#9aa3ad', emoji: '⬜' },
  { id: 'santa', name: 'Санта', swatch: '#e22b2b', emoji: '🎅' },
  { id: 'cowboy', name: 'Ковбой', swatch: '#8b5a2b', emoji: '🤠' },
  { id: 'wizard', name: 'Волшебник', swatch: '#5b3fd4', emoji: '🧙' },
  { id: 'crown', name: 'Корона', swatch: '#f0c14a', emoji: '👑' },
  { id: 'hardhat', name: 'Каска', swatch: '#f5c518', emoji: '⛑️' },
  { id: 'halo', name: 'Нимб', swatch: '#f0c14a', emoji: '😇' },
]

/** Authored Blender GLBs. Cache-bust after re-export. */
export const HAT_ASSETS = {
  santa: '/assets/hats/santa.glb?v=3',
  cowboy: '/assets/hats/cowboy.glb?v=1',
  wizard: '/assets/hats/wizard.glb?v=4',
  crown: '/assets/hats/crown.glb?v=1',
  hardhat: '/assets/hats/hardhat.glb?v=6',
  halo: '/assets/hats/halo.glb?v=4',
}

const BUILDERS = {
  santa: buildSanta,
  cowboy: buildCowboy,
  wizard: buildWizard,
  crown: buildCrown,
  hardhat: buildHardhat,
  halo: buildHalo,
}

export function hatExists(id) {
  return HATS.some((h) => h.id === id)
}

/** Warm hat GLB cache before wardrobe / arena createHat calls. */
export async function preloadHats() {
  const urls = Object.values(HAT_ASSETS)
  if (!urls.length) return
  await preloadGltf(urls, {
    // Match wardrobe swatches / procedural fallback (glTF base colours drift).
    palette: {
      Hat_SantaRed: '#e22b2b',
      Hat_SantaFur: '#f4f0ea',
      Hat_SantaGold: '#f0c14a',
      Hat_Leather: '#8b5a2b',
      Hat_Crown: '#5c3a18',
      Hat_Band: '#2a1810',
      Hat_Buckle: '#f0c14a',
      Hat_WizardPurple: '#5b3fd4',
      Hat_WizardDeep: '#3a248a',
      Hat_WizardStar: '#ffe566',
      Hat_CrownGold: '#f0c14a',
      Hat_CrownGoldDark: '#c48a1e',
      Hat_CrownRuby: '#d91e38',
      Hat_CrownSapphire: '#3872f0',
      Hat_CrownEmerald: '#26bf59',
      Hat_HardhatYellow: '#f5c518',
      Hat_HardhatYellowDark: '#d49a0e',
      Hat_HardhatBand: '#1a1a1c',
      Hat_HardhatSticker: '#f4f4f6',
      Hat_HardhatRivet: '#8a8a90',
      Hat_HaloGold: '#f0c14a',
      Hat_HaloGoldBright: '#ffe566',
      Hat_HaloGoldDark: '#c48a1e',
    },
  })
}

export function disposeHat(root) {
  if (!root) return
  // GLB clones share geometry/materials with the template cache.
  if (root.userData?.fromGltf) return
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose()
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose())
      else o.material.dispose()
    }
  })
}

/** Build a hat mesh group. Origin sits on the cube’s top face; mesh grows +Y. */
export function createHat(hatId = DEFAULT_HAT) {
  const id = hatExists(hatId) ? hatId : DEFAULT_HAT
  if (id === 'none' || !BUILDERS[id]) {
    const empty = new THREE.Group()
    empty.userData.hatId = 'none'
    return empty
  }
  const group = BUILDERS[id]()
  group.userData.hatId = id
  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true
      o.receiveShadow = true
    }
  })
  return group
}

function wrapGltfHat(url) {
  const authored = cloneGltf(url)
  if (!authored) return null
  const g = new THREE.Group()
  // Brim underside sits ~2cm below Blender origin — lift so contact is on +Y=0.
  authored.position.y = 0.022
  // Hat shells are often viewed from below in wardrobe orbit — never cull insides.
  authored.traverse((o) => {
    if (!o.isMesh) return
    const mats = Array.isArray(o.material) ? o.material : [o.material]
    for (const m of mats) {
      if (!m) continue
      m.side = THREE.DoubleSide
      m.transparent = false
      m.opacity = 1
      m.depthWrite = true
      m.needsUpdate = true
    }
  })
  g.add(authored)
  g.userData.fromGltf = true
  return g
}

function buildSanta() {
  const authored = wrapGltfHat(HAT_ASSETS.santa)
  if (authored) return authored
  return buildSantaProcedural()
}

function buildSantaProcedural() {
  const g = new THREE.Group()
  const red = toon('#e22b2b')
  const white = toon('#f4f0ea')
  const gold = toon('#f0c14a')

  // Soft cone, tipped forward a bit
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.42, 18), red)
  body.position.set(0, 0.22, -0.02)
  body.rotation.x = -0.35
  g.add(body)

  const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.055, 10, 24), white)
  cuff.rotation.x = Math.PI / 2
  cuff.position.y = 0.02
  g.add(cuff)

  const pom = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 12), white)
  pom.position.set(0, 0.44, -0.14)
  g.add(pom)

  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.275, 0.275, 0.04, 20), gold)
  band.position.y = 0.06
  g.add(band)

  return g
}

function buildCowboy() {
  const authored = wrapGltfHat(HAT_ASSETS.cowboy)
  if (authored) return authored
  return buildCowboyProcedural()
}

function buildCowboyProcedural() {
  const g = new THREE.Group()
  const leather = toon('#8b5a2b')
  const dark = toon('#5c3a18')
  const band = toon('#2a1810')

  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.44, 0.035, 32), leather)
  brim.position.y = 0.02
  g.add(brim)

  // Slightly pinched crown
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.2, 20), dark)
  crown.position.y = 0.13
  g.add(crown)

  const crease = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.04, 0.06), leather)
  crease.position.y = 0.24
  g.add(crease)

  const ribbon = new THREE.Mesh(new THREE.CylinderGeometry(0.225, 0.225, 0.035, 20), band)
  ribbon.position.y = 0.05
  g.add(ribbon)

  return g
}

function buildWizard() {
  const authored = wrapGltfHat(HAT_ASSETS.wizard)
  if (authored) {
    authored.traverse((o) => {
      if (!o.isMesh) return
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      for (const m of mats) {
        if (m?.name === 'Hat_WizardStar') {
          m.emissive = m.emissive || new THREE.Color('#ffe566')
          m.emissive.set('#ffe566')
          m.emissiveIntensity = 0.9
          m.needsUpdate = true
        }
      }
    })
    return authored
  }
  return buildWizardProcedural()
}

function buildWizardProcedural() {
  const g = new THREE.Group()
  const purple = toon('#5b3fd4')
  const deep = toon('#3a248a')
  const star = glow('#ffe566', 0.9)

  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.36, 0.03, 28), deep)
  brim.position.y = 0.015
  g.add(brim)

  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.55, 18), purple)
  cone.position.y = 0.3
  cone.rotation.z = 0.12
  g.add(cone)

  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), star)
  tip.position.set(0.04, 0.58, 0)
  g.add(tip)

  return g
}

function buildCrown() {
  const authored = wrapGltfHat(HAT_ASSETS.crown)
  if (authored) {
    authored.traverse((o) => {
      if (!o.isMesh) return
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      for (const m of mats) {
        if (!m?.name) continue
        if (m.name === 'Hat_CrownRuby' || m.name === 'Hat_CrownSapphire' || m.name === 'Hat_CrownEmerald') {
          m.emissive = m.emissive || new THREE.Color(m.color)
          m.emissive.copy(m.color)
          m.emissiveIntensity = 0.45
          m.needsUpdate = true
        }
      }
    })
    return authored
  }
  return buildCrownProcedural()
}

function buildCrownProcedural() {
  const g = new THREE.Group()
  const gold = toon('#f0c14a')
  const dark = toon('#c48a1e')
  const ruby = glow('#d91e38', 0.45)

  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.30, 0.1, 24), gold)
  band.position.y = 0.07
  g.add(band)

  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2
    const h = 0.14 + (i % 2 === 0 ? 0.08 : 0)
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.05, h, 4), i % 2 === 0 ? gold : dark)
    spike.position.set(Math.cos(a) * 0.26, 0.12 + h * 0.45, Math.sin(a) * 0.26)
    g.add(spike)
  }

  const gem = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), ruby)
  gem.position.set(0, 0.08, 0.30)
  g.add(gem)

  return g
}

function buildHardhat() {
  const authored = wrapGltfHat(HAT_ASSETS.hardhat)
  if (authored) return authored
  return buildHardhatProcedural()
}

function buildHardhatProcedural() {
  const g = new THREE.Group()
  const yellow = toon('#f5c518')
  const dark = toon('#d49a0e')
  const band = toon('#1a1a1c')
  const sticker = toon('#f4f4f6')

  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.40, 0.025, 28), yellow)
  brim.position.y = 0.012
  brim.scale.set(1.05, 1, 1.15)
  g.add(brim)

  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.28, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), yellow)
  shell.position.y = 0.02
  shell.scale.set(1.05, 0.95, 0.95)
  g.add(shell)

  const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.36), dark)
  ridge.position.y = 0.28
  g.add(ridge)

  const sweat = new THREE.Mesh(new THREE.CylinderGeometry(0.285, 0.285, 0.03, 22), band)
  sweat.position.y = 0.05
  g.add(sweat)

  const badge = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.02), sticker)
  badge.position.set(0, 0.14, 0.24)
  badge.rotation.x = -0.35
  g.add(badge)

  return g
}

function buildHalo() {
  const authored = wrapGltfHat(HAT_ASSETS.halo)
  if (authored) {
    authored.traverse((o) => {
      if (!o.isMesh) return
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      for (const m of mats) {
        if (!m?.name) continue
        if (m.name === 'Hat_HaloGoldBright') {
          m.emissive = m.emissive || new THREE.Color('#ffe566')
          m.emissive.set('#ffe566')
          m.emissiveIntensity = 0.7
          m.needsUpdate = true
        }
      }
    })
    return authored
  }
  return buildHaloProcedural()
}

function buildHaloProcedural() {
  const g = new THREE.Group()
  const gold = toon('#f0c14a')
  const bright = glow('#ffe566', 0.7)
  const dark = toon('#c48a1e')

  const holder = new THREE.Group()
  holder.position.y = 0.16
  holder.rotation.x = -0.32
  g.add(holder)

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.026, 12, 36), gold)
  ring.rotation.x = Math.PI / 2
  holder.add(ring)

  const inner = new THREE.Mesh(new THREE.TorusGeometry(0.255, 0.008, 8, 28), bright)
  inner.rotation.x = Math.PI / 2
  holder.add(inner)

  const outer = 0.28 + 0.026 * 0.85
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.034, 4), i % 2 ? dark : bright)
    spike.position.set(Math.cos(a) * (outer + 0.015), Math.sin(a) * (outer + 0.015), 0)
    spike.rotation.z = a - Math.PI / 2
    spike.rotation.x = Math.PI / 2
    holder.add(spike)
  }

  return g
}

/** World-space hover height above the die centre (cube half-height ≈ 0.5). */
export const HAT_BASE_Y = 0.58
export const HAT_BOB_AMP = 0.045
export const HAT_BOB_SPEED = 2.6
