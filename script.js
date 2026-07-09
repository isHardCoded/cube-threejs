import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

// ---------------------------------------------------------------------------
// Cyberpunk palette
// ---------------------------------------------------------------------------
const NEON_YELLOW = '#fcee0a'
const NEON_CYAN = '#00f0ff'
const NEON_MAGENTA = '#ff2a6d'
const NIGHT = '#07030f'

// ---------------------------------------------------------------------------
// Telegram Mini App
// ---------------------------------------------------------------------------
const tg = window.Telegram?.WebApp
if (tg) {
  tg.ready()
  tg.expand()
  tg.disableVerticalSwipes?.()
  tg.setHeaderColor?.(NIGHT)
  tg.setBackgroundColor?.(NIGHT)
}

const haptic = () => tg?.HapticFeedback?.impactOccurred?.('light')
const hapticError = () => tg?.HapticFeedback?.notificationOccurred?.('error')

// ---------------------------------------------------------------------------
// Renderer / scene
// ---------------------------------------------------------------------------
const canvas = document.querySelector('canvas.webgl')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.0

const scene = new THREE.Scene()
scene.background = new THREE.Color(NIGHT)
scene.fog = new THREE.Fog(NIGHT, 22, 65)

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 140)
camera.position.set(0, 9, 10)

// ---------------------------------------------------------------------------
// Bloom
// ---------------------------------------------------------------------------
const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.42, // strength: subtle halo, not a blinding glow
  0.35, // radius
  0.6   // threshold: only truly bright things bloom
)
composer.addPass(bloom)
composer.addPass(new OutputPass())

// ---------------------------------------------------------------------------
// Lights: cold moon + neon accents
// ---------------------------------------------------------------------------
scene.add(new THREE.HemisphereLight('#2a1a4a', '#0a0614', 0.7))

const moon = new THREE.DirectionalLight('#7aa6ff', 1.5)
moon.position.set(8, 14, 6)
moon.castShadow = true
moon.shadow.mapSize.set(2048, 2048)
moon.shadow.camera.left = -12
moon.shadow.camera.right = 12
moon.shadow.camera.top = 12
moon.shadow.camera.bottom = -12
moon.shadow.camera.near = 1
moon.shadow.camera.far = 40
moon.shadow.bias = -0.0005
scene.add(moon)

const magentaLight = new THREE.PointLight(NEON_MAGENTA, 22, 25)
magentaLight.position.set(-7, 4, -7)
scene.add(magentaLight)

const cyanLight = new THREE.PointLight(NEON_CYAN, 22, 25)
cyanLight.position.set(7, 4, 7)
scene.add(cyanLight)

// magenta underglow so the platform floats over pink haze
const underGlow = new THREE.PointLight(NEON_MAGENTA, 28, 20)
underGlow.position.set(0, -4, 0)
scene.add(underGlow)

// ---------------------------------------------------------------------------
// Floating platform: dark tech tiles + neon grid
// ---------------------------------------------------------------------------
const HALF = 4                       // platform spans cells [-HALF..HALF]
const cellKey = (x, z) => `${x},${z}`

const island = new THREE.Group()
scene.add(island)

const tileGeo = new RoundedBoxGeometry(0.96, 0.3, 0.96, 2, 0.06)
const tileMatA = new THREE.MeshStandardMaterial({ color: '#181824', roughness: 0.45, metalness: 0.55 })
const tileMatB = new THREE.MeshStandardMaterial({ color: '#0f0f18', roughness: 0.45, metalness: 0.55 })
const baseMat = new THREE.MeshStandardMaterial({ color: '#0b0b14', roughness: 0.8, metalness: 0.3 })

// drop a few corner cells so the platform looks damaged / organic
const holes = new Set([
  cellKey(-HALF, -HALF), cellKey(HALF, HALF),
  cellKey(-HALF, HALF - 1), cellKey(HALF, -HALF),
])

for (let x = -HALF; x <= HALF; x++) {
  for (let z = -HALF; z <= HALF; z++) {
    if (holes.has(cellKey(x, z))) continue
    const tile = new THREE.Mesh(tileGeo, (x + z) % 2 === 0 ? tileMatA : tileMatB)
    tile.position.set(x, -0.15, z)
    tile.receiveShadow = true
    tile.castShadow = true
    island.add(tile)

    const base = new THREE.Mesh(
      new THREE.BoxGeometry(0.96, 0.9 + Math.random() * 0.8, 0.96),
      baseMat
    )
    base.position.set(x, -0.75 - base.geometry.parameters.height / 2 + 0.45, z)
    island.add(base)
  }
}

// neon grid lines over tile seams
const grid = new THREE.GridHelper(9, 9, NEON_MAGENTA, NEON_CYAN)
grid.position.y = 0.02
grid.material.transparent = true
grid.material.opacity = 0.4
grid.material.depthWrite = false
island.add(grid)

// glowing yellow frame around the platform
const barGeo = new THREE.BoxGeometry(9.14, 0.05, 0.05)
const barMat = new THREE.MeshStandardMaterial({
  color: NEON_YELLOW, emissive: NEON_YELLOW, emissiveIntensity: 1.1,
})
for (const [x, z, rot] of [[0, -4.55, 0], [0, 4.55, 0], [-4.55, 0, 1], [4.55, 0, 1]]) {
  const bar = new THREE.Mesh(barGeo, barMat)
  bar.position.set(x, 0.02, z)
  if (rot) bar.rotation.y = Math.PI / 2
  island.add(bar)
}

// ---------------------------------------------------------------------------
// Obstacles: neon pylons and tech crates (blocking is enforced server-side)
// ---------------------------------------------------------------------------
const darkMetal = new THREE.MeshStandardMaterial({ color: '#12121c', roughness: 0.35, metalness: 0.7 })
const blinkers = []   // emissive meshes that pulse over time
const holos = []      // rotating holographic shapes

function neonMat(color, intensity = 1.3) {
  return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity })
}

function addPylon(x, z, color, scale = 1, withHolo = false) {
  const g = new THREE.Group()
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 1.4, 8), darkMetal)
  pole.position.y = 0.7
  pole.castShadow = true
  g.add(pole)

  const ringMat = neonMat(color, 1.5)
  for (const y of [0.35, 0.75, 1.15]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.022, 8, 24), ringMat)
    ring.rotation.x = Math.PI / 2
    ring.position.y = y
    g.add(ring)
  }

  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 10), neonMat(NEON_MAGENTA, 1.8))
  tip.position.y = 1.48
  g.add(tip)
  blinkers.push({ mesh: tip, phase: Math.random() * Math.PI * 2, speed: 2 + Math.random() * 3 })

  if (withHolo) {
    const holo = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.22),
      new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: 1.6,
        transparent: true, opacity: 0.55, wireframe: true,
      })
    )
    holo.position.y = 2.0
    g.add(holo)
    holos.push(holo)
  }

  g.position.set(x, 0, z)
  g.scale.setScalar(scale)
  island.add(g)
}

function addCrate(x, z, color, scale = 1) {
  const g = new THREE.Group()
  const box = new THREE.Mesh(new RoundedBoxGeometry(0.55, 0.55, 0.55, 2, 0.05), darkMetal)
  box.position.y = 0.28
  box.castShadow = true
  box.receiveShadow = true
  g.add(box)

  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.57, 0.035, 0.57), neonMat(color, 1.4))
  strip.position.y = 0.42
  g.add(strip)

  g.position.set(x, 0, z)
  g.scale.setScalar(scale)
  g.rotation.y = (Math.random() - 0.5) * 0.6
  island.add(g)
}

addPylon(-HALF, 0, NEON_CYAN, 1.2, true)
addPylon(-HALF, 2, NEON_MAGENTA)
addPylon(HALF, -2, NEON_YELLOW, 1.1, true)
addPylon(2, -HALF, NEON_CYAN, 0.9)
addPylon(-2, HALF, NEON_MAGENTA, 1.15)
addPylon(HALF, 3, NEON_YELLOW, 0.85)
addCrate(0, -HALF, NEON_YELLOW, 1.1)
addCrate(HALF, 1, NEON_CYAN, 0.9)
addCrate(-3, HALF, NEON_MAGENTA)
addCrate(-HALF, -2, NEON_CYAN, 0.8)

// ---------------------------------------------------------------------------
// Night City skyline: towers with glowing windows below and around
// ---------------------------------------------------------------------------
function makeWindowTexture() {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 128
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#05050a'
  ctx.fillRect(0, 0, c.width, c.height)
  const palette = [NEON_YELLOW, NEON_CYAN, NEON_MAGENTA, '#f7f7ff']
  for (let y = 4; y < c.height - 4; y += 8) {
    for (let x = 4; x < c.width - 4; x += 8) {
      if (Math.random() < 0.32) {
        ctx.fillStyle = palette[Math.floor(Math.random() * palette.length)]
        ctx.globalAlpha = 0.4 + Math.random() * 0.6
        ctx.fillRect(x, y, 4, 5)
      }
    }
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

const windowTextures = [makeWindowTexture(), makeWindowTexture(), makeWindowTexture()]
const roofMat = new THREE.MeshStandardMaterial({ color: '#08080f', roughness: 0.9 })
const signGeo = new THREE.PlaneGeometry(1.6, 0.5)

for (let i = 0; i < 42; i++) {
  const angle = Math.random() * Math.PI * 2
  const radius = 14 + Math.random() * 20
  const w = 1.5 + Math.random() * 2.5
  const d = 1.5 + Math.random() * 2.5
  const h = 13 + Math.random() * 17

  const tex = windowTextures[i % windowTextures.length]
  const sideMat = new THREE.MeshStandardMaterial({
    map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0.85,
    color: '#ffffff', roughness: 0.9,
  })
  const tower = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    [sideMat, sideMat, roofMat, roofMat, sideMat, sideMat]
  )
  tower.position.set(Math.cos(angle) * radius, -22 + h / 2, Math.sin(angle) * radius)
  tower.rotation.y = Math.random() * Math.PI
  scene.add(tower)

  // red beacon on the tallest towers
  if (h > 26) {
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), neonMat('#ff2222', 1.8))
    beacon.position.set(tower.position.x, -22 + h + 0.15, tower.position.z)
    scene.add(beacon)
    blinkers.push({ mesh: beacon, phase: Math.random() * Math.PI * 2, speed: 3 })
  }

  // occasional neon billboard facing the platform
  if (i % 5 === 0) {
    const color = [NEON_YELLOW, NEON_CYAN, NEON_MAGENTA][i % 3]
    const sign = new THREE.Mesh(signGeo, new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 1.5, side: THREE.DoubleSide,
    }))
    sign.position.set(tower.position.x, -22 + h * (0.55 + Math.random() * 0.3), tower.position.z)
    sign.lookAt(0, sign.position.y, 0)
    sign.translateZ(Math.max(w, d) * 0.75)
    scene.add(sign)
  }
}

// ---------------------------------------------------------------------------
// Flying cars streaming around the city
// ---------------------------------------------------------------------------
const cars = []
for (let i = 0; i < 7; i++) {
  const car = new THREE.Group()
  const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.2), darkMetal)
  car.add(bodyMesh)
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.18), neonMat('#eaffff', 2))
  head.position.x = 0.26
  car.add(head)
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.18), neonMat(NEON_MAGENTA, 2))
  tail.position.x = -0.26
  car.add(tail)

  const angle = (i / 7) * Math.PI * 2
  const radius = 10 + Math.random() * 9
  car.userData = {
    angle, radius,
    speed: (0.12 + Math.random() * 0.2) * (i % 2 === 0 ? 1 : -1),
    y: -3 + Math.random() * 9,
  }
  scene.add(car)
  cars.push(car)
}

// ---------------------------------------------------------------------------
// Rain
// ---------------------------------------------------------------------------
const RAIN_COUNT = 500
const rainPos = new Float32Array(RAIN_COUNT * 3)
const rainSpeed = new Float32Array(RAIN_COUNT)
for (let i = 0; i < RAIN_COUNT; i++) {
  rainPos[i * 3] = (Math.random() - 0.5) * 40
  rainPos[i * 3 + 1] = Math.random() * 22 - 4
  rainPos[i * 3 + 2] = (Math.random() - 0.5) * 40
  rainSpeed[i] = 9 + Math.random() * 7
}
const rainGeo = new THREE.BufferGeometry()
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3))
const rain = new THREE.Points(rainGeo, new THREE.PointsMaterial({
  color: '#6fe3ff', size: 0.05, transparent: true, opacity: 0.45, depthWrite: false,
}))
scene.add(rain)

// ---------------------------------------------------------------------------
// Die factory: black chrome cube with glowing pips (opposite faces sum to 7)
// ---------------------------------------------------------------------------
const dieGeo = new RoundedBoxGeometry(1, 1, 1, 4, 0.09)
const pipGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.04, 20)
const O = 0.24
const pipLayouts = {
  1: [[0, 0]],
  2: [[-O, -O], [O, O]],
  3: [[-O, -O], [0, 0], [O, O]],
  4: [[-O, -O], [-O, O], [O, -O], [O, O]],
  5: [[-O, -O], [-O, O], [0, 0], [O, -O], [O, O]],
  6: [[-O, -O], [-O, 0], [-O, O], [O, -O], [O, 0], [O, O]],
}
// initial mesh orientation: top=1, east(+x)=3, south(+z)=2 — must match the server
const faceDefs = [
  { value: 1, normal: new THREE.Vector3(0, 1, 0) },
  { value: 6, normal: new THREE.Vector3(0, -1, 0) },
  { value: 2, normal: new THREE.Vector3(0, 0, 1) },
  { value: 5, normal: new THREE.Vector3(0, 0, -1) },
  { value: 3, normal: new THREE.Vector3(1, 0, 0) },
  { value: 4, normal: new THREE.Vector3(-1, 0, 0) },
]
const yAxis = new THREE.Vector3(0, 1, 0)

const OTHER_COLORS = [NEON_CYAN, NEON_MAGENTA, '#39ff14', '#ff9f1c', '#b26bff', '#ff5555']
const colorForId = (id) => {
  let hash = 0
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return OTHER_COLORS[hash % OTHER_COLORS.length]
}

function createDie(pipColor) {
  const group = new THREE.Group()
  const bodyMat = new THREE.MeshStandardMaterial({ color: '#0d0d13', roughness: 0.22, metalness: 0.85 })
  const body = new THREE.Mesh(dieGeo, bodyMat)
  body.castShadow = true
  body.receiveShadow = true
  group.add(body)

  const pipMat = new THREE.MeshStandardMaterial({
    color: pipColor, emissive: pipColor, emissiveIntensity: 1.5, roughness: 0.3,
  })
  for (const { value, normal } of faceDefs) {
    const quat = new THREE.Quaternion().setFromUnitVectors(yAxis, normal)
    for (const [u, v] of pipLayouts[value]) {
      const pip = new THREE.Mesh(pipGeo, pipMat)
      pip.position.set(u, 0.495, v).applyQuaternion(quat)
      pip.quaternion.copy(quat)
      group.add(pip)
    }
  }
  return { group, bodyMat }
}

// ---------------------------------------------------------------------------
// Orientation lookup: (top, east, south) -> quaternion, all 24 rotations
// ---------------------------------------------------------------------------
const orientTable = new Map()
{
  const n = new THREE.Vector3()
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) {
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(i * Math.PI / 2, j * Math.PI / 2, k * Math.PI / 2))
    let top, east, south
    for (const { value, normal } of faceDefs) {
      n.copy(normal).applyQuaternion(q)
      if (n.y > 0.9) top = value
      if (n.x > 0.9) east = value
      if (n.z > 0.9) south = value
    }
    const key = `${top},${east},${south}`
    if (!orientTable.has(key)) orientTable.set(key, q)
  }
}
const quatForOrient = (o) => orientTable.get(`${o.top},${o.east},${o.south}`)

// ---------------------------------------------------------------------------
// HP bar sprites
// ---------------------------------------------------------------------------
function createHpBar() {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 20
  const tex = new THREE.CanvasTexture(c)
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false,
  }))
  sprite.scale.set(1.0, 0.16, 1)
  scene.add(sprite)
  return { sprite, ctx: c.getContext('2d'), tex }
}

function drawHpBar(bar, hp) {
  const { ctx, tex } = bar
  const w = 128, h = 20
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = 'rgba(5,5,12,.8)'
  ctx.fillRect(0, 4, w, h - 8)
  const frac = Math.max(0, hp / 100)
  ctx.fillStyle = frac > 0.5 ? '#39ff14' : frac > 0.25 ? '#fcee0a' : '#ff2a6d'
  ctx.fillRect(2, 6, (w - 4) * frac, h - 12)
  ctx.strokeStyle = 'rgba(0,240,255,.7)'
  ctx.lineWidth = 2
  ctx.strokeRect(1, 5, w - 2, h - 10)
  tex.needsUpdate = true
}

// ---------------------------------------------------------------------------
// Damage popups
// ---------------------------------------------------------------------------
const popups = []
function spawnPopup(text, color, worldPos) {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 64
  const ctx = c.getContext('2d')
  ctx.font = 'bold 44px Verdana'
  ctx.textAlign = 'center'
  ctx.fillStyle = color
  ctx.shadowColor = color
  ctx.shadowBlur = 12
  ctx.fillText(text, 64, 48)
  const tex = new THREE.CanvasTexture(c)
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false,
  }))
  sprite.scale.set(0.9, 0.45, 1)
  sprite.position.copy(worldPos)
  scene.add(sprite)
  popups.push({ sprite, life: 1 })
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------
const players = new Map()   // id -> player object
let myId = null

const hint = document.getElementById('hint')
const statusEl = document.getElementById('status')
const hpFill = document.getElementById('hpfill')
const hpText = document.getElementById('hptext')
const dashFill = document.getElementById('dashfill')
let moved = false

let dashCooldownMs = 5000
let dashReadyAt = 0
let shake = 0               // camera shake amount

function addPlayer(data) {
  if (players.has(data.id)) return players.get(data.id)
  const isMe = data.id === myId
  const { group, bodyMat } = createDie(isMe ? NEON_YELLOW : colorForId(data.id))
  if (isMe) {
    const glow = new THREE.PointLight(NEON_YELLOW, 3, 4)
    group.add(glow)
  }
  group.position.set(data.x, 0.5, data.z)
  const q = quatForOrient(data)
  if (q) group.quaternion.copy(q)
  scene.add(group)

  const bar = createHpBar()
  drawHpBar(bar, data.hp)

  const p = {
    id: data.id, group, bodyMat, bar,
    cell: { x: data.x, z: data.z },
    hp: data.hp, dead: data.dead || false,
    queue: [], anim: null,
    flash: 0, deathAnim: null, spawnAnim: null,
  }
  if (p.dead) group.visible = false
  players.set(data.id, p)
  updateMyHud()
  return p
}

function removePlayer(id) {
  const p = players.get(id)
  if (!p) return
  scene.remove(p.group)
  scene.remove(p.bar.sprite)
  players.delete(id)
}

function updateMyHud() {
  const me = players.get(myId)
  if (!me) return
  const frac = Math.max(0, me.hp) / 100
  hpFill.style.width = `${frac * 100}%`
  hpFill.style.background = frac > 0.5 ? '#39ff14' : frac > 0.25 ? '#fcee0a' : '#ff2a6d'
  hpText.textContent = `HP ${Math.max(0, me.hp)}`
}

// ---------------------------------------------------------------------------
// Movement animation (server events drive everything)
// ---------------------------------------------------------------------------
const ROLL_TIME = 0.24
const DASH_TIME = 0.16
const smoothstep = t => t * t * (3 - 2 * t)

function enqueueMove(p, data) {
  p.queue.push(data)
  // if animations fall behind the server, fast-forward everything but the last
  while (p.queue.length > 2) applyMoveInstantly(p, p.queue.shift())
}

function applyMoveInstantly(p, m) {
  p.anim = null
  p.cell = { x: m.p.x, z: m.p.z }
  p.group.position.set(m.p.x, 0.5, m.p.z)
  const q = quatForOrient(m.p)
  if (q) p.group.quaternion.copy(q)
}

function startNextAnim(p) {
  if (p.anim || p.queue.length === 0) return
  const m = p.queue.shift()
  const dx = Math.sign(m.p.x - p.cell.x)
  const dz = Math.sign(m.p.z - p.cell.z)
  const dist = Math.abs(m.p.x - p.cell.x) + Math.abs(m.p.z - p.cell.z)

  if (m.dash || dist > 1 || dist === 0) {
    p.anim = {
      type: 'dash', t: 0,
      from: p.group.position.clone(),
      to: new THREE.Vector3(m.p.x, 0.5, m.p.z),
      dir: new THREE.Vector3(dx, 0, dz),
      target: m.p,
      time: DASH_TIME * Math.max(1, dist * 0.7),
    }
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
    p.group.position.set(a.target.x, 0.5, a.target.z)
    p.group.scale.set(1, 1, 1)
    const q = quatForOrient(a.target)
    if (q) p.group.quaternion.copy(q)
    p.anim = null
    if (p.id === myId) haptic()
    startNextAnim(p)
  }
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------
const WS_URL = import.meta.env.VITE_WS_URL
  || (location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? 'ws://localhost:8090/ws'
    : `wss://${location.host}/ws`)

let ws = null
let reconnectDelay = 500

function setStatus(text) {
  statusEl.textContent = text
  statusEl.classList.toggle('hidden', !text)
}

function connect() {
  setStatus('ПОДКЛЮЧЕНИЕ...')
  ws = new WebSocket(WS_URL)

  ws.onopen = () => {
    reconnectDelay = 500
    setStatus('')
  }

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    handleMessage(msg)
  }

  ws.onclose = () => {
    // wipe everything; the server will resend the world on reconnect
    for (const id of [...players.keys()]) removePlayer(id)
    myId = null
    setStatus('ПЕРЕПОДКЛЮЧЕНИЕ...')
    setTimeout(connect, reconnectDelay)
    reconnectDelay = Math.min(reconnectDelay * 2, 8000)
  }
}

function send(obj) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj))
}

function handleMessage(msg) {
  switch (msg.t) {
    case 'welcome': {
      myId = msg.id
      dashCooldownMs = msg.dashCooldownMs || 5000
      for (const pd of msg.players) addPlayer(pd)
      break
    }
    case 'join':
      addPlayer(msg.p)
      break
    case 'leave':
      removePlayer(msg.id)
      break
    case 'move': {
      const p = players.get(msg.p.id)
      if (!p) { addPlayer(msg.p); break }
      enqueueMove(p, msg)
      if (msg.p.id === myId && msg.dash) dashReadyAt = performance.now() + dashCooldownMs
      break
    }
    case 'hit': {
      const a = players.get(msg.a)
      const d = players.get(msg.d)
      if (a) {
        a.hp = msg.hpA
        a.flash = 1
        drawHpBar(a.bar, a.hp)
        spawnPopup(`-${msg.dmgToA}`, NEON_MAGENTA, a.group.position.clone().add(new THREE.Vector3(0, 1.4, 0)))
        // attacker lunges toward the defender
        a.lunge = { dir: new THREE.Vector3(msg.dx, 0, msg.dz), t: 0 }
      }
      if (d) {
        d.hp = msg.hpD
        d.flash = 1
        drawHpBar(d.bar, d.hp)
        spawnPopup(`-${msg.dmgToD}`, NEON_MAGENTA, d.group.position.clone().add(new THREE.Vector3(0, 1.4, 0)))
      }
      if (msg.a === myId || msg.d === myId) {
        shake = 0.35
        tg?.HapticFeedback?.impactOccurred?.('heavy')
      }
      updateMyHud()
      break
    }
    case 'death': {
      const p = players.get(msg.id)
      if (!p) break
      p.dead = true
      p.queue = []
      p.anim = null
      p.deathAnim = { t: 0 }
      if (msg.id === myId) setStatus('УНИЧТОЖЕН — РЕСПАУН...')
      break
    }
    case 'respawn': {
      const p = players.get(msg.p.id)
      if (!p) { addPlayer(msg.p); break }
      p.dead = false
      p.hp = msg.p.hp
      p.cell = { x: msg.p.x, z: msg.p.z }
      p.queue = []
      p.anim = null
      p.deathAnim = null
      p.group.visible = true
      p.group.position.set(msg.p.x, 0.5, msg.p.z)
      p.group.scale.set(1, 1, 1)
      const q = quatForOrient(msg.p)
      if (q) p.group.quaternion.copy(q)
      p.spawnAnim = { t: 0 }
      drawHpBar(p.bar, p.hp)
      if (msg.p.id === myId) setStatus('')
      updateMyHud()
      break
    }
    case 'denied':
      if (msg.reason === 'dash_cooldown') {
        hapticError()
        dashFill.parentElement.classList.add('denied')
        setTimeout(() => dashFill.parentElement.classList.remove('denied'), 300)
      }
      break
  }
}

connect()

// ---------------------------------------------------------------------------
// Input: keyboard + swipe, double-tap = dash
// ---------------------------------------------------------------------------
const DOUBLE_TAP_MS = 260
let lastDir = null
let lastDirAt = 0

function inputDir(dx, dz) {
  const now = performance.now()
  const isDouble = lastDir && lastDir[0] === dx && lastDir[1] === dz && (now - lastDirAt) < DOUBLE_TAP_MS
  lastDir = [dx, dz]
  lastDirAt = now
  if (isDouble && now >= dashReadyAt) {
    send({ t: 'dash', dx, dz })
    lastDir = null // don't chain triple-tap into two dashes
  } else {
    send({ t: 'move', dx, dz })
  }
  if (!moved) { moved = true; hint.classList.add('faded') }
}

const KEYS = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
}
window.addEventListener('keydown', (e) => {
  if (e.repeat) return
  const dir = KEYS[e.code]
  if (dir) { e.preventDefault(); inputDir(dir[0], dir[1]) }
})

let touchStart = null
window.addEventListener('pointerdown', (e) => { touchStart = { x: e.clientX, y: e.clientY } })
window.addEventListener('pointerup', (e) => {
  if (!touchStart) return
  const dx = e.clientX - touchStart.x
  const dy = e.clientY - touchStart.y
  touchStart = null
  if (Math.hypot(dx, dy) < 24) return
  if (Math.abs(dx) > Math.abs(dy)) inputDir(Math.sign(dx), 0)
  else inputDir(0, Math.sign(dy))
})

// ---------------------------------------------------------------------------
// Camera follow + resize + loop
// ---------------------------------------------------------------------------
const camOffset = new THREE.Vector3(0, 8.5, 9.5)
const camTarget = new THREE.Vector3()
const lookTarget = new THREE.Vector3(0, 0.5, 0)
const lookGoal = new THREE.Vector3()

function resize() {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  composer.setSize(window.innerWidth, window.innerHeight)
}
window.addEventListener('resize', resize)
tg?.onEvent?.('viewportChanged', resize)

const clock = new THREE.Clock()

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05)
  const t = clock.elapsedTime

  // gentle platform hover
  island.position.y = Math.sin(t * 0.6) * 0.05

  // players: movement, flashes, death/spawn animations, hp bars
  for (const p of players.values()) {
    updatePlayerAnim(p, dt)

    if (p.flash > 0) {
      p.flash = Math.max(0, p.flash - dt * 4)
      p.bodyMat.emissive.set('#ff2222')
      p.bodyMat.emissiveIntensity = p.flash * 1.2
    } else {
      p.bodyMat.emissiveIntensity = 0
    }

    if (p.lunge) {
      p.lunge.t += dt * 6
      const k = Math.sin(Math.min(p.lunge.t, 1) * Math.PI) * 0.25
      p.group.position.set(
        p.cell.x + p.lunge.dir.x * k, 0.5, p.cell.z + p.lunge.dir.z * k)
      if (p.lunge.t >= 1) {
        p.group.position.set(p.cell.x, 0.5, p.cell.z)
        p.lunge = null
      }
    }

    if (p.deathAnim) {
      p.deathAnim.t += dt * 1.6
      const k = Math.min(p.deathAnim.t, 1)
      p.group.scale.setScalar(1 - k * 0.999)
      p.group.rotation.y += dt * 10
      p.group.position.y = 0.5 + k * 1.2
      if (k >= 1) { p.group.visible = false; p.deathAnim = null }
    }

    if (p.spawnAnim) {
      p.spawnAnim.t += dt * 3
      const k = Math.min(p.spawnAnim.t, 1)
      p.group.scale.setScalar(smoothstep(k))
      if (k >= 1) { p.group.scale.set(1, 1, 1); p.spawnAnim = null }
    }

    // hp bar floats above the die (hidden while dead)
    p.bar.sprite.visible = !p.dead && p.group.visible
    p.bar.sprite.position.set(p.group.position.x, p.group.position.y + 0.95, p.group.position.z)
  }

  // damage popups float up and fade
  for (let i = popups.length - 1; i >= 0; i--) {
    const pop = popups[i]
    pop.life -= dt * 1.1
    pop.sprite.position.y += dt * 1.2
    pop.sprite.material.opacity = Math.max(0, pop.life)
    if (pop.life <= 0) {
      scene.remove(pop.sprite)
      pop.sprite.material.map.dispose()
      pop.sprite.material.dispose()
      popups.splice(i, 1)
    }
  }

  // dash cooldown HUD
  const remain = Math.max(0, dashReadyAt - performance.now())
  dashFill.style.width = `${(1 - remain / dashCooldownMs) * 100}%`

  // flying cars stream in circles, facing their direction of travel
  for (const c of cars) {
    const u = c.userData
    u.angle += u.speed * dt
    const nx = Math.cos(u.angle) * u.radius
    const nz = Math.sin(u.angle) * u.radius
    c.position.set(nx, u.y, nz)
    const ahead = u.angle + Math.sign(u.speed) * 0.05
    c.lookAt(Math.cos(ahead) * u.radius, u.y, Math.sin(ahead) * u.radius)
    c.rotateY(Math.PI / 2) // body is modeled along +x
  }

  // rain falls and wraps around
  const pos = rainGeo.attributes.position.array
  for (let i = 0; i < RAIN_COUNT; i++) {
    pos[i * 3 + 1] -= rainSpeed[i] * dt
    if (pos[i * 3 + 1] < -6) pos[i * 3 + 1] = 18
  }
  rainGeo.attributes.position.needsUpdate = true

  // pulsing beacons and rotating holograms
  for (const b of blinkers) {
    b.mesh.material.emissiveIntensity = 1.1 + Math.sin(t * b.speed + b.phase) * 0.7
  }
  for (const h of holos) {
    h.rotation.y = t * 1.2
    h.position.y = 2.0 + Math.sin(t * 2) * 0.08
  }

  // neon accent lights breathe slightly
  magentaLight.intensity = 22 + Math.sin(t * 1.7) * 4
  cyanLight.intensity = 22 + Math.cos(t * 1.3) * 4

  // camera smoothly follows my die with a subtle sway + hit shake
  const me = players.get(myId)
  const fx = me ? me.group.position.x : 0
  const fz = me ? me.group.position.z : 0
  camTarget.set(
    fx * 0.55 + Math.sin(t * 0.25) * 0.6,
    0,
    fz * 0.55
  ).add(camOffset)
  camera.position.lerp(camTarget, 1 - Math.pow(0.001, dt))
  if (shake > 0) {
    shake = Math.max(0, shake - dt * 1.4)
    camera.position.x += (Math.random() - 0.5) * shake * 0.3
    camera.position.y += (Math.random() - 0.5) * shake * 0.3
  }
  lookGoal.set(fx * 0.6, 0.5, fz * 0.6)
  lookTarget.lerp(lookGoal, 1 - Math.pow(0.001, dt))
  camera.lookAt(lookTarget)

  composer.render()
  requestAnimationFrame(tick)
}

resize()
tick()
