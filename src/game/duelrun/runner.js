import * as THREE from 'three'

/**
 * Client prediction for manual WASD corridor movement.
 * Classic input.js sends move/jump/dash; we mainly sync from server.
 */
export function createDuelRunner({ send, fsm, track }) {
  const local = {
    x: 0,
    z: 4,
    lane: 1,
    laneF: 1,
    distance: 4,
    speed: 0,
    jumping: false,
    battleX: 0,
    battleZ: -2,
  }

  const others = new Map()

  function applyServerPlayers(players, myId) {
    others.clear()
    for (const p of players || []) {
      if (p.id === myId) {
        local.x = p.x ?? local.x
        local.z = p.z ?? local.z
        local.lane = p.lane ?? (local.x + 1)
        local.laneF = local.lane
        local.distance = p.distance ?? local.z
        local.jumping = !!p.jumping
        if (fsm.state.matchState === 'BATTLE_ACTIVE' || fsm.state.matchState === 'BATTLE_INTRO') {
          if (p.x != null) local.battleX = p.x
          if (p.z != null) local.battleZ = p.z
        }
        if (p.bx != null) local.battleX = p.bx
        if (p.bz != null) local.battleZ = p.bz
      } else {
        others.set(p.id, {
          x: p.x ?? 0,
          z: p.z ?? 0,
          lane: p.lane ?? 1,
          distance: p.distance ?? p.z ?? 0,
          battleX: p.bx ?? p.x ?? 0,
          battleZ: p.bz ?? p.z ?? 2,
          name: p.name,
        })
      }
    }
  }

  function onKey() {
    // Classic createInput owns WASD / Space / dash — no duplicate keys.
  }

  function update() {
    // Positions come from server; no auto-run.
  }

  function playerWorldPos() {
    const yBase = typeof track?.lift === 'number' ? track.lift : 16
    const y = yBase + (local.jumping ? 1.15 : 0.55)
    return new THREE.Vector3(local.x, y, local.z)
  }

  function battlePos() {
    const originZ = track._battleOriginZ || 0
    const yBase = typeof track?.lift === 'number' ? track.lift : 16
    return new THREE.Vector3(local.battleX, yBase + 0.55, originZ + local.battleZ)
  }

  function otherWorldPositions(inBattle) {
    const out = []
    const originZ = track._battleOriginZ || 0
    const yBase = typeof track?.lift === 'number' ? track.lift : 16
    for (const [id, o] of others) {
      if (inBattle) {
        out.push({ id, pos: new THREE.Vector3(o.battleX, yBase + 0.55, originZ + o.battleZ) })
      } else {
        out.push({ id, pos: new THREE.Vector3(o.x, yBase + 0.55, o.z) })
      }
    }
    return out
  }

  return {
    local, others, applyServerPlayers, onKey, update,
    playerWorldPos, battlePos, otherWorldPositions,
    sendAction: () => {},
  }
}
