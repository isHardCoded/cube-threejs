import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import {
  markCast, markReceive, POLISHED_POST, POLISHED_POST_NIGHT, POLISHED_SHADOWS, polishedGfx,
} from './gfxPolish.js'
import { blob, canvasTexture, cellRng, createDrift, geo, glow, pick, solid, toon } from './kit.js'

// Night city, cel shaded. The neon is still the point of the map, but it lights
// the surfaces instead of blooming over them — the old version glowed so hard
// the cubes disappeared into it.
const CYAN = '#5fe6ff'
const MAGENTA = '#ff6ba8'
const YELLOW = '#ffd54a'
const ACCENTS = [CYAN, MAGENTA, YELLOW]

// Cartoon "metal": mid-tone and matte. Near-black props read as holes in the
// floor at this camera distance, so nothing here goes darker than this.
const METAL = '#474765'

// diagonal hazard stripes
const decalTex = canvasTexture((ctx) => {
  ctx.strokeStyle = YELLOW
  ctx.lineWidth = 11
  for (let i = -128; i < 256; i += 34) {
    ctx.beginPath()
    ctx.moveTo(i, 128)
    ctx.lineTo(i + 128, 0)
    ctx.stroke()
  }
})

// double ring for the centre landing pad
const padTex = canvasTexture((ctx) => {
  ctx.strokeStyle = CYAN
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.arc(64, 64, 48, 0, Math.PI * 2)
  ctx.stroke()
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(64, 64, 34, 0, Math.PI * 2)
  ctx.stroke()
})

// The tower bodies are unlit, so the texture background is what gives the
// skyline its silhouette: too dark and the city becomes floating neon confetti.
function windowTexture() {
  return canvasTexture((ctx, c) => {
    ctx.fillStyle = '#302b58'
    ctx.fillRect(0, 0, c.width, c.height)
    const palette = [YELLOW, CYAN, MAGENTA, '#f7f7ff']
    for (let y = 4; y < c.height - 4; y += 8) {
      for (let x = 4; x < c.width - 4; x += 8) {
        if (Math.random() < 0.26) {
          ctx.fillStyle = palette[Math.floor(Math.random() * palette.length)]
          ctx.globalAlpha = 0.35 + Math.random() * 0.4
          ctx.fillRect(x, y, 4, 5)
        }
      }
    }
  }, 64, 128)
}

function createBackdrop(scene, fx, opts = {}) {
  const castMode = opts.shadowCast || 'heavy'
  const group = new THREE.Group()
  scene.add(group)

  // One unit box scaled per tower and three shared window materials: 40 towers
  // used to mean 40 materials, which is 40 shader programs for no visual gain.
  const towerGeo = geo('cyber:tower', () => new THREE.BoxGeometry(1, 1, 1))
  const roofMat = toon('#3a3560')
  const windowMats = [windowTexture(), windowTexture(), windowTexture()].map((tex) =>
    new THREE.MeshBasicMaterial({ map: tex, color: '#ffffff' }))
  const signMats = ACCENTS.map((c) => new THREE.MeshBasicMaterial({
    color: c, side: THREE.DoubleSide, transparent: true, opacity: 0.9,
  }))
  const signGeo = geo('cyber:sign', () => new THREE.PlaneGeometry(1.6, 0.5))
  const beaconGeo = geo('cyber:beacon', () => new THREE.SphereGeometry(0.13, 8, 8))

  for (let i = 0; i < 40; i++) {
    const angle = (i / 40) * Math.PI * 2 + Math.random() * 0.12
    const radius = 15 + Math.random() * 19
    const w = 1.6 + Math.random() * 2.4
    const d = 1.6 + Math.random() * 2.4
    const h = 13 + Math.random() * 17

    const side = windowMats[i % windowMats.length]
    const tower = new THREE.Mesh(towerGeo, [side, side, roofMat, roofMat, side, side])
    tower.scale.set(w, h, d)
    tower.position.set(Math.cos(angle) * radius, -22 + h / 2, Math.sin(angle) * radius)
    tower.rotation.y = Math.random() * Math.PI
    // Tall skyline casters only — keep the shadow budget readable until Blender city lands.
    if (i % 4 === 0) markCast(tower, 'core', castMode)
    else if (i % 2 === 0) markCast(tower, 'heavy', castMode)
    else markReceive(tower)
    group.add(tower)

    if (h > 26) {
      const beacon = new THREE.Mesh(beaconGeo, glow('#ff5566', 0.9))
      beacon.position.set(tower.position.x, -22 + h + 0.2, tower.position.z)
      group.add(beacon)
      fx.blinkers.push({ mesh: beacon, phase: Math.random() * Math.PI * 2, speed: 2.5 })
    }

    if (i % 4 === 0) {
      const sign = new THREE.Mesh(signGeo, signMats[i % signMats.length])
      sign.position.set(tower.position.x, -22 + h * (0.5 + Math.random() * 0.3), tower.position.z)
      sign.lookAt(0, sign.position.y, 0)
      sign.translateZ(Math.max(w, d) * 0.75)
      group.add(sign)
    }
  }

  // flying cars streaming around the city
  const cars = []
  const bodyGeo = geo('cyber:car', () => new RoundedBoxGeometry(0.55, 0.14, 0.24, 2, 0.05))
  const lampGeo = geo('cyber:lamp', () => new THREE.BoxGeometry(0.07, 0.07, 0.19))
  const bodyMat = toon(METAL)
  const headMat = glow('#eaffff', 0.9)
  const tailMat = glow(MAGENTA, 0.9)
  for (let i = 0; i < 7; i++) {
    const car = new THREE.Group()
    car.add(new THREE.Mesh(bodyGeo, bodyMat))
    const head = new THREE.Mesh(lampGeo, headMat)
    head.position.x = 0.28
    car.add(head)
    const tail = new THREE.Mesh(lampGeo, tailMat)
    tail.position.x = -0.28
    car.add(tail)
    // they used to cross the arena at platform height, which read as glitches
    // streaking over the floor; now they stay out beyond the fence and below it
    car.userData = {
      angle: (i / 7) * Math.PI * 2,
      radius: 17 + Math.random() * 9,
      speed: (0.12 + Math.random() * 0.18) * (i % 2 === 0 ? 1 : -1),
      y: -12 + Math.random() * 9,
    }
    group.add(car)
    cars.push(car)
  }

  const rain = createDrift({
    count: 320, color: '#9beeff', size: 0.06, opacity: 0.35,
    spread: 38, top: 24, bottom: -6, speed: [9, 15],
  })
  group.add(rain.points)

  return {
    update(dt, t) {
      for (const c of cars) {
        const u = c.userData
        u.angle += u.speed * dt
        c.position.set(Math.cos(u.angle) * u.radius, u.y, Math.sin(u.angle) * u.radius)
        const ahead = u.angle + Math.sign(u.speed) * 0.05
        c.lookAt(Math.cos(ahead) * u.radius, u.y, Math.sin(ahead) * u.radius)
        c.rotateY(Math.PI / 2) // body is modelled along +x
      }
      rain.update(dt, t)
    },
    setDay(day) {
      // the towers are unlit, so daylight is faked by tinting them: darkening
      // them instead turned the skyline into black cutouts against a pale sky
      for (const m of windowMats) m.color.set(day ? '#b3aed2' : '#ffffff')
      for (const m of signMats) m.opacity = day ? 0.55 : 0.9
      rain.material.opacity = day ? 0.22 : 0.35
    },
  }
}

function createProps(fx) {
  function pylon(x, z) {
    const rnd = cellRng(x, z)
    const color = pick(rnd, ACCENTS)
    // a pylon dead centre is the arena's landmark, so it stands taller
    const scale = x === 0 && z === 0 ? 1.6 : 0.85 + rnd() * 0.4
    const withHolo = rnd() < 0.4

    const g = new THREE.Group()
    const pole = solid(new THREE.Mesh(
      geo('cyber:pole', () => new THREE.CylinderGeometry(0.08, 0.11, 1.4, 8)), toon(METAL)))
    pole.position.y = 0.7
    g.add(pole)

    const ringMat = glow(color, 0.8)
    const ringGeo = geo('cyber:ring', () => new THREE.TorusGeometry(0.14, 0.028, 8, 20))
    for (const y of [0.35, 0.75, 1.15]) {
      const ring = new THREE.Mesh(ringGeo, ringMat)
      ring.rotation.x = Math.PI / 2
      ring.position.y = y
      g.add(ring)
    }

    const tip = new THREE.Mesh(
      geo('cyber:tip', () => new THREE.SphereGeometry(0.07, 10, 10)), glow(MAGENTA, 1))
    tip.position.y = 1.48
    g.add(tip)
    fx.blinkers.push({ mesh: tip, phase: rnd() * Math.PI * 2, speed: 2 + rnd() * 3 })

    if (withHolo) {
      const holo = new THREE.Mesh(
        geo('cyber:holo', () => new THREE.OctahedronGeometry(0.24)),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4, wireframe: true })
      )
      holo.position.y = 2.0
      g.add(holo)
      fx.holos.push(holo)
    }

    g.position.set(x, 0, z)
    g.scale.setScalar(scale)
    return g
  }

  function crate(x, z) {
    const rnd = cellRng(x, z)
    const color = pick(rnd, ACCENTS)
    const g = new THREE.Group()
    const box = solid(new THREE.Mesh(
      geo('cyber:crate', () => new RoundedBoxGeometry(0.58, 0.58, 0.58, 2, 0.07)),
      toon('#525276')))
    box.position.y = 0.29
    g.add(box)

    const strip = new THREE.Mesh(
      geo('cyber:strip', () => new THREE.BoxGeometry(0.6, 0.04, 0.6)), glow(color, 0.7))
    strip.position.y = 0.44
    g.add(strip)

    g.position.set(x, 0, z)
    g.scale.setScalar(0.82 + rnd() * 0.3)
    g.rotation.y = (rnd() - 0.5) * 0.6
    return g
  }

  function barrels(x, z) {
    const g = new THREE.Group()
    const barrelGeo = geo('cyber:barrel', () => new THREE.CylinderGeometry(0.16, 0.17, 0.42, 12))
    const stripeGeo = geo('cyber:barrelStripe', () => new THREE.CylinderGeometry(0.165, 0.165, 0.06, 12))
    const barrelMat = toon('#42675e')
    const stripeMat = glow(YELLOW, 0.6)
    for (const [bx, by, bz, tilt] of [
      [-0.14, 0.21, -0.1, 0], [0.16, 0.21, 0.12, 0], [0.0, 0.6, 0.0, 0.12],
    ]) {
      const b = solid(new THREE.Mesh(barrelGeo, barrelMat))
      b.position.set(bx, by, bz)
      b.rotation.z = tilt
      g.add(b)
      const stripe = new THREE.Mesh(stripeGeo, stripeMat)
      stripe.position.set(bx, by + 0.09, bz)
      stripe.rotation.z = tilt
      g.add(stripe)
    }
    g.position.set(x, 0, z)
    return g
  }

  function column(x, z) {
    const rnd = cellRng(x, z)
    const g = new THREE.Group()
    const concrete = toon('#6a6a80')
    const stump = solid(new THREE.Mesh(
      geo('cyber:stump', () => new THREE.CylinderGeometry(0.2, 0.24, 0.56, 8)), concrete))
    stump.position.y = 0.28
    g.add(stump)
    const jag = solid(new THREE.Mesh(
      geo('cyber:jag', () => new THREE.ConeGeometry(0.19, 0.3, 5)), concrete))
    jag.position.set(0.03, 0.7, -0.02)
    jag.rotation.y = 0.7
    g.add(jag)
    const barGeo = geo('cyber:rebar', () => new THREE.CylinderGeometry(0.014, 0.014, 0.3, 5))
    const barMat = toon('#7a6244')
    for (let i = 0; i < 3; i++) {
      const bar = new THREE.Mesh(barGeo, barMat)
      bar.position.set((rnd() - 0.5) * 0.2, 0.87, (rnd() - 0.5) * 0.2)
      bar.rotation.set((rnd() - 0.5) * 0.8, 0, (rnd() - 0.5) * 0.8)
      g.add(bar)
    }
    g.position.set(x, 0, z)
    g.rotation.y = rnd() * Math.PI
    return g
  }

  function antenna(x, z) {
    const rnd = cellRng(x, z)
    const g = new THREE.Group()
    const metal = toon(METAL)
    const mast = solid(new THREE.Mesh(
      geo('cyber:mast', () => new THREE.CylinderGeometry(0.04, 0.06, 1.9, 6)), metal))
    mast.position.y = 0.95
    g.add(mast)
    const crossGeo = geo('cyber:cross', () => new THREE.BoxGeometry(0.5, 0.03, 0.03))
    for (const [y, s] of [[1.2, 1], [1.55, 0.68]]) {
      const cross = new THREE.Mesh(crossGeo, metal)
      cross.position.y = y
      cross.scale.x = s
      g.add(cross)
    }
    const dish = new THREE.Mesh(
      geo('cyber:dish', () => new THREE.SphereGeometry(0.13, 10, 8, 0, Math.PI)), metal)
    dish.position.set(0.1, 1.4, 0)
    dish.rotation.y = -Math.PI / 2
    g.add(dish)
    const tip = new THREE.Mesh(
      geo('cyber:antTip', () => new THREE.SphereGeometry(0.055, 8, 8)), glow('#ff5566', 1))
    tip.position.y = 1.92
    g.add(tip)
    fx.blinkers.push({ mesh: tip, phase: rnd() * Math.PI * 2, speed: 3.5 })
    g.position.set(x, 0, z)
    return g
  }

  // Rubble pile: the fallback for any kind this theme does not know.
  function rubble(x, z) {
    const rnd = cellRng(x, z)
    const g = new THREE.Group()
    const mat = toon('#5b5b74')
    for (let i = 0; i < 4; i++) {
      const chunk = solid(new THREE.Mesh(blob(0.1 + rnd() * 0.12, 0), mat))
      chunk.position.set((rnd() - 0.5) * 0.5, 0.1 + rnd() * 0.18, (rnd() - 0.5) * 0.5)
      chunk.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3)
      g.add(chunk)
    }
    g.position.set(x, 0, z)
    return g
  }

  function trampoline() {
    const g = new THREE.Group()
    const base = solid(new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.46, 0.14, 20), toon(METAL)))
    base.position.y = 0.07
    g.add(base)
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.36, 0.05, 10, 24), glow(CYAN, 0.9))
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.16
    g.add(ring)
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.3, 0.08, 20), glow(MAGENTA, 0.8))
    pad.position.y = 0.17
    g.add(pad)
    g.visible = false
    return { g, pad, ring, bounce: 0 }
  }

  return {
    byKind: { pylon, crate, barrel: barrels, column, antenna },
    fallback: rubble,
    trampoline,
  }
}

export default {
  id: 'cyberpunk',

  surface: {
    tileA: '#3e4070', tileB: '#333558',
    base: '#463a58',
    rim: ['#4b3f5c', '#372e45'], rebar: '#8a7250',
    grid: ['#8f7fd8', '#7fc9e0'],
    frame: YELLOW, fence: '#a6d5e4', post: METAL,
    decal: YELLOW, decalTex,
    pad: CYAN, padTex,
    debris: ['#45455a', '#332b3d'],
  },

  accents: [MAGENTA, CYAN],

  night: {
    sky: '#181534', fogNear: 26, fogFar: 82,
    hemiSky: '#5b4c9c', hemiGround: '#241f3d', hemiIntensity: 1.5,
    sunColor: '#a8c4ff', sunIntensity: 1.5,
    accentIntensity: 9,
    underGlow: MAGENTA, underGlowIntensity: 9,
    spot: '#dfeaff', spotIntensity: 14,
    bloom: 0.16, exposure: 1.02,
    post: POLISHED_POST_NIGHT,
  },

  day: {
    // Player-tuned Light panel (Jul 2026)
    sky: '#9ec6ef', fogNear: 10, fogFar: 135,
    hemiSky: '#eaf3ff', hemiGround: '#93a2b8', hemiIntensity: 0.98,
    sunColor: '#fff4dc', sunIntensity: 1.5,
    accentIntensity: 1.4,
    underGlow: MAGENTA, underGlowIntensity: 0.8,
    spot: '#ffffff', spotIntensity: 2.4,
    bloom: 0.24, exposure: 1.09,
    post: { vignette: 0.99, contrast: 1.08, saturation: 1.2, sharpen: 0.04 },
  },

  createBackdrop,
  createProps,

  post: { vignette: 0.99, contrast: 1.08, saturation: 1.2, sharpen: 0.04 },
  shadows: POLISHED_SHADOWS,
  gfx: polishedGfx({
    aoIntensity: 0.31,
    godrayIntensity: 0.21,
    godraySpread: 0.55,
    fillIntensity: 1.24,
    fillColor: '#d8e4ff',
    fillColorNight: '#6a78a0',
  }),
  materialSteps: 7,
}
