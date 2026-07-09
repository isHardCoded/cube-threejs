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
  0.85, // strength
  0.5,  // radius
  0.3   // threshold
)
composer.addPass(bloom)
composer.addPass(new OutputPass())

// ---------------------------------------------------------------------------
// Lights: cold moon + neon accents
// ---------------------------------------------------------------------------
scene.add(new THREE.HemisphereLight('#2a1a4a', '#0a0614', 0.7))

const moon = new THREE.DirectionalLight('#7aa6ff', 1.0)
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

const magentaLight = new THREE.PointLight(NEON_MAGENTA, 45, 25)
magentaLight.position.set(-7, 4, -7)
scene.add(magentaLight)

const cyanLight = new THREE.PointLight(NEON_CYAN, 45, 25)
cyanLight.position.set(7, 4, 7)
scene.add(cyanLight)

// magenta underglow so the platform floats over pink haze
const underGlow = new THREE.PointLight(NEON_MAGENTA, 60, 20)
underGlow.position.set(0, -4, 0)
scene.add(underGlow)

// ---------------------------------------------------------------------------
// Floating platform: dark tech tiles + neon grid
// ---------------------------------------------------------------------------
const HALF = 4                       // platform spans cells [-HALF..HALF]
const blocked = new Set()            // cells the cube cannot enter
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
    if (holes.has(cellKey(x, z))) {
      blocked.add(cellKey(x, z))
      continue
    }
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
  color: NEON_YELLOW, emissive: NEON_YELLOW, emissiveIntensity: 2,
})
for (const [x, z, rot] of [[0, -4.55, 0], [0, 4.55, 0], [-4.55, 0, 1], [4.55, 0, 1]]) {
  const bar = new THREE.Mesh(barGeo, barMat)
  bar.position.set(x, 0.02, z)
  if (rot) bar.rotation.y = Math.PI / 2
  island.add(bar)
}

// ---------------------------------------------------------------------------
// Obstacles: neon pylons and tech crates (their cells are blocked)
// ---------------------------------------------------------------------------
const darkMetal = new THREE.MeshStandardMaterial({ color: '#12121c', roughness: 0.35, metalness: 0.7 })
const blinkers = []   // emissive meshes that pulse over time
const holos = []      // rotating holographic shapes

function neonMat(color, intensity = 2) {
  return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity })
}

function addPylon(x, z, color, scale = 1, withHolo = false) {
  const g = new THREE.Group()
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 1.4, 8), darkMetal)
  pole.position.y = 0.7
  pole.castShadow = true
  g.add(pole)

  const ringMat = neonMat(color, 2.5)
  for (const y of [0.35, 0.75, 1.15]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.022, 8, 24), ringMat)
    ring.rotation.x = Math.PI / 2
    ring.position.y = y
    g.add(ring)
  }

  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 10), neonMat(NEON_MAGENTA, 3))
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
  blocked.add(cellKey(x, z))
}

function addCrate(x, z, color, scale = 1) {
  const g = new THREE.Group()
  const box = new THREE.Mesh(new RoundedBoxGeometry(0.55, 0.55, 0.55, 2, 0.05), darkMetal)
  box.position.y = 0.28
  box.castShadow = true
  box.receiveShadow = true
  g.add(box)

  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.57, 0.035, 0.57), neonMat(color, 2.2))
  strip.position.y = 0.42
  g.add(strip)

  g.position.set(x, 0, z)
  g.scale.setScalar(scale)
  g.rotation.y = (Math.random() - 0.5) * 0.6
  island.add(g)
  blocked.add(cellKey(x, z))
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
    map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 1.1,
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
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), neonMat('#ff2222', 3))
    beacon.position.set(tower.position.x, -22 + h + 0.15, tower.position.z)
    scene.add(beacon)
    blinkers.push({ mesh: beacon, phase: Math.random() * Math.PI * 2, speed: 3 })
  }

  // occasional neon billboard facing the platform
  if (i % 5 === 0) {
    const color = [NEON_YELLOW, NEON_CYAN, NEON_MAGENTA][i % 3]
    const sign = new THREE.Mesh(signGeo, new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 2.4, side: THREE.DoubleSide,
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
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.18), neonMat('#eaffff', 3))
  head.position.x = 0.26
  car.add(head)
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.18), neonMat(NEON_MAGENTA, 3))
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
// The die: black chrome with glowing yellow pips (opposite faces sum to 7)
// ---------------------------------------------------------------------------
const cube = new THREE.Group()
scene.add(cube)

const body = new THREE.Mesh(
  new RoundedBoxGeometry(1, 1, 1, 4, 0.09),
  new THREE.MeshStandardMaterial({ color: '#0d0d13', roughness: 0.22, metalness: 0.85 })
)
body.castShadow = true
body.receiveShadow = true
cube.add(body)

// soft glow that travels with the cube
const cubeGlow = new THREE.PointLight(NEON_YELLOW, 7, 5)
cube.add(cubeGlow)

const pipGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.04, 20)
const pipMat = new THREE.MeshStandardMaterial({
  color: NEON_YELLOW, emissive: NEON_YELLOW, emissiveIntensity: 2.4, roughness: 0.3,
})
const O = 0.24
const pipLayouts = {
  1: [[0, 0]],
  2: [[-O, -O], [O, O]],
  3: [[-O, -O], [0, 0], [O, O]],
  4: [[-O, -O], [-O, O], [O, -O], [O, O]],
  5: [[-O, -O], [-O, O], [0, 0], [O, -O], [O, O]],
  6: [[-O, -O], [-O, 0], [-O, O], [O, -O], [O, 0], [O, O]],
}
const faces = [
  { value: 1, normal: new THREE.Vector3(0, 1, 0) },
  { value: 6, normal: new THREE.Vector3(0, -1, 0) },
  { value: 2, normal: new THREE.Vector3(0, 0, 1) },
  { value: 5, normal: new THREE.Vector3(0, 0, -1) },
  { value: 3, normal: new THREE.Vector3(1, 0, 0) },
  { value: 4, normal: new THREE.Vector3(-1, 0, 0) },
]
const yAxis = new THREE.Vector3(0, 1, 0)
for (const { value, normal } of faces) {
  const quat = new THREE.Quaternion().setFromUnitVectors(yAxis, normal)
  for (const [u, v] of pipLayouts[value]) {
    const pip = new THREE.Mesh(pipGeo, pipMat)
    // place on the local XZ plane facing up, then rotate onto the face
    pip.position.set(u, 0.495, v).applyQuaternion(quat)
    pip.quaternion.copy(quat)
    cube.add(pip)
  }
}

// ---------------------------------------------------------------------------
// Rolling logic
// ---------------------------------------------------------------------------
const cell = { x: 0, z: 0 }
cube.position.set(cell.x, 0.5, cell.z)

const ROLL_TIME = 0.28
let rolling = null      // { axis, pivot, startPos, startQuat, t, target }
let queued = null       // queued direction while a roll is in progress
const hint = document.getElementById('hint')
let moved = false

function tryRoll(dx, dz) {
  if (rolling) { queued = [dx, dz]; return }
  const nx = cell.x + dx
  const nz = cell.z + dz
  if (Math.abs(nx) > HALF || Math.abs(nz) > HALF || blocked.has(cellKey(nx, nz))) {
    tg?.HapticFeedback?.notificationOccurred?.('error')
    return
  }
  const dir = new THREE.Vector3(dx, 0, dz)
  rolling = {
    axis: new THREE.Vector3().crossVectors(yAxis, dir), // up x dir = roll axis toward movement
    pivot: cube.position.clone().add(new THREE.Vector3(dx * 0.5, -0.5, dz * 0.5)),
    startPos: cube.position.clone(),
    startQuat: cube.quaternion.clone(),
    t: 0,
    target: { x: nx, z: nz },
  }
  if (!moved) { moved = true; hint.classList.add('faded') }
}

// smooth start and stop, no jerk on either end
const smoothstep = t => t * t * (3 - 2 * t)

function updateRoll(dt) {
  if (!rolling) return
  rolling.t = Math.min(rolling.t + dt / ROLL_TIME, 1)
  const angle = smoothstep(rolling.t) * (Math.PI / 2)

  const q = new THREE.Quaternion().setFromAxisAngle(rolling.axis, angle)
  cube.quaternion.copy(q).multiply(rolling.startQuat)
  cube.position.copy(rolling.startPos).sub(rolling.pivot).applyQuaternion(q).add(rolling.pivot)

  if (rolling.t >= 1) {
    cell.x = rolling.target.x
    cell.z = rolling.target.z
    cube.position.set(cell.x, 0.5, cell.z)
    // snap orientation to the nearest 90 degrees to kill drift
    const e = new THREE.Euler().setFromQuaternion(cube.quaternion)
    const snap = a => Math.round(a / (Math.PI / 2)) * (Math.PI / 2)
    cube.quaternion.setFromEuler(new THREE.Euler(snap(e.x), snap(e.y), snap(e.z)))
    rolling = null
    haptic()
    if (queued) { const [dx, dz] = queued; queued = null; tryRoll(dx, dz) }
  }
}

// ---------------------------------------------------------------------------
// Input: keyboard + swipe
// ---------------------------------------------------------------------------
const KEYS = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
}
window.addEventListener('keydown', (e) => {
  const dir = KEYS[e.code]
  if (dir) { e.preventDefault(); tryRoll(dir[0], dir[1]) }
})

let touchStart = null
window.addEventListener('pointerdown', (e) => { touchStart = { x: e.clientX, y: e.clientY } })
window.addEventListener('pointerup', (e) => {
  if (!touchStart) return
  const dx = e.clientX - touchStart.x
  const dy = e.clientY - touchStart.y
  touchStart = null
  if (Math.hypot(dx, dy) < 24) return
  if (Math.abs(dx) > Math.abs(dy)) tryRoll(Math.sign(dx), 0)
  else tryRoll(0, Math.sign(dy))
})

// ---------------------------------------------------------------------------
// Camera follow + resize + loop
// ---------------------------------------------------------------------------
const camOffset = new THREE.Vector3(0, 8.5, 9.5)
const camTarget = new THREE.Vector3()
const lookTarget = new THREE.Vector3(0, 0.5, 0)

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

  updateRoll(dt)

  // gentle platform hover
  island.position.y = Math.sin(t * 0.6) * 0.05

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
    b.mesh.material.emissiveIntensity = 1.6 + Math.sin(t * b.speed + b.phase) * 1.4
  }
  for (const h of holos) {
    h.rotation.y = t * 1.2
    h.position.y = 2.0 + Math.sin(t * 2) * 0.08
  }

  // neon accent lights breathe slightly
  magentaLight.intensity = 45 + Math.sin(t * 1.7) * 8
  cyanLight.intensity = 45 + Math.cos(t * 1.3) * 8

  // camera smoothly follows the cube with a subtle sway
  camTarget.set(
    cube.position.x * 0.55 + Math.sin(t * 0.25) * 0.6,
    0,
    cube.position.z * 0.55
  ).add(camOffset)
  camera.position.lerp(camTarget, 1 - Math.pow(0.001, dt))
  lookTarget.lerp(new THREE.Vector3(cube.position.x * 0.6, 0.5, cube.position.z * 0.6), 1 - Math.pow(0.001, dt))
  camera.lookAt(lookTarget)

  composer.render()
  requestAnimationFrame(tick)
}

resize()
tick()
