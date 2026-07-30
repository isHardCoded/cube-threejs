import * as THREE from 'three'
import { NEON_MAGENTA } from './palette.js'
import { cellKey, floorY } from './layouts.js'
import { createMineModel, DEFAULT_MINE_SKIN, disposeMineModel } from './mineModels.js'

const POOP_HEX = 0x8b5a2b
const POOP_BITS = [0x5c3a1a, 0x8b5e34, 0x6b4423, 0xa07040]
const MAX_FLASHES = 3
const MAX_BITS = 16

// Mines on the board (own and enemy) plus the explosions everyone sees.
export function createMines(scene, theme = null) {
  const lift = () => theme?.arenaLift || 0
  const yOf = (level) => floorY(level, lift())
  const mines = new Map() // `${level}:${cellKey}` -> { group, light, owner, level }
  const blasts = []
  let skinId = DEFAULT_MINE_SKIN

  // Shared GPU buffers — allocating Torus/Sphere/PointLight on boom hitchs the frame
  // (especially PointLight: Three recompiles lit materials when light count changes).
  const ringGeo = new THREE.TorusGeometry(0.3, 0.07, 8, 24)
  const bitGeo = new THREE.SphereGeometry(0.07, 5, 5)

  const flashPool = []
  for (let i = 0; i < MAX_FLASHES; i++) {
    const flash = new THREE.PointLight(NEON_MAGENTA, 0, 6)
    flash.visible = false
    scene.add(flash)
    flashPool.push(flash)
  }

  const freeRings = []
  const freeBits = []
  for (let i = 0; i < MAX_BITS; i++) {
    const mesh = new THREE.Mesh(
      bitGeo,
      new THREE.MeshBasicMaterial({
        color: POOP_BITS[i % POOP_BITS.length],
        transparent: true,
        opacity: 1,
        depthWrite: false,
      }),
    )
    mesh.visible = false
    scene.add(mesh)
    freeBits.push({ mesh, vx: 0, vy: 0, vz: 0 })
  }

  const key = (level, x, z) => `${level}:${cellKey(x, z)}`

  function setSkin(id) {
    skinId = id || DEFAULT_MINE_SKIN
  }

  function add(level, x, z, { skinId: sid, owner } = {}) {
    const id = key(level, x, z)
    if (mines.has(id)) return

    const look = sid || skinId
    const { group, lamp } = createMineModel(look)
    group.position.set(x, yOf(level) + 0.02, z)
    scene.add(group)
    mines.set(id, { group, lamp, level, owner: owner || null })
  }

  function remove(level, x, z) {
    const id = key(level, x, z)
    const m = mines.get(id)
    if (!m) return
    scene.remove(m.group)
    mines.delete(id)
    // dispose after the boom frame so GPU work doesn't stack with VFX
    const g = m.group
    setTimeout(() => disposeMineModel(g), 0)
  }

  function countOwned(ownerId) {
    let n = 0
    for (const m of mines.values()) {
      if (m.owner === ownerId) n += 1
    }
    return n
  }

  function takeRing() {
    const ring = freeRings.pop() || new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: NEON_MAGENTA, transparent: true, opacity: 0.9 }),
    )
    ring.visible = true
    if (!ring.parent) scene.add(ring)
    return ring
  }

  function takeFlash() {
    for (const flash of flashPool) {
      if (!flash.visible || flash.intensity <= 0.01) {
        flash.visible = true
        return flash
      }
    }
    return flashPool[0]
  }

  function takeBits(n, x, y, z) {
    const bits = []
    for (let i = 0; i < n; i++) {
      const bit = freeBits.pop()
      if (!bit) break
      bit.spawnScale = 0.65 + Math.random() * 1.1
      bit.mesh.visible = true
      bit.mesh.scale.setScalar(bit.spawnScale)
      bit.mesh.material.opacity = 1
      bit.mesh.position.set(
        x + (Math.random() - 0.5) * 0.15,
        y + 0.22,
        z + (Math.random() - 0.5) * 0.15,
      )
      bit.vx = (Math.random() - 0.5) * 5.2
      bit.vy = 1.6 + Math.random() * 3.4
      bit.vz = (Math.random() - 0.5) * 5.2
      bits.push(bit)
    }
    return bits
  }

  // the blast is the first thing a victim ever sees of the mine
  function boom(level, x, z, boomSkin = DEFAULT_MINE_SKIN) {
    remove(level, x, z)
    const isPoop = boomSkin === 'poop'
    const tint = isPoop ? POOP_HEX : NEON_MAGENTA
    const y = yOf(level)

    const ring = takeRing()
    ring.material.color.set(tint)
    ring.material.opacity = 0.9
    ring.scale.setScalar(1)
    ring.rotation.x = Math.PI / 2
    ring.position.set(x, y + 0.1, z)

    const flash = takeFlash()
    flash.color.set(tint)
    flash.intensity = isPoop ? 10 : 16
    flash.position.set(x, y + 0.4, z)

    const bits = isPoop ? takeBits(MAX_BITS, x, y, z) : []
    blasts.push({ ring, flash, bits, t: 0, isPoop, peak: isPoop ? 10 : 16 })
  }

  function releaseBlast(b) {
    b.ring.visible = false
    b.ring.material.opacity = 0
    freeRings.push(b.ring)

    b.flash.intensity = 0
    b.flash.visible = false

    for (const bit of b.bits) {
      bit.mesh.visible = false
      bit.mesh.material.opacity = 0
      freeBits.push(bit)
    }
  }

  function clear() {
    for (const id of [...mines.keys()]) {
      const m = mines.get(id)
      scene.remove(m.group)
      disposeMineModel(m.group)
      mines.delete(id)
    }
    for (let i = blasts.length - 1; i >= 0; i--) {
      releaseBlast(blasts[i])
      blasts.splice(i, 1)
    }
  }

  function update(dt, t, visibleUpTo) {
    for (const m of mines.values()) {
      m.group.visible = m.level <= visibleUpTo
      if (m.lamp?.material) {
        m.lamp.material.emissiveIntensity = 0.4 + Math.abs(Math.sin(t * 2.4)) * 0.7
      }
    }

    for (let i = blasts.length - 1; i >= 0; i--) {
      const b = blasts[i]
      b.t += dt
      const dur = b.isPoop ? 0.7 : 0.45
      const k = Math.min(b.t / dur, 1)
      b.ring.scale.setScalar(1 + k * 3.4)
      b.ring.material.opacity = 0.9 * (1 - k)
      b.flash.intensity = b.peak * (1 - k)
      for (const bit of b.bits) {
        bit.vy -= 14 * dt
        bit.mesh.position.x += bit.vx * dt
        bit.mesh.position.y += bit.vy * dt
        bit.mesh.position.z += bit.vz * dt
        bit.mesh.material.opacity = Math.max(0, 1 - k)
        bit.mesh.scale.setScalar(bit.spawnScale * (1 - k * 0.45))
      }
      if (k >= 1) {
        releaseBlast(b)
        blasts.splice(i, 1)
      }
    }
  }

  const count = () => mines.size

  return { add, remove, boom, clear, count, countOwned, update, setSkin }
}
