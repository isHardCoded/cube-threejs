import * as THREE from 'three'
import { createSectorKit, laneToX } from './sectors.js'

const BATTLE_HALF = 4 // classic 9×9

/**
 * Track + battle floor from jungle sector tiles.
 * Runner corridor: 3 cells wide (x = -1,0,1), scrolling along +Z.
 * Battle: classic square grid [-4..4]².
 */
export function createTrackView(scene, theme) {
  const kit = createSectorKit(theme)
  const lift = theme?.arenaLift ?? 16
  const root = new THREE.Group()
  root.name = 'duelrun-track'
  root.position.y = lift
  scene.add(root)
  const pool = new Map()
  /** @type {Map<string, { gap?: boolean, solid?: boolean, jumpable?: boolean, slideable?: boolean }>} */
  const cells = new Map()
  const crumbled = new Set()

  const battleArena = new THREE.Group()
  battleArena.name = 'duelrun-battle'
  battleArena.visible = false
  battleArena.position.set(0, lift, 0)
  scene.add(battleArena)
  buildBattleFloor(battleArena, kit)

  function cellKey(x, z) {
    return `${x},${z}`
  }

  function markCell(x, z, flags) {
    const k = cellKey(x, z)
    const cur = cells.get(k) || {}
    cells.set(k, { ...cur, ...flags })
  }

  function buildSegment(seg) {
    const g = new THREE.Group()
    const start = Math.round(seg.startZ)
    const len = Math.max(1, Math.round(seg.length))
    g.userData.segId = seg.id
    g.userData.startZ = start
    g.userData.length = len

    for (let zi = 0; zi < len; zi++) {
      const z = start + zi
      for (let lane = 0; lane < 3; lane++) {
        const x = laneToX(lane)
        const laneBit = 1 << lane
        let missing = false
        let hazard = false
        let blocker = false
        let tall = false
        let pit = false
        let jumpable = false
        let slideable = false
        let obsType = null
        for (const o of seg.obstacles || []) {
          if ((o.laneMask & laneBit) === 0) continue
          // Exact local cell — must match server int(round(o.z))
          if (Math.round(Number(o.z)) !== zi) continue
          const t = o.type || o.collisionType
          obsType = o.type || obsType
          if (t === 'pit' || t === 'missing_tile' || t === 'abyss' || o.collisionType === 'gap') {
            missing = true
            pit = true
          } else if (o.collisionType === 'hazard' || t === 'lava' || t === 'electric' || t === 'piranha_water') {
            hazard = true
            blocker = true
          } else if (
            o.collisionType === 'jumpable'
            || t === 'low_barrier' || t === 'rock' || t === 'crate' || t === 'spikes'
            || t === 'crumble' || t === 'moving_platform'
            || t === 'swing_hammer' || t === 'spin_beam' || t === 'moving_block' || t === 'falling_object'
          ) {
            blocker = true
            jumpable = true
          } else if (o.collisionType === 'slideable' || t === 'high_barrier') {
            blocker = true
            tall = true
            slideable = true
          } else {
            blocker = true
            tall = t === 'wall'
          }
        }
        if (missing) markCell(x, z, { gap: true })
        else if (jumpable) markCell(x, z, { jumpable: true, solid: true })
        else if (slideable) markCell(x, z, { slideable: true, solid: true })
        else if (blocker) markCell(x, z, { solid: true })
        else markCell(x, z, { floor: true })

        const before = g.children.length
        kit.addCell(g, x, z, { missing, hazard, blocker, tall, pit, obsType })
        for (let i = before; i < g.children.length; i++) {
          g.children[i].userData.cellX = x
          g.children[i].userData.cellZ = z
        }
      }
    }

    kit.addSideRails(g, start, start + len - 1)

    for (const pk of seg.pickups || []) {
      kit.addPickup(g, laneToX(pk.lane), start + Math.round(pk.z), pk.id)
    }
    return g
  }

  function upsert(seg) {
    let mesh = pool.get(seg.id)
    if (mesh) {
      // Clear old cell marks for this segment span
      const start = Math.round(seg.startZ)
      const len = Math.max(1, Math.round(seg.length))
      for (let zi = 0; zi < len; zi++) {
        for (let x = -1; x <= 1; x++) cells.delete(cellKey(x, start + zi))
      }
      root.remove(mesh)
      disposeObject(mesh)
    }
    mesh = buildSegment(seg)
    pool.set(seg.id, mesh)
    root.add(mesh)
  }

  function despawn(ids, protectZ = null) {
    for (const id of ids || []) {
      const mesh = pool.get(id)
      if (!mesh) continue
      const start = mesh.userData.startZ | 0
      const len = mesh.userData.length | 0
      const end = start + len
      // Never strip mesh still under/near the local cube (server used to cut by leader).
      if (protectZ != null && end > protectZ - 12) continue
      for (let zi = 0; zi < len; zi++) {
        for (let x = -1; x <= 1; x++) cells.delete(cellKey(x, start + zi))
      }
      root.remove(mesh)
      disposeObject(mesh)
      pool.delete(id)
    }
  }

  function clear() {
    for (const id of [...pool.keys()]) despawn([id])
    cells.clear()
    crumbled.clear()
  }

  const falling = []

  function crumble(cellList) {
    const want = new Set((cellList || []).map((c) => `${c.x},${c.z}`))
    if (!want.size) return
    for (const k of want) {
      crumbled.add(k)
      cells.set(k, { gap: true })
    }
    root.traverse((obj) => {
      if (obj.userData?.cellX == null) return
      const key = `${obj.userData.cellX},${obj.userData.cellZ}`
      if (!want.has(key) || obj.userData.crumbling) return
      obj.userData.crumbling = true
      const delay = Math.max(0, (obj.userData.cellZ || 0) % 3) * 0.04
      falling.push({
        obj,
        vy: 0.35 + Math.random() * 0.5,
        rx: (Math.random() - 0.5) * 3,
        rz: (Math.random() - 0.5) * 3,
        t: -delay,
      })
    })
  }

  /** Client mirror of server walk block (not jump leap). */
  function walkBlocked(x, z) {
    if (z < 0) return true
    if (x < -1 || x > 1) return false // sides are fall, not bump — caller handles
    const k = cellKey(x, z)
    if (crumbled.has(k)) return true
    const c = cells.get(k)
    if (!c) return false
    if (c.gap) return true
    if (c.solid) return true
    return false
  }

  function setBattleMode(on, focusZ = 0) {
    battleArena.visible = !!on
    root.visible = !on
    if (on) {
      battleArena.position.set(0, lift, Math.round(focusZ))
    }
  }

  function update(dt, t) {
    root.traverse((obj) => {
      if (obj.userData.pickup) {
        obj.rotation.y += dt * 2
        obj.position.y = 0.75 + Math.sin(t * 4 + obj.position.z) * 0.1
      }
    })
    for (let i = falling.length - 1; i >= 0; i--) {
      const f = falling[i]
      f.t += dt
      f.vy += dt * 14
      f.obj.position.y -= f.vy * dt
      f.obj.rotation.x += f.rx * dt
      f.obj.rotation.z += f.rz * dt
      if (f.t > 1.4) {
        f.obj.visible = false
        falling.splice(i, 1)
      }
    }
  }

  function laneX(lane) {
    return laneToX(lane)
  }

  function removePickup(pickupId) {
    if (!pickupId) return
    root.traverse((obj) => {
      if (!obj.userData?.pickup) return
      if (obj.userData.pickupId !== pickupId) return
      obj.visible = false
      obj.userData.pickup = false
      if (obj.parent) obj.parent.remove(obj)
    })
  }

  return {
    upsert, despawn, clear, setBattleMode, update, laneX, crumble, walkBlocked,
    removePickup, lift, LANE_W: 1, BATTLE_HALF,
  }
}

function buildBattleFloor(group, kit) {
  for (let x = -BATTLE_HALF; x <= BATTLE_HALF; x++) {
    for (let z = -BATTLE_HALF; z <= BATTLE_HALF; z++) {
      kit.addCell(group, x, z, {})
    }
  }
  // Soft rim posts like readable arena edge
  const postMat = new THREE.MeshBasicMaterial({ color: 0x78c068 })
  const edge = BATTLE_HALF + 0.55
  for (const [x, z] of [[0, -edge], [0, edge], [-edge, 0], [edge, 0]]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(
      Math.abs(x) < 0.1 ? BATTLE_HALF * 2 + 1.2 : 0.08,
      0.08,
      Math.abs(z) < 0.1 ? BATTLE_HALF * 2 + 1.2 : 0.08,
    ), postMat)
    bar.position.set(x, 0.05, z)
    group.add(bar)
  }
}

function disposeObject(obj) {
  obj.traverse((c) => {
    // shared geos from kit — only dispose unique
    if (c.userData?.pickup && c.geometry) c.geometry.dispose()
  })
}
