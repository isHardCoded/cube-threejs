import * as THREE from 'three'
import { NEON_MAGENTA } from './palette.js'
import { glow, toon } from './themes/kit.js'
import { cellKey, levelY } from './layouts.js'

const ARM_COLOR = '#ff3b3b'

// Mines the local player laid, plus the explosions everyone sees. The server
// only tells you about your own mines, so an enemy trap has nothing to draw
// until it goes off.
export function createMines(scene) {
  const mines = new Map() // `${level}:${cellKey}` -> { group, light }
  const blasts = []

  const key = (level, x, z) => `${level}:${cellKey(x, z)}`

  function add(level, x, z) {
    const id = key(level, x, z)
    if (mines.has(id)) return

    const group = new THREE.Group()
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.34, 0.06, 18),
      toon('#4a3a3a')
    )
    disc.position.y = 0.03
    group.add(disc)

    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 10), glow(ARM_COLOR, 0.9))
    lamp.position.y = 0.1
    group.add(lamp)

    group.position.set(x, levelY(level) + 0.02, z)
    scene.add(group)
    mines.set(id, { group, lamp, level })
  }

  function remove(level, x, z) {
    const id = key(level, x, z)
    const m = mines.get(id)
    if (!m) return
    scene.remove(m.group)
    mines.delete(id)
  }

  // the blast is the first thing a victim ever sees of the mine
  function boom(level, x, z) {
    remove(level, x, z)
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.3, 0.07, 8, 24),
      new THREE.MeshBasicMaterial({ color: NEON_MAGENTA, transparent: true, opacity: 0.9 })
    )
    ring.rotation.x = Math.PI / 2
    ring.position.set(x, levelY(level) + 0.1, z)
    scene.add(ring)

    const flash = new THREE.PointLight(NEON_MAGENTA, 16, 6)
    flash.position.set(x, levelY(level) + 0.4, z)
    scene.add(flash)

    blasts.push({ ring, flash, t: 0 })
  }

  function clear() {
    for (const id of [...mines.keys()]) {
      scene.remove(mines.get(id).group)
      mines.delete(id)
    }
  }

  function update(dt, t, visibleUpTo) {
    for (const m of mines.values()) {
      m.group.visible = m.level <= visibleUpTo
      // slow blink so an armed cell reads at a glance without lighting the arena
      m.lamp.material.emissiveIntensity = 0.4 + Math.abs(Math.sin(t * 2.4)) * 0.7
    }

    for (let i = blasts.length - 1; i >= 0; i--) {
      const b = blasts[i]
      b.t += dt
      const k = Math.min(b.t / 0.45, 1)
      b.ring.scale.setScalar(1 + k * 3.4)
      b.ring.material.opacity = 0.9 * (1 - k)
      b.flash.intensity = 16 * (1 - k)
      if (k >= 1) {
        scene.remove(b.ring)
        scene.remove(b.flash)
        b.ring.geometry.dispose()
        b.ring.material.dispose()
        blasts.splice(i, 1)
      }
    }
  }

  // the meshes are the only local record of my own mines, so the HUD counts them
  const count = () => mines.size

  return { add, remove, boom, clear, count, update }
}
