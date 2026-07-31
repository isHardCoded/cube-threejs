import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import {
  markCast, markReceive, POLISHED_POST, POLISHED_POST_NIGHT, POLISHED_SHADOWS, polishedGfx,
} from './gfxPolish.js'
import { blob, canvasTexture, cellRng, createDrift, geo, glow, pick, solid, toon } from './kit.js'

// Soft Hello Kitty candy world: pink + baby blue + cream white, still cel-shaded
// like the other maps — cute props, round clouds, no glossy plastic look.
const CREAM = '#fff6fb'
const PINK = '#ffb7d5'
const PINK_DEEP = '#ff8fbc'
const BLUE = '#9ad8ff'
const BLUE_DEEP = '#6bb8f0'
const WHITE = '#ffffff'
const LAVENDER = '#d4c4ff'

const decalTex = canvasTexture((ctx) => {
  ctx.fillStyle = '#fff'
  ctx.globalAlpha = 0.85
  for (let i = 0; i < 9; i++) {
    const x = 18 + (i % 3) * 40 + (i % 2) * 6
    const y = 22 + Math.floor(i / 3) * 36
    // tiny heart
    ctx.beginPath()
    ctx.moveTo(x, y + 6)
    ctx.bezierCurveTo(x - 10, y - 4, x - 14, y + 10, x, y + 16)
    ctx.bezierCurveTo(x + 14, y + 10, x + 10, y - 4, x, y + 6)
    ctx.fill()
  }
})

const padTex = canvasTexture((ctx) => {
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 8
  ctx.beginPath()
  ctx.arc(64, 64, 48, 0, Math.PI * 2)
  ctx.stroke()
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.arc(64, 64, 28, 0, Math.PI * 2)
  ctx.stroke()
  // bow knot in the middle
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.ellipse(44, 64, 14, 10, -0.4, 0, Math.PI * 2)
  ctx.ellipse(84, 64, 14, 10, 0.4, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(64, 64, 8, 0, Math.PI * 2)
  ctx.fill()
})

function createBackdrop(scene, _fx, opts = {}) {
  const castMode = opts.shadowCast || 'heavy'
  const group = new THREE.Group()
  scene.add(group)

  const floorMat = toon(CREAM)
  const hillPink = toon(PINK)
  const hillBlue = toon(BLUE)
  const cloudMat = toon(WHITE)
  const candyMat = toon(PINK_DEEP)
  const skins = [
    [floorMat, CREAM, '#2a2448'],
    [hillPink, PINK, '#6a3d6e'],
    [hillBlue, BLUE, '#3a4a7a'],
    [cloudMat, WHITE, '#8a8ab8'],
    [candyMat, PINK_DEEP, '#7a4068'],
  ]

  const sea = new THREE.Mesh(geo('kawaii:sea', () => new THREE.PlaneGeometry(220, 220)), floorMat)
  sea.rotation.x = -Math.PI / 2
  sea.position.y = -24
  markReceive(sea)
  group.add(sea)

  // Soft candy hills on the horizon
  const hillGeo = geo('kawaii:hill', () => blob(1, 1))
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2 + Math.random() * 0.15
    const radius = 18 + Math.random() * 14
    const w = 4.5 + Math.random() * 4
    const h = 2.2 + Math.random() * 1.6
    const hill = new THREE.Mesh(hillGeo, i % 2 === 0 ? hillPink : hillBlue)
    hill.scale.set(w, h, w * 0.75)
    hill.position.set(Math.cos(angle) * radius, -22, Math.sin(angle) * radius)
    hill.rotation.y = Math.random() * Math.PI
    markReceive(hill)
    group.add(hill)
  }

  // Giant marshmallow clouds
  const puffGeo = geo('kawaii:puff', () => new THREE.SphereGeometry(1, 12, 10))
  const clouds = []
  for (let i = 0; i < 7; i++) {
    const cloud = new THREE.Group()
    const count = 3 + (i % 3)
    for (let j = 0; j < count; j++) {
      const puff = new THREE.Mesh(puffGeo, cloudMat)
      puff.scale.setScalar(0.7 + Math.random() * 0.5)
      puff.position.set((j - 1) * 0.9, Math.sin(j) * 0.2, (j % 2) * 0.35)
      markCast(puff, 'heavy', castMode)
      cloud.add(puff)
    }
    const angle = (i / 7) * Math.PI * 2
    const radius = 22 + (i % 3) * 4
    cloud.position.set(Math.cos(angle) * radius, -8 + (i % 3), Math.sin(angle) * radius)
    cloud.userData = { angle, radius, y: cloud.position.y, speed: 0.04 + i * 0.008, phase: i }
    group.add(cloud)
    clouds.push(cloud)
  }

  // Floating candy balloons
  const balloons = []
  const ballGeo = geo('kawaii:balloon', () => new THREE.SphereGeometry(0.55, 12, 10))
  const stringGeo = geo('kawaii:string', () => new THREE.CylinderGeometry(0.02, 0.02, 1.4, 5))
  for (let i = 0; i < 5; i++) {
    const g = new THREE.Group()
    const ball = new THREE.Mesh(ballGeo, i % 2 === 0 ? glow(PINK, 0.35) : glow(BLUE, 0.35))
    ball.position.y = 0.9
    g.add(ball)
    const knot = new THREE.Mesh(geo('kawaii:knot', () => new THREE.SphereGeometry(0.12, 8, 6)), candyMat)
    knot.position.y = 0.35
    g.add(knot)
    const str = new THREE.Mesh(stringGeo, toon('#f0e6ff'))
    str.position.y = -0.35
    g.add(str)
    const angle = (i / 5) * Math.PI * 2 + 0.4
    const radius = 14 + (i % 2) * 3
    g.position.set(Math.cos(angle) * radius, -6 + i * 0.4, Math.sin(angle) * radius)
    g.userData = { angle, radius, y: g.position.y, speed: 0.12 + i * 0.02, phase: i * 1.3 }
    group.add(g)
    balloons.push(g)
  }

  // Soft sun / moon disc
  const discMat = new THREE.MeshBasicMaterial({ color: '#ffe0f0', fog: false })
  const hazeMat = new THREE.MeshBasicMaterial({
    color: '#ffc6e4', fog: false, transparent: true, opacity: 0.2, depthWrite: false,
  })
  const disc = new THREE.Mesh(geo('kawaii:disc', () => new THREE.CircleGeometry(3.4, 24)), discMat)
  disc.position.set(-22, -5, -28)
  disc.lookAt(0, -5, 0)
  group.add(disc)
  const haze = new THREE.Mesh(geo('kawaii:haze', () => new THREE.CircleGeometry(8.5, 24)), hazeMat)
  haze.position.set(-21.4, -5, -27.2)
  haze.lookAt(0, -5, 0)
  group.add(haze)

  const sparkles = createDrift({
    count: 220, color: '#ffffff', size: 0.07, opacity: 0.55,
    spread: 34, top: 18, bottom: -4, speed: [-0.35, -0.12], sway: 0.8,
  })
  group.add(sparkles.points)
  const confetti = createDrift({
    count: 140, color: '#ffb7d5', size: 0.1, opacity: 0.35,
    spread: 50, top: 8, bottom: -18, speed: [0.4, 1.1], sway: 1.2,
  })
  group.add(confetti.points)

  return {
    update(dt, t) {
      for (const c of clouds) {
        const u = c.userData
        u.angle += u.speed * dt
        c.position.set(
          Math.cos(u.angle) * u.radius,
          u.y + Math.sin(t * 0.5 + u.phase) * 0.35,
          Math.sin(u.angle) * u.radius,
        )
      }
      for (const b of balloons) {
        const u = b.userData
        u.angle += u.speed * dt * 0.35
        b.position.set(
          Math.cos(u.angle) * u.radius,
          u.y + Math.sin(t * 1.2 + u.phase) * 0.5,
          Math.sin(u.angle) * u.radius,
        )
        b.rotation.z = Math.sin(t * 1.5 + u.phase) * 0.12
      }
      sparkles.update(dt, t)
      confetti.update(dt, t)
    },
    setDay(day) {
      for (const [m, d, n] of skins) m.color.set(day ? d : n)
      discMat.color.set(day ? '#ffe8f4' : '#c8d0ff')
      hazeMat.color.set(day ? '#ffc6e4' : '#a8b4ff')
      hazeMat.opacity = day ? 0.22 : 0.12
      sparkles.material.opacity = day ? 0.4 : 0.55
      confetti.material.opacity = day ? 0.4 : 0.22
    },
  }
}

function createProps(fx) {
  function bow(x, z) {
    const rnd = cellRng(x, z)
    const landmark = x === 0 && z === 0
    const g = new THREE.Group()
    const mat = glow(pick(rnd, [PINK, PINK_DEEP, '#ff6fa8']), 0.45)
    const loopGeo = geo('kawaii:bowLoop', () => new THREE.SphereGeometry(0.22, 12, 10))
    const left = solid(new THREE.Mesh(loopGeo, mat))
    left.scale.set(1.2, 0.85, 0.55)
    left.position.set(-0.22, 0.42, 0)
    left.rotation.z = 0.35
    g.add(left)
    const right = solid(new THREE.Mesh(loopGeo, mat))
    right.scale.set(1.2, 0.85, 0.55)
    right.position.set(0.22, 0.42, 0)
    right.rotation.z = -0.35
    g.add(right)
    const knot = solid(new THREE.Mesh(
      geo('kawaii:bowKnot', () => new THREE.SphereGeometry(0.12, 10, 8)),
      glow(WHITE, 0.5),
    ))
    knot.position.y = 0.4
    g.add(knot)
    const ribbonGeo = geo('kawaii:ribbon', () => new RoundedBoxGeometry(0.12, 0.35, 0.06, 2, 0.04))
    for (const side of [-1, 1]) {
      const tail = solid(new THREE.Mesh(ribbonGeo, mat))
      tail.position.set(side * 0.08, 0.18, 0.02)
      tail.rotation.z = side * 0.4
      g.add(tail)
    }
    g.position.set(x, 0, z)
    g.scale.setScalar(landmark ? 1.35 : 0.9 + rnd() * 0.2)
    g.rotation.y = rnd() * Math.PI
    fx.blinkers.push({ mesh: knot, phase: rnd() * Math.PI * 2, speed: 1.1 + rnd() })
    return g
  }

  function gift(x, z) {
    const rnd = cellRng(x, z)
    const g = new THREE.Group()
    const boxCol = pick(rnd, [BLUE, PINK, LAVENDER, CREAM])
    const box = solid(new THREE.Mesh(
      geo('kawaii:gift', () => new RoundedBoxGeometry(0.55, 0.5, 0.55, 2, 0.08)),
      toon(boxCol),
    ))
    box.position.y = 0.28
    g.add(box)
    const ribbonMat = glow(pick(rnd, [PINK_DEEP, BLUE_DEEP]), 0.55)
    const bandH = solid(new THREE.Mesh(
      geo('kawaii:bandH', () => new THREE.BoxGeometry(0.58, 0.08, 0.12)), ribbonMat))
    bandH.position.y = 0.3
    g.add(bandH)
    const bandV = solid(new THREE.Mesh(
      geo('kawaii:bandV', () => new THREE.BoxGeometry(0.12, 0.08, 0.58)), ribbonMat))
    bandV.position.y = 0.3
    g.add(bandV)
    const topBow = solid(new THREE.Mesh(
      geo('kawaii:giftBow', () => new THREE.SphereGeometry(0.1, 10, 8)), ribbonMat))
    topBow.scale.set(1.4, 0.7, 0.7)
    topBow.position.y = 0.58
    g.add(topBow)
    g.position.set(x, 0, z)
    g.rotation.y = rnd() * Math.PI * 0.25
    g.scale.setScalar(0.9 + rnd() * 0.2)
    return g
  }

  function heart(x, z) {
    const rnd = cellRng(x, z)
    const landmark = x === 0 && z === 0
    const g = new THREE.Group()
    const mat = glow(pick(rnd, [PINK, PINK_DEEP, '#ff5f9e']), 0.65)
    const lobeGeo = geo('kawaii:heartLobe', () => new THREE.SphereGeometry(0.22, 12, 10))
    const left = solid(new THREE.Mesh(lobeGeo, mat))
    left.position.set(-0.14, 0.48, 0)
    g.add(left)
    const right = solid(new THREE.Mesh(lobeGeo, mat))
    right.position.set(0.14, 0.48, 0)
    g.add(right)
    const tip = solid(new THREE.Mesh(
      geo('kawaii:heartTip', () => new THREE.ConeGeometry(0.28, 0.4, 10)), mat))
    tip.position.y = 0.22
    tip.rotation.x = Math.PI
    g.add(tip)
    g.position.set(x, 0, z)
    g.scale.setScalar(landmark ? 1.4 : 0.85 + rnd() * 0.25)
    g.rotation.y = rnd() * Math.PI
    fx.holos.push(g)
    fx.blinkers.push({ mesh: left, phase: rnd() * Math.PI * 2, speed: 1.4 })
    return g
  }

  function cloud(x, z) {
    const rnd = cellRng(x, z)
    const g = new THREE.Group()
    const mat = toon(pick(rnd, [WHITE, CREAM, '#e8f6ff']))
    const puffGeo = geo('kawaii:propPuff', () => new THREE.SphereGeometry(0.22, 10, 8))
    const offsets = [[0, 0.28, 0], [-0.22, 0.22, 0.05], [0.22, 0.22, -0.04], [0, 0.42, 0.02]]
    for (const [px, py, pz] of offsets) {
      const puff = solid(new THREE.Mesh(puffGeo, mat))
      puff.position.set(px, py, pz)
      puff.scale.setScalar(0.85 + rnd() * 0.3)
      g.add(puff)
    }
    // tiny blush cheeks
    const blush = glow(PINK, 0.4)
    for (const side of [-1, 1]) {
      const cheek = new THREE.Mesh(
        geo('kawaii:blush', () => new THREE.SphereGeometry(0.06, 8, 6)), blush)
      cheek.position.set(side * 0.18, 0.26, 0.18)
      g.add(cheek)
    }
    g.position.set(x, 0, z)
    g.scale.setScalar(0.9 + rnd() * 0.2)
    return g
  }

  function candyPile(x, z) {
    const rnd = cellRng(x, z)
    const g = new THREE.Group()
    const colors = [PINK, BLUE, WHITE, LAVENDER]
    const chunkGeo = geo('kawaii:candy', () => blob(0.12, 0))
    for (let i = 0; i < 4; i++) {
      const chunk = solid(new THREE.Mesh(chunkGeo, toon(pick(rnd, colors))))
      chunk.position.set((rnd() - 0.5) * 0.45, 0.1 + rnd() * 0.15, (rnd() - 0.5) * 0.45)
      chunk.scale.setScalar(0.7 + rnd() * 0.7)
      chunk.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3)
      g.add(chunk)
    }
    g.position.set(x, 0, z)
    return g
  }

  function trampoline() {
    const g = new THREE.Group()
    const base = solid(new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.46, 0.14, 20), toon(CREAM)))
    base.position.y = 0.07
    g.add(base)
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.36, 0.05, 10, 24), glow(PINK, 0.95))
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.16
    g.add(ring)
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.3, 0.08, 20), glow(BLUE, 0.85))
    pad.position.y = 0.17
    g.add(pad)
    g.visible = false
    return { g, pad, ring, bounce: 0 }
  }

  return {
    byKind: { bow, gift, heart, cloud },
    fallback: candyPile,
    trampoline,
  }
}

export default {
  id: 'kawaii',

  surface: {
    tileA: CREAM, tileB: '#ffe9f3',
    base: '#f2c4d8',
    rim: [PINK, BLUE], rebar: '#e89ab8',
    grid: [PINK_DEEP, BLUE_DEEP],
    frame: PINK, fence: BLUE, post: WHITE,
    decal: PINK_DEEP, decalTex,
    pad: PINK, padTex,
    debris: [PINK, BLUE, WHITE],
  },

  accents: [PINK, BLUE],

  night: {
    sky: '#2a2458', fogNear: 26, fogFar: 86,
    hemiSky: '#8a7ad0', hemiGround: '#5a3860', hemiIntensity: 1.25,
    sunColor: '#ffd0ea', sunIntensity: 1.35,
    accentIntensity: 10,
    underGlow: PINK, underGlowIntensity: 9,
    spot: '#ffe8f8', spotIntensity: 11,
    bloom: 0.18, exposure: 1.02,
    post: POLISHED_POST_NIGHT,
  },

  day: {
    // Player-tuned Light panel (Jul 2026)
    sky: '#c8ecff', fogNear: 42, fogFar: 135,
    hemiSky: '#f4fbff', hemiGround: '#ffd0e6', hemiIntensity: 0.55,
    sunColor: '#fff5fb', sunIntensity: 2.7,
    accentIntensity: 1.2,
    underGlow: '#ffc0dc', underGlowIntensity: 0.7,
    spot: '#ffffff', spotIntensity: 2.2,
    bloom: 0.02, exposure: 0.86,
    post: { vignette: 0.9, contrast: 1.15, saturation: 1.2, sharpen: 0.04 },
  },

  createBackdrop,
  createProps,

  post: { vignette: 0.9, contrast: 1.15, saturation: 1.2, sharpen: 0.04 },
  shadows: POLISHED_SHADOWS,
  gfx: polishedGfx({
    aoIntensity: 0.57,
    godrayIntensity: 0.31,
    godraySpread: 1.45,
    fillIntensity: 0.77,
    fillColor: '#ffe4f0',
    fillColorNight: '#7a6a98',
  }),
  materialSteps: 7,
}
