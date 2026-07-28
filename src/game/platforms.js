import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { blob, glow, toon } from './themes/kit.js'
import { HALF, LEVELS, RIM_CELLS, cellKey, levelY } from './layouts.js'

// The three stacked arenas: geometry, crumbling, trampolines. Colours and props
// come from the map theme; the shapes are the same everywhere so the arena reads
// the same no matter which map you picked.
// Nothing is built until the server sends the layout — see build().

// Unit shapes, scaled per instance. Every tile chunk and rim rock used to carry
// its own geometry, which meant ~500 buffers on screen to draw a few dozen
// distinct shapes; scaling a shared one looks identical and uploads once.
const tileGeo = new RoundedBoxGeometry(0.96, 0.3, 0.96, 2, 0.07)
const boxGeo = new THREE.BoxGeometry(1, 1, 1)
const coneGeo = new THREE.ConeGeometry(1, 1, 6)
const rockGeo = blob(1, 0)
const barGeo = new THREE.CylinderGeometry(1, 1, 1, 5)

export function createArena(env) {
  const { scene, fx, theme } = env
  const s = theme.surface
  const props = theme.createProps(fx)

  // One material instance per role, shared by every platform.
  const mats = {
    tileA: toon(s.tileA),
    tileB: toon(s.tileB),
    base: toon(s.base),
    rim: s.rim.map((c) => toon(c)),
    rebar: toon(s.rebar),
    // the edge markers used to be self-lit bars that outshone the whole arena;
    // now they are painted rails with only a hint of glow to read the boundary
    frame: glow(s.frame, 0.2),
    fence: glow(s.fence, 0.07),
    post: toon(s.post),
    debris: s.debris.map((c) => toon(c)),
  }

  // platforms[l] = { group, pieces: Map(key -> [{obj, pos0, quat0}]), tramp, trampKey, rimGone }
  const platforms = []
  // crumbled tiles per level, kept in sync with server "tiles" events
  const holeSets = Array.from({ length: LEVELS }, () => new Set())
  // obstacle cells per level, straight from the server layout
  const blockedSets = Array.from({ length: LEVELS }, () => new Set())
  const fallingPieces = []
  let built = false

  function decalMat(tex, color, opacity) {
    return new THREE.MeshBasicMaterial({
      map: tex, color, transparent: true, opacity, depthWrite: false,
    })
  }

  function buildPlatform(level, layout) {
    const obstacles = layout?.obstacles || []
    const decals = layout?.decals || []
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

    // tiles + ragged ground chunks underneath. Tiles never cast shadows: they are
    // a flat floor, so all it would buy is a few hundred extra shadow draws.
    for (let x = -HALF; x <= HALF; x++) {
      for (let z = -HALF; z <= HALF; z++) {
        const tile = new THREE.Mesh(tileGeo, (x + z) % 2 === 0 ? mats.tileA : mats.tileB)
        tile.position.set(x, -0.15, z)
        tile.receiveShadow = true
        group.add(tile)
        reg(x, z, tile)

        const baseH = 0.7 + Math.random() * 1.4
        const base = new THREE.Mesh(boxGeo, mats.base)
        base.scale.set(0.88 + Math.random() * 0.16, baseH, 0.88 + Math.random() * 0.16)
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

    // faint grid over the tile seams: enough to read the cells, not a light show
    const grid = new THREE.GridHelper(9, 9, s.grid[0], s.grid[1])
    grid.position.y = 0.02
    grid.material.transparent = true
    grid.material.opacity = 0.11
    grid.material.depthWrite = false
    group.add(grid)
    regRim(grid)

    // glowing edge frame
    const frameGeo = new THREE.BoxGeometry(9.14, 0.06, 0.06)
    for (const [x, z, rot] of [[0, -4.55, 0], [0, 4.55, 0], [-4.55, 0, 1], [4.55, 0, 1]]) {
      const bar = new THREE.Mesh(frameGeo, mats.frame)
      bar.position.set(x, 0.02, z)
      if (rot) bar.rotation.y = Math.PI / 2
      group.add(bar)
      regRim(bar)
    }

    // obstacles exactly where the server says they are
    for (const o of obstacles) {
      const make = props.byKind[o.kind] || props.fallback
      const g = make(o.x, o.z)
      group.add(g)
      reg(o.x, o.z, g)
      blockedSets[level].add(cellKey(o.x, o.z))
    }

    // perimeter fence
    {
      const postGeo = new THREE.CylinderGeometry(0.03, 0.045, 0.62, 6)
      const railGeo = new THREE.BoxGeometry(9.3, 0.032, 0.032)
      for (let i = -HALF; i <= HALF; i++) {
        for (const [px, pz] of [[i, -4.62], [i, 4.62], [-4.62, i], [4.62, i]]) {
          const post = new THREE.Mesh(postGeo, mats.post)
          post.position.set(px, 0.31, pz)
          group.add(post)
          regRim(post)
        }
      }
      for (const y of [0.3, 0.56]) {
        for (const [x, z, rot] of [[0, -4.62, 0], [0, 4.62, 0], [-4.62, 0, 1], [4.62, 0, 1]]) {
          const rail = new THREE.Mesh(railGeo, mats.fence)
          rail.position.set(x, y, z)
          if (rot) rail.rotation.y = Math.PI / 2
          group.add(rail)
          regRim(rail)
        }
      }
    }

    // torn ground under the rim: rounded hanging rocks, ragged slabs, bars
    {
      for (let x = -HALF; x <= HALF; x++) {
        for (let z = -HALF; z <= HALF; z++) {
          const onRim = Math.abs(x) === HALF || Math.abs(z) === HALF
          if (!onRim) continue
          const ox = Math.abs(x) === HALF ? Math.sign(x) : 0
          const oz = Math.abs(z) === HALF ? Math.sign(z) : 0

          const spike = new THREE.Mesh(coneGeo, mats.rim[Math.random() < 0.5 ? 0 : 1])
          const spikeR = 0.2 + Math.random() * 0.16
          spike.scale.set(spikeR, 0.6 + Math.random() * 0.9, spikeR)
          spike.rotation.x = Math.PI
          spike.rotation.y = Math.random() * Math.PI
          spike.position.set(
            x + ox * 0.3 + (Math.random() - 0.5) * 0.35,
            -1.4 - Math.random() * 0.8,
            z + oz * 0.3 + (Math.random() - 0.5) * 0.35
          )
          group.add(spike)
          reg(x, z, spike)

          if (Math.random() < 0.5) {
            const slab = new THREE.Mesh(rockGeo, mats.rim[1])
            slab.scale.setScalar(0.28 + Math.random() * 0.22)
            slab.position.set(
              x + ox * (0.6 + Math.random() * 0.3),
              -0.4 - Math.random() * 0.6,
              z + oz * (0.6 + Math.random() * 0.3)
            )
            slab.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3)
            slab.scale.y *= 0.6
            group.add(slab)
            reg(x, z, slab)
          }

          if (Math.random() < 0.25) {
            const bar = new THREE.Mesh(barGeo, mats.rebar)
            bar.scale.set(0.015, 0.45 + Math.random() * 0.4, 0.015)
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
      const decalGeo = new THREE.PlaneGeometry(0.85, 0.85)
      const dMat = decalMat(s.decalTex, s.decal, 0.32)
      for (const [x, z] of decals) {
        const decal = new THREE.Mesh(decalGeo, dMat)
        decal.rotation.x = -Math.PI / 2
        decal.position.set(x, 0.022, z)
        group.add(decal)
        reg(x, z, decal)
      }

      if (level === 0 && s.padTex) {
        const pad = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), decalMat(s.padTex, s.pad, 0.5))
        pad.rotation.x = -Math.PI / 2
        pad.position.set(0, 0.022, 0)
        group.add(pad)
        reg(0, 0, pad)
      }

      for (let i = 0; i < 12; i++) {
        const debris = new THREE.Mesh(rockGeo, mats.debris[i % 2])
        const size = 0.05 + Math.random() * 0.06
        const dx = (Math.random() - 0.5) * 8.4
        const dz = (Math.random() - 0.5) * 8.4
        debris.position.set(dx, 0.05, dz)
        debris.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3)
        debris.scale.set(size, size * 0.7, size)
        group.add(debris)
        reg(Math.round(dx), Math.round(dz), debris)
      }
    }

    // overhead light so the arena reads clearly whatever the sky is doing
    const spot = new THREE.SpotLight('#ffffff', 110, 34, Math.PI / 4.2, 0.7, 1.4)
    spot.position.set(0, 12, 2)
    spot.target.position.set(0, 0, 0)
    group.add(spot, spot.target)
    fx.platformSpots.push(spot)

    // accent light so the upper platforms are not flat copies of the first
    const accent = new THREE.PointLight(theme.accents[level % 2], 7, 20)
    accent.position.set(level === 1 ? 6 : -6, 3.5, level === 1 ? -6 : 6)
    if (level > 0) group.add(accent)

    const tramp = props.trampoline()
    group.add(tramp.g)

    platforms.push({ group, pieces, tramp, trampKey: null, rimGone: 0 })
  }

  // Called from the welcome handler with the server's layout. Reconnects send
  // the layout again; the geometry is already there, so just reset it.
  function build(levels) {
    if (built) {
      restorePlatforms()
      return
    }
    built = true
    for (let l = 0; l < LEVELS; l++) buildPlatform(l, levels?.[l])
    // the platform spotlights only exist now: re-apply the current day/night
    env.setDayMode(env.isDay())
  }

  function destroyCellVisual(level, x, z, animate = true) {
    holeSets[level].add(cellKey(x, z))
    const plat = platforms[level]
    if (!plat) return
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
    for (const set of holeSets) set.clear()
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
    if (!plat) return
    plat.tramp.g.position.set(x, 0, z)
    plat.tramp.g.visible = true
    plat.trampKey = cellKey(x, z)
  }

  // cell checks mirroring the server, so predictions never phase through walls
  const isBlocked = (l, x, z) => blockedSets[l].has(cellKey(x, z)) && !holeSets[l].has(cellKey(x, z))
  const isHole = (l, x, z) => holeSets[l].has(cellKey(x, z))
  const isTramp = (l, x, z) => platforms[l]?.trampKey === cellKey(x, z)

  // visibleUpTo: platforms above the local player are hidden so they don't block the view
  function update(dt, t, visibleUpTo) {
    for (let l = 0; l < platforms.length; l++) {
      platforms[l].group.visible = l <= visibleUpTo
      // gentle platform hover, slightly out of phase per level
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
      tr.pad.position.y = 0.17 + Math.abs(Math.sin(t * 5)) * 0.07 - kick * 0.16
      tr.pad.material.emissiveIntensity = 0.8 + kick * 1.4
      tr.ring.material.emissiveIntensity = 0.9 + Math.sin(t * 6) * 0.3 + kick * 1.2
    }
  }

  return {
    platforms, holeSets,
    build, destroyCellVisual, restorePlatforms, showTramp,
    isBlocked, isHole, isTramp,
    update,
  }
}
