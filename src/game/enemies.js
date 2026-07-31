import * as THREE from 'three'
import { createDie, quatForOrient, rollOrient } from './dice.js'
import { floorY } from './layouts.js'

const FALL_TIME = 0.7
const MOVE_TIME = 0.18
const KNOCK_TIME = 0.16
const DIE_TIME = 0.35

const KIND_SKIN = {
  small: { id: 'mob-small', body: '#e85d5d', pip: '#2a1010', metalness: 0.08, roughness: 0.55 },
  medium: { id: 'mob-medium', body: '#d94848', pip: '#2a1010', metalness: 0.08, roughness: 0.55 },
  large: { id: 'mob-large', body: '#b83030', pip: '#1a0808', metalness: 0.1, roughness: 0.5 },
}

// Hostile dice for PvE Arena — numbered faces, roll as they chase.
export function createEnemies(env) {
  const { scene } = env
  const enemies = new Map()
  const lift = () => env.theme?.arenaLift || 0
  const baseY = (scale) => floorY(0, lift()) + 0.5 * scale

  function spawn(data) {
    if (!data?.id) return
    remove(data.id)

    const scale = data.scale || 0.7
    const skin = KIND_SKIN[data.kind] || KIND_SKIN.medium
    const { group, bodyMat } = createDie(skin)
    group.scale.setScalar(scale)
    group.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true
        o.receiveShadow = true
      }
    })

    const orient = {
      top: data.top ?? 1,
      east: data.east ?? 3,
      south: data.south ?? 2,
    }
    const q = quatForOrient(orient)
    if (q) group.quaternion.copy(q)

    const y0 = data.fall ? baseY(scale) + 10 : baseY(scale)
    group.position.set(data.x, y0, data.z)
    scene.add(group)

    const e = {
      id: data.id,
      kind: data.kind,
      scale,
      x: data.x,
      z: data.z,
      hp: data.hp,
      maxHp: data.maxHp || data.hp,
      group,
      bodyMat,
      orient,
      fall: data.fall ? { t: 0 } : null,
      move: null,
      die: null,
      hitFlash: 0,
    }
    enemies.set(e.id, e)
  }

  function move(id, x, z, orient, dx = 0, dz = 0, opts = {}) {
    const e = enemies.get(id)
    if (!e || e.die) return
    const fromQ = e.group.quaternion.clone()
    if (orient) {
      e.orient = { top: orient.top, east: orient.east, south: orient.south }
    } else if (dx || dz) {
      e.orient = rollOrient(e.orient, dx, dz)
    }
    const toQ = quatForOrient(e.orient) || fromQ.clone()
    e.move = {
      t: 0,
      fromX: e.group.position.x,
      fromZ: e.group.position.z,
      toX: x,
      toZ: z,
      fromQ,
      toQ,
      knock: !!opts.knock,
      hop: opts.knock ? 0.28 : 0.12,
    }
    e.x = x
    e.z = z
  }

  function setHp(id, hp) {
    const e = enemies.get(id)
    if (!e) return
    e.hp = hp
    e.hitFlash = 0.18
  }

  function setOrient(id, orient) {
    const e = enemies.get(id)
    if (!e || !orient) return
    e.orient = { top: orient.top, east: orient.east, south: orient.south }
    const q = quatForOrient(e.orient)
    if (q && !e.move) e.group.quaternion.copy(q)
  }

  function remove(id) {
    const e = enemies.get(id)
    if (!e) return
    scene.remove(e.group)
    e.bodyMat?.dispose?.()
    enemies.delete(id)
  }

  function kill(id) {
    const e = enemies.get(id)
    if (!e) return
    e.die = { t: 0 }
    e.move = null
    e.fall = null
  }

  function clear() {
    for (const id of [...enemies.keys()]) remove(id)
  }

  function update(dt) {
    for (const e of enemies.values()) {
      if (e.hitFlash > 0) {
        e.hitFlash -= dt
        const skin = KIND_SKIN[e.kind] || KIND_SKIN.medium
        e.bodyMat.color.set(e.hitFlash > 0 ? '#ffffff' : skin.body)
      }

      const yBase = baseY(e.scale)

      if (e.die) {
        e.die.t += dt
        const k = Math.min(1, e.die.t / DIE_TIME)
        e.group.scale.setScalar(e.scale * (1 - k))
        e.group.position.y = yBase + k * 0.8
        e.bodyMat.opacity = 1 - k
        e.bodyMat.transparent = true
        if (k >= 1) {
          remove(e.id)
          continue
        }
      } else if (e.fall) {
        e.fall.t += dt
        const k = Math.min(1, e.fall.t / FALL_TIME)
        const s = k * k * (3 - 2 * k)
        e.group.position.y = yBase + (1 - s) * 10
        if (k >= 1) e.fall = null
      } else if (e.move) {
        e.move.t += dt
        const dur = e.move.knock ? KNOCK_TIME : MOVE_TIME
        const k = Math.min(1, e.move.t / dur)
        const s = k * k * (3 - 2 * k)
        e.group.position.x = e.move.fromX + (e.move.toX - e.move.fromX) * s
        e.group.position.z = e.move.fromZ + (e.move.toZ - e.move.fromZ) * s
        e.group.position.y = yBase + Math.sin(s * Math.PI) * (e.move.hop || 0.12) * e.scale
        e.group.quaternion.slerpQuaternions(e.move.fromQ, e.move.toQ, s)
        if (k >= 1) {
          e.group.position.set(e.move.toX, yBase, e.move.toZ)
          e.group.quaternion.copy(e.move.toQ)
          e.move = null
        }
      } else {
        e.group.position.y = yBase
      }
    }
  }

  return { spawn, move, setHp, setOrient, kill, remove, clear, update, enemies }
}
