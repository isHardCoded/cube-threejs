import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { blob, canvasTexture, cellRng, createDrift, geo, glow, pick, solid, toon } from './kit.js'

// A sun-baked cartoon oasis. This is the one map built for day mode first, so
// the palette is warm sandstone with turquoise water accents; night keeps the
// same sand but drops it under a cool moon with campfire-amber highlights.
// Rendering (shadows / AO / godrays / grade / soft toon) matches jungle until
// an authored Blender desert scene lands.
const SAND = '#e9c78d'
const SAND_DEEP = '#dbb277'
const TERRA = '#b4673f'
const AMBER = '#ffb04a'
const OASIS = '#3fd6c4'

const STONE = '#c9a274' // carved sandstone: props are a shade darker than the floor
const WOOD = '#8a6444'
const TOON = { steps: 7 }

// wind ripples in the sand, drawn light so the terracotta decal colour tints them
const decalTex = canvasTexture((ctx) => {
  ctx.strokeStyle = '#fff1d6'
  ctx.lineCap = 'round'
  for (let i = 0; i < 7; i++) {
    ctx.lineWidth = 3 + (i % 3)
    ctx.globalAlpha = 0.45 + (i % 2) * 0.4
    ctx.beginPath()
    for (let x = 0; x <= 128; x += 8) {
      const y = 12 + i * 17 + Math.sin((x / 128) * Math.PI * 2 + i * 0.8) * 5
      if (x === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
})

// a carved stone ring with radial notches for the centre landing pad
const padTex = canvasTexture((ctx) => {
  ctx.strokeStyle = '#fdf0d2'
  ctx.lineWidth = 7
  ctx.beginPath()
  ctx.arc(64, 64, 50, 0, Math.PI * 2)
  ctx.stroke()
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(64, 64, 31, 0, Math.PI * 2)
  ctx.stroke()
  ctx.lineWidth = 4
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    ctx.beginPath()
    ctx.moveTo(64 + Math.cos(a) * 34, 64 + Math.sin(a) * 34)
    ctx.lineTo(64 + Math.cos(a) * 46, 64 + Math.sin(a) * 46)
    ctx.stroke()
  }
})

function createBackdrop(scene, _fx, opts = {}) {
  const castMode = opts.shadowCast || 'heavy'
  const group = new THREE.Group()
  scene.add(group)

  // Two sand tones and one rock tone for the whole horizon: the dune ring is 18
  // meshes, and giving each its own material would cost 18 shader programs to
  // draw what reads as a single stretch of desert.
  const duneMat = toon(SAND, TOON)
  const duneShadeMat = toon(SAND_DEEP, TOON)
  const rockMat = toon('#b8703f', TOON)
  const seaMat = toon('#dcb27a', TOON)
  const trunkMat = toon(WOOD, TOON)
  const frondMat = toon('#57946a', TOON)
  const birdMat = toon('#5a4636', TOON)
  const discMat = new THREE.MeshBasicMaterial({ color: '#fff3c4', fog: false })
  const hazeMat = new THREE.MeshBasicMaterial({
    color: '#ffd89a', fog: false, transparent: true, opacity: 0.18, depthWrite: false,
  })

  // day / night skins, applied by setDay: sand goes blue-grey after sunset
  const skins = [
    [duneMat, SAND, '#5c608c'],
    [duneShadeMat, SAND_DEEP, '#4c5079'],
    [rockMat, '#b8703f', '#4d4066'],
    [seaMat, '#dcb27a', '#474c73'],
    [trunkMat, WOOD, '#3d3552'],
    [frondMat, '#57946a', '#2f5060'],
    [birdMat, '#5a4636', '#2b2842'],
  ]

  function receiveOnly(mesh, name) {
    mesh.name = name
    mesh.receiveShadow = true
    mesh.castShadow = false
    mesh.userData.shadowCastTier = 'never'
  }
  function castCore(mesh, name) {
    mesh.name = name
    mesh.receiveShadow = true
    mesh.userData.shadowCastTier = 'core'
    mesh.castShadow = true
  }
  function castHeavy(mesh, name) {
    mesh.name = name
    mesh.receiveShadow = true
    mesh.userData.shadowCastTier = 'heavy'
    mesh.castShadow = castMode === 'heavy'
  }

  // the sand sea the arena floats over
  const sea = new THREE.Mesh(geo('desert:sea', () => new THREE.PlaneGeometry(220, 220)), seaMat)
  sea.rotation.x = -Math.PI / 2
  sea.position.y = -24
  receiveOnly(sea, 'DesertSea')
  group.add(sea)

  const duneGeo = geo('desert:dune', () => blob(1, 1))
  for (let i = 0; i < 18; i++) {
    const angle = (i / 18) * Math.PI * 2 + Math.random() * 0.2
    const radius = 17 + Math.random() * 15
    const w = 5 + Math.random() * 5
    const h = 2.4 + Math.random() * 1.8
    const dune = new THREE.Mesh(duneGeo, i % 3 === 0 ? duneShadeMat : duneMat)
    dune.scale.set(w, h, w * (0.7 + Math.random() * 0.4))
    dune.position.set(Math.cos(angle) * radius, -22, Math.sin(angle) * radius)
    dune.rotation.y = Math.random() * Math.PI
    receiveOnly(dune, 'DesertDune')
    group.add(dune)
  }

  // mesas: the only backdrop shapes tall enough to break the dune line
  const mesaGeo = geo('desert:mesa', () => new THREE.CylinderGeometry(0.82, 1, 1, 7))
  const skirtGeo = geo('desert:mesaSkirt', () => new THREE.CylinderGeometry(1, 1.5, 1, 7))
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + 0.7 + Math.random() * 0.5
    const radius = 32 + Math.random() * 8
    const w = 2.4 + Math.random() * 1.6
    const h = 9 + Math.random() * 4
    const x = Math.cos(angle) * radius
    const z = Math.sin(angle) * radius
    const body = new THREE.Mesh(mesaGeo, rockMat)
    body.scale.set(w, h, w)
    body.position.set(x, -22 + h / 2, z)
    body.rotation.y = Math.random() * Math.PI
    castCore(body, 'DesertMesa')
    group.add(body)
    const skirt = new THREE.Mesh(skirtGeo, duneShadeMat)
    skirt.scale.set(w * 1.15, 3, w * 1.15)
    skirt.position.set(x, -22 + 1.5, z)
    receiveOnly(skirt, 'DesertMesaSkirt')
    group.add(skirt)
  }

  // Oasis palms on the dune ring. They sit well out: any closer and they loom
  // over the fence like giant props instead of reading as the far shore.
  const palmTrunkGeo = geo('desert:bigTrunk', () => new THREE.CylinderGeometry(0.16, 0.3, 7, 6))
  const palmCrownGeo = geo('desert:bigCrown', () => blob(1.5, 0))
  for (let i = 0; i < 4; i++) {
    const angle = -1.1 + i * 0.24
    const radius = 33 + Math.random() * 5
    const x = Math.cos(angle) * radius
    const z = Math.sin(angle) * radius
    const s = 0.8 + Math.random() * 0.5
    const trunk = new THREE.Mesh(palmTrunkGeo, trunkMat)
    trunk.scale.setScalar(s)
    trunk.position.set(x, -19.5 + 3.5 * s, z)
    trunk.rotation.z = (Math.random() - 0.5) * 0.25
    castHeavy(trunk, 'DesertPalmTrunk')
    group.add(trunk)
    // two stacked crowns: a single flat blob read as an umbrella from up here
    for (const [ly, lr] of [[7.0, 1.5], [6.4, 1.1]]) {
      const crown = new THREE.Mesh(palmCrownGeo, frondMat)
      crown.scale.set(lr * s, 0.42 * s, lr * s)
      crown.position.set(x, -19.5 + ly * s, z)
      crown.rotation.y = Math.random() * Math.PI
      castHeavy(crown, 'DesertPalmCrown')
      group.add(crown)
    }
  }

  // Low sun near the horizon: the camera looks down at the arena, so anything
  // placed above the eye line would never make it into frame.
  const disc = new THREE.Mesh(geo('desert:disc', () => new THREE.CircleGeometry(3.2, 24)), discMat)
  disc.position.set(24, -6, -30)
  disc.lookAt(0, -6, 0)
  group.add(disc)
  const haze = new THREE.Mesh(geo('desert:haze', () => new THREE.CircleGeometry(8, 24)), hazeMat)
  haze.position.set(23.2, -6, -29)
  haze.lookAt(0, -6, 0)
  group.add(haze)

  // birds: modelled pointing down -z so lookAt alone aims them
  const birds = []
  const birdGeo = geo('desert:bird', () => {
    const g = new THREE.ConeGeometry(0.55, 1.2, 3)
    g.rotateX(-Math.PI / 2)
    g.scale(1, 0.12, 1)
    return g
  })
  for (let i = 0; i < 3; i++) {
    const bird = new THREE.Mesh(birdGeo, birdMat)
    bird.userData = {
      angle: (i / 3) * Math.PI * 2,
      radius: 15 + Math.random() * 4,
      speed: 0.16 + Math.random() * 0.1,
      y: -9 + Math.random() * 5,
      phase: Math.random() * Math.PI * 2,
    }
    group.add(bird)
    birds.push(bird)
  }

  // motes lifting off the hot floor, and a heavier veil of sand far below
  const motes = createDrift({
    count: 240, color: '#ffe6b8', size: 0.075, opacity: 0.4,
    spread: 36, top: 22, bottom: -6, speed: [-0.55, -0.2], sway: 0.5,
  })
  group.add(motes.points)
  const veil = createDrift({
    count: 200, color: '#e8c990', size: 0.13, opacity: 0.22,
    spread: 62, top: -4, bottom: -21, speed: [-1.2, -0.4], sway: 1.4,
  })
  group.add(veil.points)

  return {
    update(dt, t) {
      for (const b of birds) {
        const u = b.userData
        u.angle += u.speed * dt
        const y = u.y + Math.sin(t * 0.7 + u.phase) * 0.6
        b.position.set(Math.cos(u.angle) * u.radius, y, Math.sin(u.angle) * u.radius)
        const ahead = u.angle + 0.05
        b.lookAt(Math.cos(ahead) * u.radius, y, Math.sin(ahead) * u.radius)
        b.rotateZ(Math.sin(t * 6 + u.phase) * 0.3)
      }
      motes.update(dt, t)
      veil.update(dt, t)
    },
    setDay(day) {
      for (const [m, d, n] of skins) m.color.set(day ? d : n)
      discMat.color.set(day ? '#fff3c4' : '#dfe6ff')
      hazeMat.color.set(day ? '#ffd89a' : '#9fb0ff')
      hazeMat.opacity = day ? 0.18 : 0.1
      motes.material.opacity = day ? 0.28 : 0.4
      veil.material.opacity = day ? 0.3 : 0.16
    },
  }
}

function createProps(fx) {
  const flowerColors = ['#ff8fb0', '#ffd166', '#ff9f6e']

  function cactus(x, z) {
    const rnd = cellRng(x, z)
    const landmark = x === 0 && z === 0
    const arms = rnd() < 0.35 ? 2 : 1
    const g = new THREE.Group()
    const green = toon('#63a06d', TOON)

    const trunk = solid(new THREE.Mesh(
      geo('desert:cactusTrunk', () => new THREE.CapsuleGeometry(0.17, 0.86, 6, 8)), green))
    trunk.position.y = 0.6
    g.add(trunk)

    const jointGeo = geo('desert:cactusJoint', () => new THREE.SphereGeometry(0.1, 8, 6))
    const armGeo = geo('desert:cactusArm', () => new THREE.CapsuleGeometry(0.1, 0.3, 5, 6))
    for (let i = 0; i < arms; i++) {
      const side = i === 0 ? 1 : -1
      const h = 0.5 + rnd() * 0.16
      const joint = solid(new THREE.Mesh(jointGeo, green))
      joint.position.set(side * 0.19, h, 0)
      g.add(joint)
      const arm = solid(new THREE.Mesh(armGeo, green))
      arm.position.set(side * 0.27, h + 0.23, 0)
      g.add(arm)
    }

    if (rnd() < 0.55) {
      const flower = new THREE.Mesh(
        geo('desert:flower', () => new THREE.SphereGeometry(0.055, 8, 6)),
        toon(pick(rnd, flowerColors), TOON))
      flower.position.y = 1.22
      g.add(flower)
    }

    g.position.set(x, 0, z)
    // the centre cactus grows upwards only: it still has to fit its single cell
    if (landmark) g.scale.set(1.1, 1.5, 1.1)
    else g.scale.setScalar(0.92 + rnd() * 0.16)
    g.rotation.y = rnd() * Math.PI
    return g
  }

  function palm(x, z) {
    const rnd = cellRng(x, z)
    const count = 4 + Math.floor(rnd() * 3)
    const g = new THREE.Group()

    // the lean lives on an inner group so the trunk still meets the floor
    const stalk = new THREE.Group()
    stalk.rotation.z = (rnd() - 0.5) * 0.13
    g.add(stalk)

    const trunk = solid(new THREE.Mesh(
      geo('desert:palmTrunk', () => new THREE.CylinderGeometry(0.055, 0.09, 1.6, 7)), toon(WOOD, TOON)))
    trunk.position.y = 0.8
    stalk.add(trunk)

    // flat tapered blade, baked pointing along +x so one geometry serves every frond
    const frondGeo = geo('desert:frond', () => {
      const geom = new THREE.ConeGeometry(0.075, 0.34, 4, 1)
      geom.rotateZ(-Math.PI / 2)
      geom.translate(0.17, 0, 0)
      geom.scale(1, 0.34, 1)
      return geom
    })
    const frondMat = toon('#5aa06b', TOON)
    for (let i = 0; i < count; i++) {
      const frond = new THREE.Mesh(frondGeo, frondMat)
      frond.rotation.set(0, (i / count) * Math.PI * 2 + rnd() * 0.3, -0.42 - rnd() * 0.3)
      frond.position.y = 1.58
      stalk.add(frond)
    }

    const nutGeo = geo('desert:coconut', () => new THREE.SphereGeometry(0.045, 8, 6))
    const nutMat = toon('#7a5230', TOON)
    for (const side of [-1, 1]) {
      const nut = new THREE.Mesh(nutGeo, nutMat)
      nut.position.set(side * 0.06, 1.5, 0.05)
      stalk.add(nut)
    }

    g.position.set(x, 0, z)
    g.rotation.y = rnd() * Math.PI
    return g
  }

  function rock(x, z) {
    const rnd = cellRng(x, z)
    const g = new THREE.Group()
    const mat = toon(STONE, TOON)
    const boulder = solid(new THREE.Mesh(geo('desert:rock', () => blob(0.34, 0)), mat))
    boulder.position.y = 0.29
    boulder.scale.set(1 + rnd() * 0.08, 0.82 + rnd() * 0.12, 1 + rnd() * 0.08)
    boulder.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3)
    g.add(boulder)

    const pebble = solid(new THREE.Mesh(geo('desert:pebble', () => blob(0.12, 0)), toon('#ab8055', TOON)))
    pebble.position.set((rnd() - 0.5) * 0.42, 0.09, 0.16 + rnd() * 0.14)
    pebble.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3)
    g.add(pebble)

    g.position.set(x, 0, z)
    g.rotation.y = rnd() * Math.PI
    return g
  }

  function ruin(x, z) {
    const rnd = cellRng(x, z)
    const g = new THREE.Group()
    const stone = toon(STONE, TOON)
    const carved = toon('#a67f52', TOON)

    const plinth = solid(new THREE.Mesh(
      geo('desert:ruinBase', () => new RoundedBoxGeometry(0.44, 0.14, 0.44, 2, 0.04)), stone))
    plinth.position.y = 0.07
    g.add(plinth)

    const shaft = solid(new THREE.Mesh(
      geo('desert:ruinShaft', () => new THREE.CylinderGeometry(0.14, 0.18, 0.66, 6)), stone))
    shaft.position.y = 0.47
    g.add(shaft)

    const bandGeo = geo('desert:ruinBand', () => new THREE.CylinderGeometry(0.19, 0.19, 0.05, 6))
    for (const y of [0.28, 0.62]) {
      const band = new THREE.Mesh(bandGeo, carved)
      band.position.y = y
      g.add(band)
    }

    const cap = solid(new THREE.Mesh(
      geo('desert:ruinCap', () => new THREE.ConeGeometry(0.15, 0.28, 5)), stone))
    cap.position.set(0.02, 0.92, -0.01)
    cap.rotation.set(0.14, rnd() * Math.PI, 0.1)
    g.add(cap)

    // two glyphs on opposite faces so the pillar still reads lit from any angle
    const glyphMat = glow(AMBER, 0.5)
    const glyphGeo = geo('desert:glyph', () => new THREE.BoxGeometry(0.1, 0.14, 0.02))
    for (const side of [1, -1]) {
      const glyph = new THREE.Mesh(glyphGeo, glyphMat)
      glyph.position.set(0, 0.47, side * 0.17)
      g.add(glyph)
      fx.blinkers.push({ mesh: glyph, phase: rnd() * Math.PI * 2, speed: 0.8 + rnd() * 0.9 })
    }

    g.position.set(x, 0, z)
    g.rotation.y = rnd() * Math.PI
    return g
  }

  // Rock pile: the fallback for any kind this theme does not know.
  function rockPile(x, z) {
    const rnd = cellRng(x, z)
    const g = new THREE.Group()
    const mat = toon('#bc9265', TOON)
    const chunkGeo = geo('desert:chunk', () => blob(0.13, 0))
    for (let i = 0; i < 4; i++) {
      const chunk = solid(new THREE.Mesh(chunkGeo, mat))
      chunk.position.set((rnd() - 0.5) * 0.5, 0.1 + rnd() * 0.16, (rnd() - 0.5) * 0.5)
      chunk.scale.setScalar(0.7 + rnd() * 0.8)
      chunk.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3)
      g.add(chunk)
    }
    g.position.set(x, 0, z)
    return g
  }

  // A hide drum stretched over a well mouth: the arena's spring board.
  function trampoline() {
    const g = new THREE.Group()
    const base = solid(new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.46, 0.14, 20), toon('#8a5a3c', TOON)))
    base.position.y = 0.07
    g.add(base)
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.36, 0.05, 10, 24), glow(AMBER, 0.9))
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.16
    g.add(ring)
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.3, 0.08, 20), glow(OASIS, 0.8))
    pad.position.y = 0.17
    g.add(pad)
    g.visible = false
    return { g, pad, ring, bounce: 0 }
  }

  return {
    byKind: { cactus, palm, rock, ruin },
    fallback: rockPile,
    trampoline,
  }
}

export default {
  id: 'desert',

  surface: {
    tileA: SAND, tileB: SAND_DEEP,
    tileC: '#f0d4a0', tileD: '#c9925a',
    tileBevel: 0.11, tileBevelSegs: 3,
    tileHeightJitter: 0.022,
    base: '#a2683f',
    rim: ['#b07a4c', '#8a5a3a'], rebar: '#8b6b3e',
    grid: [TERRA, '#8f5334'],
    frame: AMBER, fence: '#8fc9bb', post: WOOD,
    decal: '#b96f42', decalTex,
    pad: OASIS, padTex,
    debris: ['#c8a375', '#a67c50'],
  },

  accents: [AMBER, OASIS],

  night: {
    sky: '#1a1f47', fogNear: 28, fogFar: 110,
    hemiSky: '#4c5aa6', hemiGround: '#4a3130', hemiIntensity: 1.05,
    sunColor: '#b9c9ff', sunIntensity: 1.45,
    accentIntensity: 10,
    underGlow: '#d9915a', underGlowIntensity: 8,
    spot: '#e6eeff', spotIntensity: 9,
    bloom: 0.16, exposure: 1.02,
    post: { vignette: 0.34, contrast: 1.06, saturation: 1.03, sharpen: 0.04 },
  },

  day: {
    // Same approved lighting stack as jungle — warm desert sky/sand kept.
    sky: '#a9d6f2', fogNear: 42, fogFar: 135,
    hemiSky: '#f4faff', hemiGround: '#d8a978', hemiIntensity: 0.48,
    sunColor: '#fff0c4', sunIntensity: 4,
    accentIntensity: 0.9,
    underGlow: '#e0a468', underGlowIntensity: 0.4,
    spot: '#fff6e8', spotIntensity: 2.1,
    bloom: 0.07, exposure: 0.81,
    post: { vignette: 0.9, contrast: 1.08, saturation: 1.2, sharpen: 0.04 },
  },

  createBackdrop,
  createProps,

  post: { vignette: 0.9, contrast: 1.08, saturation: 1.2, sharpen: 0.04 },

  shadows: {
    mapSize: 2048,
    mapSizeMobile: 1024,
    extent: 56,
    extentY: 58,
    near: 2,
    far: 120,
    bias: -0.00035,
    normalBias: 0.035,
    radius: 5.5,
    follow: true,
    sunOffset: [22, 28, 18],
  },

  gfx: {
    ao: true,
    aoIntensity: 0.12,
    aoIntensityNight: 0.26,
    aoRadius: 0.3,
    godray: true,
    godrayIntensity: 0.21,
    godraySpread: 1.45,
    fillIntensity: 0.21,
    fillIntensityNight: 0.12,
    fillColor: '#ffe8c8',
    fillColorNight: '#7a8aa0',
  },

  materialSteps: 7,
}
