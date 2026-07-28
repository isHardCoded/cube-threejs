import * as THREE from 'three'
import { NEON_YELLOW } from './palette.js'
import { DEFAULT_SKIN, createDie, quatForOrient, rollOrient, yAxis } from './dice.js'
import { inArena, levelY } from './layouts.js'
import { createNameplate, drawNameplate } from './sprites.js'
import { sfx } from './sfx.js'
import { haptic, hapticHeavy } from './telegram.js'

const ROLL_TIME = 0.13
const DASH_TIME = 0.10
const JUMP_TIME = 0.36
const smoothstep = (t) => t * t * (3 - 2 * t)

// Player registry: dice meshes, server-driven animations and local prediction.
export function createPlayers(env, arena) {
  const { scene } = env
  const players = new Map()
  const state = { myId: null, skins: new Map() }

  // The catalog arrives with the welcome message; every client renders a given
  // skinId identically because nobody keeps a local copy of the colors.
  function setSkins(list) {
    state.skins = new Map((list || []).map((s) => [s.id, s]))
  }
  const skinFor = (id) => state.skins.get(id) || DEFAULT_SKIN

  // Cubes used to be color-coded (mine yellow, others hashed). Skins took that
  // away, so a thin ring outlines which cube is mine — dim enough that bloom
  // doesn't turn it into a glowing puddle.
  const marker = new THREE.Mesh(
    new THREE.TorusGeometry(0.52, 0.022, 6, 32),
    new THREE.MeshBasicMaterial({
      color: NEON_YELLOW, transparent: true, opacity: 0.4, depthWrite: false,
    })
  )
  marker.rotation.x = Math.PI / 2
  marker.visible = false
  scene.add(marker)

  // cooldown timers for the local player, in performance.now() time
  const local = {
    dashCooldownMs: 5000, dashReadyAt: 0,
    jumpCooldownMs: 1200, jumpReadyAt: 0,
    mineCooldownMs: 8000, mineReadyAt: 0, maxMines: 2,
    maxLives: 5,
  }

  // Nameplate is nickname + HP (+ dash for me). Lives live only in the HUD strip.
  function paintPlate(p, dashFrac = null) {
    drawNameplate(p.bar, p.hp, dashFrac)
  }

  // FIFO of cells my unconfirmed predicted moves should land on.
  // The array identity never changes so other modules can hold on to it.
  const predictions = []

  const me = () => players.get(state.myId)

  // spectators and corpses take no input: the server would drop it anyway
  function canPlay() {
    const p = me()
    return !!p && !p.dead && !p.spectating
  }

  function addPlayer(data) {
    if (players.has(data.id)) return players.get(data.id)
    const isMe = data.id === state.myId
    const skin = skinFor(data.skinId)
    const { group, bodyMat } = createDie(skin)
    // a soft bounce light in the cube's own colour, so it feels like a lit toy
    // sitting on the floor rather than a sticker pasted onto the scene
    const glow = new THREE.PointLight(skin.body, isMe ? 1.8 : 1.4, 3.5)
    glow.position.y = 0.2
    group.add(glow)
    group.position.set(data.x, levelY(data.level || 0) + 0.5, data.z)
    const q = quatForOrient(data)
    if (q) group.quaternion.copy(q)
    scene.add(group)

    const bar = createNameplate(data.name, isMe)
    scene.add(bar.sprite)

    const p = {
      id: data.id, group, bodyMat, bar,
      cell: { x: data.x, z: data.z },
      confirmedCell: { x: data.x, z: data.z },
      level: data.level || 0,
      hp: data.hp, lives: data.lives ?? null, dead: data.dead || false,
      spectating: data.spectating || false, // out of the round, waiting for the next
      orient: { top: data.top, east: data.east, south: data.south },
      confirmedOrient: { top: data.top, east: data.east, south: data.south },
      queue: [], anim: null,
      flash: 0, deathAnim: null, spawnAnim: null,
      pendingDeath: null,           // death animation deferred until move anims finish
      gone: data.dead || data.spectating || false, // fully hidden
    }
    paintPlate(p)
    players.set(data.id, p)
    return p
  }

  function removePlayer(id) {
    const p = players.get(id)
    if (!p) return
    scene.remove(p.group)
    scene.remove(p.bar.sprite)
    players.delete(id)
  }

  function clear() {
    for (const id of [...players.keys()]) removePlayer(id)
    state.myId = null
    predictions.length = 0
  }

  function startDeathAnim(p, mode) {
    p.deathAnim = { t: 0, mode, vy: 2 }
    sfx.death()
  }

  // --- prediction ----------------------------------------------------------

  function syncConfirmed(p, data) {
    p.confirmedCell = { x: data.x, z: data.z }
    p.confirmedOrient = { top: data.top, east: data.east, south: data.south }
    // while predictions are in flight my orient chain is ahead of the server:
    // don't rewind it with the confirmation of an older move
    if (p.id !== state.myId || predictions.length === 0) p.orient = { ...p.confirmedOrient }
  }

  function rollbackPrediction(p) {
    if (!p?.confirmedCell) return
    predictions.length = 0
    p.queue = p.queue.filter((m) => !m.predicted)
    p.anim = null
    p.cell = { ...p.confirmedCell }
    p.orient = { ...p.confirmedOrient }
    p.group.position.set(p.cell.x, levelY(p.level) + 0.5, p.cell.z)
    p.group.scale.set(1, 1, 1)
    const q = quatForOrient(p.orient)
    if (q) p.group.quaternion.copy(q)
  }

  function playerAtCell(l, x, z) {
    for (const p of players.values()) {
      if (p.id !== state.myId && !p.dead && !p.gone && p.level === l && p.cell.x === x && p.cell.z === z) return p
    }
    return null
  }

  // logical position for chaining predictions: ahead of the animation cell,
  // which only advances when each roll animation actually finishes
  function predictOrigin(p) {
    return predictions.length > 0 ? predictions[predictions.length - 1] : p.confirmedCell
  }

  // returns false when the move must not even be sent (wall/obstacle)
  function predictRoll(dx, dz) {
    const p = me()
    if (!p || p.dead || p.gone) return true
    const l = p.level
    const o = predictOrigin(p)
    const nx = o.x + dx
    const nz = o.z + dz
    if (!inArena(nx, nz) || arena.isBlocked(l, nx, nz)) return false
    // an occupied cell means attack: send the move but keep the cube in place
    if (playerAtCell(l, nx, nz)) return true
    const next = rollOrient(p.orient || { top: 1, east: 3, south: 2 }, dx, dz)
    predictions.push({ x: nx, z: nz })
    p.orient = next
    enqueueMove(p, {
      predicted: true,
      p: { id: p.id, level: l, x: nx, z: nz, ...next },
    })
    return true
  }

  // walks up to two cells with the same stop rules as the server
  function predictDash(dx, dz) {
    const p = me()
    if (!p || p.dead || p.gone) return
    const l = p.level
    let { x, z } = predictOrigin(p)
    let steps = 0
    for (let i = 0; i < 2; i++) {
      const nx = x + dx
      const nz = z + dz
      if (!inArena(nx, nz) || arena.isBlocked(l, nx, nz) || playerAtCell(l, nx, nz)) break
      x = nx
      z = nz
      steps++
      if (arena.isHole(l, nx, nz) || arena.isTramp(l, nx, nz)) break
    }
    if (steps === 0) return
    predictions.push({ x, z })
    enqueueMove(p, {
      predicted: true, dash: true,
      p: { id: p.id, level: l, x, z, ...p.orient },
    })
  }

  // --- movement animation (server events drive everything) -----------------

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
      const plat = arena.platforms[fromLevel]
      if (plat) plat.tramp.bounce = 1
      sfx.launch()
      if (p.id === state.myId) hapticHeavy()
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
      if (p.id === state.myId) haptic()
      startNextAnim(p)
      if (!p.anim && p.pendingDeath) {
        startDeathAnim(p, p.pendingDeath)
        p.pendingDeath = null
      }
    }
  }

  function update(dt, visibleUpTo) {
    for (const p of players.values()) {
      updatePlayerAnim(p, dt)

      // cubes on hidden (upper) platforms are hidden along with them
      p.group.visible = !p.gone && p.level <= visibleUpTo

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

      // nameplate floats above the die (hidden while dead)
      p.bar.sprite.visible = !p.dead && p.group.visible
      p.bar.sprite.position.set(p.group.position.x, p.group.position.y + 1.15, p.group.position.z)
    }

    const mine = me()

    // the ring rides under my cube, on the ground of its platform
    marker.visible = !!mine && !mine.dead && !mine.gone && mine.level <= visibleUpTo
    if (marker.visible) {
      marker.position.set(mine.group.position.x, levelY(mine.level) + 0.04, mine.group.position.z)
    }

    // my bar also shows dash readiness, redrawn every frame while recharging
    if (mine && !mine.dead) {
      const remainMs = Math.max(0, local.dashReadyAt - performance.now())
      paintPlate(mine, 1 - remainMs / local.dashCooldownMs)
    }
  }

  return {
    players, state, local, predictions,
    me, canPlay, setSkins, addPlayer, removePlayer, clear, paintPlate,
    syncConfirmed, rollbackPrediction, predictRoll, predictDash,
    enqueueMove, startDeathAnim, update,
  }
}
