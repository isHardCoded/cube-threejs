import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { glow, toon } from './themes/kit.js'

const ARM_COLOR = '#ff3b3b'

export const DEFAULT_MINE_SKIN = 'classic'

function disposeObject(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose()
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose())
      else o.material.dispose()
    }
  })
}

function buildClassic() {
  const group = new THREE.Group()
  const metal = toon('#3a3232')
  const metalDark = toon('#2a2424')
  const rim = toon('#55505a')

  // Main pressure plate
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.07, 28), metal)
  disc.position.y = 0.04
  group.add(disc)

  // Beveled outer ring
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.035, 10, 36), rim)
  ring.rotation.x = Math.PI / 2
  ring.position.y = 0.07
  group.add(ring)

  // Inner groove
  const groove = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.018, 8, 28), metalDark)
  groove.rotation.x = Math.PI / 2
  groove.position.y = 0.075
  group.add(groove)

  // Cross braces
  for (const rot of [0, Math.PI / 2]) {
    const bar = new THREE.Mesh(new RoundedBoxGeometry(0.52, 0.03, 0.06, 2, 0.01), metalDark)
    bar.position.y = 0.08
    bar.rotation.y = rot
    group.add(bar)
  }

  // Bolts around the rim
  const boltGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.04, 8)
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    const bolt = new THREE.Mesh(boltGeo, rim)
    bolt.position.set(Math.cos(a) * 0.28, 0.09, Math.sin(a) * 0.28)
    group.add(bolt)
  }

  // Fuse post
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.1, 12), metalDark)
  post.position.y = 0.14
  group.add(post)

  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.065, 14, 14), glow(ARM_COLOR, 1.1))
  lamp.position.y = 0.22
  group.add(lamp)

  // Tiny antenna tip
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.05, 8), toon('#c0c0c8'))
  tip.position.y = 0.29
  group.add(tip)

  return { group, lamp }
}

function buildPoop() {
  const group = new THREE.Group()
  const dark = toon('#6b3f1f')
  const mid = toon('#8b5a2b')
  const light = toon('#a86f38')
  const shine = toon('#c4894a')

  // Soft stacked swirls — offset like soft-serve
  const layers = [
    { y: 0.1, r: 0.24, h: 0.55, sx: 1.2, mat: dark, ox: 0, oz: 0 },
    { y: 0.22, r: 0.2, h: 0.62, sx: 1.1, mat: mid, ox: 0.03, oz: -0.02 },
    { y: 0.34, r: 0.15, h: 0.7, sx: 1.05, mat: light, ox: -0.02, oz: 0.03 },
    { y: 0.44, r: 0.1, h: 0.75, sx: 1, mat: shine, ox: 0.025, oz: 0.01 },
  ]

  for (const L of layers) {
    const blob = new THREE.Mesh(new THREE.SphereGeometry(L.r, 20, 16), L.mat)
    blob.scale.set(L.sx, L.h, L.sx)
    blob.position.set(L.ox, L.y, L.oz)
    group.add(blob)
  }

  // Tiny drip on the side
  const drip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), mid)
  drip.scale.set(0.8, 1.4, 0.8)
  drip.position.set(0.18, 0.16, 0.08)
  group.add(drip)

  // Specular highlight blob
  const hl = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), shine)
  hl.position.set(-0.1, 0.36, 0.12)
  group.add(hl)

  // Arming spark / fly
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 10), glow('#ff8a3d', 0.95))
  lamp.position.set(0.06, 0.54, 0.02)
  group.add(lamp)

  return { group, lamp }
}

const BUILDERS = {
  classic: buildClassic,
  poop: buildPoop,
}

/** Build a mine cosmetic mesh. Same factory for the arena and the wardrobe. */
export function createMineModel(skinId = DEFAULT_MINE_SKIN) {
  const build = BUILDERS[skinId] || buildClassic
  return build()
}

export function disposeMineModel(group) {
  if (group) disposeObject(group)
}
