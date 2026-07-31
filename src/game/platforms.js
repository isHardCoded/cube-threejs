import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { blob, glow, toon } from './themes/kit.js'
import { HALF, LEVELS, RIM_CELLS, cellKey, floorY, getPlayHalf, rimCellCount } from './layouts.js'

// The three stacked arenas: geometry, crumbling, trampolines. Colours and props
// come from the map theme; the shapes are the same everywhere so the arena reads
// the same no matter which map you picked.
// Nothing is built until the server sends the layout — see build().

// Unit shapes, scaled per instance. Every tile chunk and rim rock used to carry
// its own geometry, which meant ~500 buffers on screen to draw a few dozen
// distinct shapes; scaling a shared one looks identical and uploads once.
const tileGeoDefault = new RoundedBoxGeometry(0.96, 0.3, 0.96, 2, 0.07)
const boxGeo = new THREE.BoxGeometry(1, 1, 1)
const coneGeo = new THREE.ConeGeometry(1, 1, 6)
const rockGeo = blob(1, 0)
const barGeo = new THREE.CylinderGeometry(1, 1, 1, 5)

export function createArena(env) {
  const { scene, fx, theme } = env
  const s = theme.surface
  const props = theme.createProps(fx)
  const lift = theme.arenaLift || 0
  const yOf = (level) => floorY(level, lift)
  const _splashPos = new THREE.Vector3()
  const bare = !!theme.bareFloor
  const halfOf = () => (theme.gridHalf > 0 ? theme.gridHalf : getPlayHalf()) || HALF
  const spanOf = () => 2 * halfOf() + 1
  const rimCountOf = () => rimCellCount(halfOf()) || RIM_CELLS

  // Soft toy tiles: themes may ask for fatter bevels (jungle Stage 1).
  const bevel = s.tileBevel ?? 0.07
  const bevelSegs = s.tileBevelSegs ?? 2
  const tileGeo = (bevel !== 0.07 || bevelSegs !== 2)
    ? new RoundedBoxGeometry(0.96, 0.32, 0.96, bevelSegs, bevel)
    : tileGeoDefault
  const heightJitter = s.tileHeightJitter ?? 0

  // One material instance per role, shared by every platform.
  const steps = theme.materialSteps || 4
  const tileMats = [
    toon(s.tileA, { steps, ...(s.tileMapA ? { map: s.tileMapA } : {}) }),
    toon(s.tileB, { steps, ...(s.tileMapB ? { map: s.tileMapB } : {}) }),
  ]
  if (s.tileC) tileMats.push(toon(s.tileC, { steps }))
  if (s.tileD) tileMats.push(toon(s.tileD, { steps }))

  const mats = {
    tileA: tileMats[0],
    tileB: tileMats[1],
    base: toon(s.base, { steps, ...(s.baseMap ? { map: s.baseMap } : {}) }),
    rim: s.rim.map((c) => toon(c, { steps, ...(s.rimMap ? { map: s.rimMap } : {}) })),
    rebar: toon(s.rebar, { steps }),
    // the edge markers used to be self-lit bars that outshone the whole arena;
    // now they are painted rails with only a hint of glow to read the boundary
    frame: glow(s.frame, 0.2),
    fence: glow(s.fence, 0.07),
    post: toon(s.post, { steps }),
    debris: s.debris.map((c) => toon(c, { steps })),
  }

  function pickTileMat(x, z) {
    // Controlled checker + light 4-way variation (not pure noise).
    const checker = (x + z) & 1
    if (tileMats.length < 3) return tileMats[checker]
    const variant = ((x * 3 + z * 7) % (tileMats.length / 2 | 0)) | 0
    return tileMats[checker + variant * 2] || tileMats[checker]
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
    group.position.y = yOf(level)
    scene.add(group)

    const pieces = new Map()
    const reg = (x, z, obj, opts = {}) => {
      const key = cellKey(x, z)
      if (!pieces.has(key)) pieces.set(key, [])
      pieces.get(key).push({
        obj,
        pos0: obj.position.clone(),
        quat0: obj.quaternion.clone(),
        // props pop away instantly so the readable crumple is the floor tile
        soft: !!opts.soft,
      })
    }
    // rim furniture (fence, frame, grid) collapses once the outer ring is gone
    const regRim = (obj) => {
      if (!pieces.has('__rim')) pieces.set('__rim', [])
      pieces.get('__rim').push({ obj, pos0: obj.position.clone(), quat0: obj.quaternion.clone() })
    }

    // Authored maps (jungle) bring their own rim / fence / pad from Blender on
    // level 0; keep the procedural furniture on upper platforms and other themes.
    const authoredDressing = level === 0 && theme.authoredArena && theme.createArenaDressing

    // tiles + ragged ground chunks underneath. Tiles never cast shadows: they are
    // a flat floor, so all it would buy is a few hundred extra shadow draws.
    // On authored floating arenas keep under-chunks short so holes read as void.
    const half = halfOf()
    for (let x = -half; x <= half; x++) {
      for (let z = -half; z <= half; z++) {
        const tile = new THREE.Mesh(tileGeo, pickTileMat(x, z))
        // ≤ ~2.5% cell size vertical jitter — toy relief, still readable for play
        const yJ = heightJitter
          ? ((((x * 12.9898 + z * 78.233) % 1) + 1) % 1 - 0.5) * 2 * heightJitter
          : 0
        tile.position.set(x, -0.15 + yJ, z)
        tile.receiveShadow = true
        group.add(tile)
        reg(x, z, tile)

        const baseH = authoredDressing
          ? 0.35 + Math.random() * 0.25
          : 0.7 + Math.random() * 1.4
        const base = new THREE.Mesh(boxGeo, mats.base)
        base.scale.set(0.88 + Math.random() * 0.16, baseH, 0.88 + Math.random() * 0.16)
        base.position.set(
          x + (Math.random() - 0.5) * 0.12,
          -0.3 - baseH / 2 + yJ,
          z + (Math.random() - 0.5) * 0.12
        )
        base.rotation.y = (Math.random() - 0.5) * 0.18
        group.add(base)
        reg(x, z, base)
      }
    }

    if (authoredDressing) {
      const dressing = theme.createArenaDressing()
      if (dressing) group.add(dressing)
    }

    if (!authoredDressing && !bare) {
      // faint grid over the tile seams: enough to read the cells, not a light show
      const span = spanOf()
      const edge = half + 0.55
      const grid = new THREE.GridHelper(span, span, s.grid[0], s.grid[1])
      grid.position.y = 0.02
      grid.material.transparent = true
      grid.material.opacity = 0.11
      grid.material.depthWrite = false
      group.add(grid)
      regRim(grid)

      // glowing edge frame
      const frameGeo = new THREE.BoxGeometry(span + 0.14, 0.06, 0.06)
      for (const [x, z, rot] of [[0, -edge, 0], [0, edge, 0], [-edge, 0, 1], [edge, 0, 1]]) {
        const bar = new THREE.Mesh(frameGeo, mats.frame)
        bar.position.set(x, 0.02, z)
        if (rot) bar.rotation.y = Math.PI / 2
        group.add(bar)
        regRim(bar)
      }
    }

    // obstacles exactly where the server says they are
    for (const o of obstacles) {
      const make = props.byKind[o.kind] || props.fallback
      const g = make(o.x, o.z)
      group.add(g)
      reg(o.x, o.z, g, { soft: true })
      blockedSets[level].add(cellKey(o.x, o.z))
    }

    if (!authoredDressing && !bare) {
      // perimeter fence
      {
        const span = spanOf()
        const fence = half + 0.62
        const postGeo = new THREE.CylinderGeometry(0.03, 0.045, 0.62, 6)
        const railGeo = new THREE.BoxGeometry(span + 0.3, 0.032, 0.032)
        for (let i = -half; i <= half; i++) {
          for (const [px, pz] of [[i, -fence], [i, fence], [-fence, i], [fence, i]]) {
            const post = new THREE.Mesh(postGeo, mats.post)
            post.position.set(px, 0.31, pz)
            group.add(post)
            regRim(post)
          }
        }
        for (const y of [0.3, 0.56]) {
          for (const [x, z, rot] of [[0, -fence, 0], [0, fence, 0], [-fence, 0, 1], [fence, 0, 1]]) {
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
        for (let x = -half; x <= half; x++) {
          for (let z = -half; z <= half; z++) {
            const onRim = Math.abs(x) === half || Math.abs(z) === half
            if (!onRim) continue
            const ox = Math.abs(x) === half ? Math.sign(x) : 0
            const oz = Math.abs(z) === half ? Math.sign(z) : 0

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
    }

    // floor decals + debris
    {
      const decalGeo = new THREE.PlaneGeometry(0.85, 0.85)
      const dMat = s.decalTex ? decalMat(s.decalTex, s.decal, 0.32) : null
      for (const [x, z] of decals) {
        if (!dMat) break
        const decal = new THREE.Mesh(decalGeo, dMat)
        decal.rotation.x = -Math.PI / 2
        decal.position.set(x, 0.022, z)
        group.add(decal)
        reg(x, z, decal)
      }

      // Bare PvE floor: scatter jungle moss blotches across the wide sector grid.
      if (bare && dMat && level === 0) {
        const n = Math.min(120, Math.floor(spanOf() * spanOf() * 0.08))
        for (let i = 0; i < n; i++) {
          const x = ((Math.random() * 2 - 1) * half) | 0
          const z = ((Math.random() * 2 - 1) * half) | 0
          const decal = new THREE.Mesh(decalGeo, dMat)
          decal.rotation.x = -Math.PI / 2
          decal.rotation.z = Math.random() * Math.PI
          decal.position.set(x, 0.022, z)
          group.add(decal)
          reg(x, z, decal)
        }
      }

      if (level === 0 && s.padTex && !authoredDressing) {
        const pad = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), decalMat(s.padTex, s.pad, 0.5))
        pad.rotation.x = -Math.PI / 2
        pad.position.set(0, 0.022, 0)
        group.add(pad)
        reg(0, 0, pad)
      }

      const debrisN = bare ? 36 : 12
      const debrisSpan = bare ? half * 1.8 : 8.4
      for (let i = 0; i < debrisN; i++) {
        const debris = new THREE.Mesh(rockGeo, mats.debris[i % mats.debris.length])
        const size = 0.05 + Math.random() * 0.06
        const dx = (Math.random() - 0.5) * debrisSpan
        const dz = (Math.random() - 0.5) * debrisSpan
        debris.position.set(dx, 0.05, dz)
        debris.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3)
        debris.scale.set(size, size * 0.7, size)
        group.add(debris)
        reg(Math.round(dx), Math.round(dz), debris)
      }
    }

    // overhead light so the arena reads clearly whatever the sky is doing.
    // Intensity is in candela (three r155+): the old 110 value blew a white
    // hotspot into the platform centre, especially at night / with several
    // levels visible at once.
    const mode = env.isDay() ? theme.day : theme.night
    const spotDist = bare ? Math.max(48, spanOf() * 1.4) : 28
    const spot = new THREE.SpotLight(mode.spot, mode.spotIntensity, spotDist, Math.PI / 3.6, 0.85, 2)
    spot.position.set(0, 14, 0)
    spot.target.position.set(0, 0, 0)
    group.add(spot, spot.target)
    fx.platformSpots.push(spot)

    // accent light so the upper platforms are not flat copies of the first
    const accent = new THREE.PointLight(theme.accents[level % 2], 7, 20)
    accent.position.set(level === 1 ? 6 : -6, 3.5, level === 1 ? -6 : 6)
    if (level > 0) group.add(accent)

    const tramp = props.trampoline()
    if (tramp?.g) group.add(tramp.g)

    platforms.push({
      group,
      pieces,
      tramp: tramp?.g ? tramp : { g: null, pad: null, ring: null, bounce: 0 },
      trampKey: null,
      rimGone: 0,
      spot,
    })
  }

  // Called from the welcome handler with the server's layout. Reconnects send
  // the layout again; the geometry is already there, so just reset it.
  function build(levels) {
    if (built) {
      restorePlatforms()
      return
    }
    built = true
    const maxL = theme.singleLevel ? 1 : LEVELS
    for (let l = 0; l < maxL; l++) buildPlatform(l, levels?.[l])
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
        if (e.soft) {
          // Obstacles vanish with the cell — tumbling props stole attention from
          // the floor sectors that are supposed to read as crumbling.
          e.obj.visible = false
          continue
        }
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
      if (plat.tramp?.g) plat.tramp.g.visible = false
      plat.trampKey = null
    }
    // once the whole outer ring is gone, the fence/frame/grid collapse as well
    if (Math.max(Math.abs(x), Math.abs(z)) === halfOf()) {
      plat.rimGone++
      if (plat.rimGone === rimCountOf()) {
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
    clearLaunchHatches()
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
      plat.tramp?.g && (plat.tramp.g.visible = false)
      plat.trampKey = null
      plat.rimGone = 0
    }
  }

  function showTramp(level, x, z) {
    const plat = platforms[level]
    if (!plat?.tramp?.g) return
    plat.tramp.g.position.set(x, 0, z)
    plat.tramp.g.visible = true
    plat.trampKey = cellKey(x, z)
  }

  // --- Launch hatch: landing tile dips so the cube flies through, then reseats ---
  const launchHatches = [] // { id, entries, t, time }
  const smooth01 = (u) => {
    const x = Math.min(1, Math.max(0, u))
    return x * x * (3 - 2 * x)
  }

  /** How far the tile is lowered (0 seated … 1 fully open), by launch progress. */
  function hatchOpenAmount(t) {
    // Open early, hold while the cube passes the underside, reseat before land.
    if (t < 0.10) return smooth01(t / 0.10)
    if (t < 0.58) return 1
    if (t < 0.78) return 1 - smooth01((t - 0.58) / 0.20)
    return 0
  }

  function restoreHatchEntries(entries) {
    for (const e of entries) {
      if (!e.obj) continue
      e.obj.position.copy(e.pos0)
      e.obj.quaternion.copy(e.quat0)
    }
  }

  /**
   * Drop the destination cell's floor for a trampoline launch so the die
   * passes through a temporary hole, then seat the tile again under the landing.
   */
  function beginLaunchHatch(level, x, z, duration = 1.65) {
    const plat = platforms[level]
    if (!plat || holeSets[level].has(cellKey(x, z))) return
    const key = cellKey(x, z)
    const id = `${level}:${key}`
    // Replace any in-flight hatch on the same cell
    for (let i = launchHatches.length - 1; i >= 0; i--) {
      if (launchHatches[i].id !== id) continue
      restoreHatchEntries(launchHatches[i].entries)
      launchHatches.splice(i, 1)
    }
    const arr = plat.pieces.get(key) || []
    const entries = []
    for (const e of arr) {
      if (e.soft || !e.obj?.visible) continue
      entries.push({ obj: e.obj, pos0: e.pos0.clone(), quat0: e.quat0.clone() })
    }
    if (!entries.length) return
    launchHatches.push({ id, entries, t: 0, time: Math.max(0.4, duration) })
  }

  function clearLaunchHatches() {
    for (const h of launchHatches) restoreHatchEntries(h.entries)
    launchHatches.length = 0
  }

  // cell checks mirroring the server, so predictions never phase through walls
  const isBlocked = (l, x, z) => blockedSets[l].has(cellKey(x, z)) && !holeSets[l].has(cellKey(x, z))
  const isHole = (l, x, z) => holeSets[l].has(cellKey(x, z))
  const isTramp = (l, x, z) => platforms[l]?.trampKey === cellKey(x, z)

  // visibleUpTo: platforms above the local player are hidden so they don't block the view
  function update(dt, t, visibleUpTo) {
    for (let l = 0; l < platforms.length; l++) {
      const show = l <= visibleUpTo
      platforms[l].group.visible = show
      // Hide the light too: some three builds still sample lights under an
      // invisible parent, which stacked three centre spots into a white beam.
      if (platforms[l].spot) platforms[l].spot.visible = show
      // Floating authored arenas sit on arenaLift + a clear bob so level 0 never
      // reads as glued to the ground.
      const hover = (theme.authoredArena && l === 0) ? 0.28 : 0.05
      platforms[l].group.position.y = yOf(l) + Math.sin(t * 0.85 + l * 1.3) * hover
    }

    // Launch hatches (local Y offset on floor pieces)
    for (let i = launchHatches.length - 1; i >= 0; i--) {
      const h = launchHatches[i]
      h.t = Math.min(1, h.t + dt / h.time)
      const open = hatchOpenAmount(h.t)
      // Deep enough that a stretched die clears the underside, but still readable.
      const dy = -1.65 * open
      for (const e of h.entries) {
        e.obj.position.copy(e.pos0)
        e.obj.position.y += dy
      }
      if (h.t >= 1) {
        restoreHatchEntries(h.entries)
        launchHatches.splice(i, 1)
      }
    }

    // crumbled pieces tumble down into the void / lake
    for (let i = fallingPieces.length - 1; i >= 0; i--) {
      const f = fallingPieces[i]
      f.t += dt
      if (f.t < 0) continue
      f.vy += dt * 9
      f.obj.position.y -= f.vy * dt
      f.obj.rotation.x += f.rx * dt
      f.obj.rotation.z += f.rz * dt
      const lakeY = theme.lakeY
      if (lakeY != null && !f.splashed && !f.soft) {
        f.obj.getWorldPosition(_splashPos)
        if (_splashPos.y <= lakeY + 0.25) {
          f.splashed = true
          env.splash?.(_splashPos.x, _splashPos.z, 0.45)
        }
      }
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
      if (!tr?.g) continue
      if (tr.bounce > 0) tr.bounce = Math.max(0, tr.bounce - dt * 2)
      if (!tr.g.visible) continue
      const kick = Math.sin(tr.bounce * Math.PI)
      if (tr.pad) {
        tr.pad.position.y = 0.17 + Math.abs(Math.sin(t * 5)) * 0.07 - kick * 0.16
        if (tr.pad.material) tr.pad.material.emissiveIntensity = 0.8 + kick * 1.4
      }
      if (tr.ring?.material) {
        tr.ring.material.emissiveIntensity = 0.9 + Math.sin(t * 6) * 0.3 + kick * 1.2
      }
    }
  }

  return {
    platforms, holeSets,
    build, destroyCellVisual, restorePlatforms, showTramp,
    beginLaunchHatch, clearLaunchHatches,
    isBlocked, isHole, isTramp,
    update,
  }
}
