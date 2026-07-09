import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

// ---------------------------------------------------------------------------
// Telegram Mini App
// ---------------------------------------------------------------------------
const tg = window.Telegram?.WebApp
if (tg) {
  tg.ready()
  tg.expand()
  tg.disableVerticalSwipes?.()
  tg.setHeaderColor?.('#7eb6e8')
  tg.setBackgroundColor?.('#7eb6e8')
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
renderer.toneMappingExposure = 1.1

const SKY = new THREE.Color('#7eb6e8')
const scene = new THREE.Scene()
scene.background = SKY
scene.fog = new THREE.Fog(SKY, 26, 60)

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 120)
camera.position.set(0, 9, 10)

// ---------------------------------------------------------------------------
// Lights
// ---------------------------------------------------------------------------
scene.add(new THREE.HemisphereLight('#cfe8ff', '#8a9a5b', 0.9))

const sun = new THREE.DirectionalLight('#fff4e0', 2.2)
sun.position.set(8, 14, 6)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.camera.left = -12
sun.shadow.camera.right = 12
sun.shadow.camera.top = 12
sun.shadow.camera.bottom = -12
sun.shadow.camera.near = 1
sun.shadow.camera.far = 40
sun.shadow.bias = -0.0005
scene.add(sun)

// ---------------------------------------------------------------------------
// Floating island: checkerboard tiles + dirt base
// ---------------------------------------------------------------------------
const HALF = 4                       // island spans cells [-HALF..HALF]
const blocked = new Set()            // cells the cube cannot enter
const cellKey = (x, z) => `${x},${z}`

const island = new THREE.Group()
scene.add(island)

const tileGeo = new RoundedBoxGeometry(0.96, 0.3, 0.96, 2, 0.06)
const tileMatA = new THREE.MeshStandardMaterial({ color: '#9ed36a', roughness: 0.9 })
const tileMatB = new THREE.MeshStandardMaterial({ color: '#8bc456', roughness: 0.9 })

// drop a few corner cells so the island looks organic
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

    const dirt = new THREE.Mesh(
      new THREE.BoxGeometry(0.96, 0.9 + Math.random() * 0.8, 0.96),
      new THREE.MeshStandardMaterial({ color: '#8a6244', roughness: 1 })
    )
    dirt.position.set(x, -0.75 - dirt.geometry.parameters.height / 2 + 0.45, z)
    island.add(dirt)
  }
}

// ---------------------------------------------------------------------------
// Decorations: trees and rocks on border cells (those cells become blocked)
// ---------------------------------------------------------------------------
const treeTrunkMat = new THREE.MeshStandardMaterial({ color: '#7a5236', roughness: 1 })
const leafMats = [
  new THREE.MeshStandardMaterial({ color: '#3e8948', roughness: 0.8 }),
  new THREE.MeshStandardMaterial({ color: '#4fa457', roughness: 0.8 }),
]
const rockMat = new THREE.MeshStandardMaterial({ color: '#9aa2ad', roughness: 0.95 })

function addTree(x, z, scale = 1) {
  const g = new THREE.Group()
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 0.5, 7), treeTrunkMat)
  trunk.position.y = 0.25
  g.add(trunk)
  const mat = leafMats[Math.floor(Math.random() * leafMats.length)]
  let y = 0.62
  for (const r of [0.42, 0.32, 0.2]) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r, 0.5, 8), mat)
    cone.position.y = y
    g.add(cone)
    y += 0.32
  }
  g.traverse(o => { o.castShadow = true; o.receiveShadow = true })
  g.position.set(x, 0, z)
  g.scale.setScalar(scale)
  g.rotation.y = Math.random() * Math.PI
  island.add(g)
  blocked.add(cellKey(x, z))
}

function addRock(x, z, scale = 1) {
  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.28, 0), rockMat)
  rock.position.set(x + (Math.random() - 0.5) * 0.2, 0.14, z + (Math.random() - 0.5) * 0.2)
  rock.scale.set(scale, scale * 0.7, scale)
  rock.rotation.set(Math.random(), Math.random() * Math.PI, Math.random())
  rock.castShadow = rock.receiveShadow = true
  island.add(rock)
  blocked.add(cellKey(x, z))
}

addTree(-HALF, 0, 1.2)
addTree(-HALF, 2)
addTree(HALF, -2, 1.1)
addTree(2, -HALF, 0.9)
addTree(-2, HALF, 1.15)
addTree(HALF, 3, 0.85)
addRock(0, -HALF, 1.1)
addRock(HALF, 1, 0.9)
addRock(-3, HALF)
addRock(-HALF, -2, 0.8)

// ---------------------------------------------------------------------------
// Clouds drifting around the island
// ---------------------------------------------------------------------------
const cloudMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 })
const clouds = []
for (let i = 0; i < 8; i++) {
  const cloud = new THREE.Group()
  const n = 3 + Math.floor(Math.random() * 3)
  for (let j = 0; j < n; j++) {
    const s = 0.5 + Math.random() * 0.7
    const puff = new THREE.Mesh(new THREE.SphereGeometry(s, 12, 12), cloudMat)
    puff.position.set(j * 0.8 - n * 0.4, Math.random() * 0.25, (Math.random() - 0.5) * 0.6)
    cloud.add(puff)
  }
  const angle = (i / 8) * Math.PI * 2
  const radius = 12 + Math.random() * 8
  cloud.position.set(Math.cos(angle) * radius, -2 + Math.random() * 9, Math.sin(angle) * radius)
  cloud.userData = { angle, radius, speed: 0.02 + Math.random() * 0.03, y: cloud.position.y }
  scene.add(cloud)
  clouds.push(cloud)
}

// ---------------------------------------------------------------------------
// The die: rounded cube with pips (opposite faces sum to 7)
// ---------------------------------------------------------------------------
const cube = new THREE.Group()
scene.add(cube)

const body = new THREE.Mesh(
  new RoundedBoxGeometry(1, 1, 1, 4, 0.09),
  new THREE.MeshStandardMaterial({ color: '#f43f5e', roughness: 0.35, metalness: 0.05 })
)
body.castShadow = true
body.receiveShadow = true
cube.add(body)

const pipGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.04, 20)
const pipMat = new THREE.MeshStandardMaterial({ color: '#fff7f7', roughness: 0.4 })
const O = 0.24
const pipLayouts = {
  1: [[0, 0]],
  2: [[-O, -O], [O, O]],
  3: [[-O, -O], [0, 0], [O, O]],
  4: [[-O, -O], [-O, O], [O, -O], [O, O]],
  5: [[-O, -O], [-O, O], [0, 0], [O, -O], [O, O]],
  6: [[-O, -O], [-O, 0], [-O, O], [O, -O], [O, 0], [O, O]],
}
// face -> [value, normal axis, rotation to align pip cylinder]
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
    pip.castShadow = true
    cube.add(pip)
  }
}

// ---------------------------------------------------------------------------
// Rolling logic
// ---------------------------------------------------------------------------
const cell = { x: 0, z: 0 }
cube.position.set(cell.x, 0.5, cell.z)

const ROLL_TIME = 0.19
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
    axis: new THREE.Vector3().crossVectors(yAxis, dir).negate(), // up x dir gives -roll axis
    pivot: cube.position.clone().add(new THREE.Vector3(dx * 0.5, -0.5, dz * 0.5)),
    startPos: cube.position.clone(),
    startQuat: cube.quaternion.clone(),
    t: 0,
    target: { x: nx, z: nz },
  }
  if (!moved) { moved = true; hint.classList.add('faded') }
}

const easeOutQuad = t => t * (2 - t)

function updateRoll(dt) {
  if (!rolling) return
  rolling.t = Math.min(rolling.t + dt / ROLL_TIME, 1)
  const angle = easeOutQuad(rolling.t) * (Math.PI / 2)

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
}
window.addEventListener('resize', resize)
tg?.onEvent?.('viewportChanged', resize)

const clock = new THREE.Clock()

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05)
  const t = clock.elapsedTime

  updateRoll(dt)

  // gentle island breathing
  island.position.y = Math.sin(t * 0.6) * 0.05

  // clouds drift in circles
  for (const c of clouds) {
    c.userData.angle += c.userData.speed * dt
    c.position.x = Math.cos(c.userData.angle) * c.userData.radius
    c.position.z = Math.sin(c.userData.angle) * c.userData.radius
    c.position.y = c.userData.y + Math.sin(t * 0.4 + c.userData.radius) * 0.3
  }

  // camera smoothly follows the cube with a subtle sway
  camTarget.set(
    cube.position.x * 0.55 + Math.sin(t * 0.25) * 0.6,
    0,
    cube.position.z * 0.55
  ).add(camOffset)
  camera.position.lerp(camTarget, 1 - Math.pow(0.001, dt))
  lookTarget.lerp(new THREE.Vector3(cube.position.x * 0.6, 0.5, cube.position.z * 0.6), 1 - Math.pow(0.001, dt))
  camera.lookAt(lookTarget)

  renderer.render(scene, camera)
  requestAnimationFrame(tick)
}

resize()
tick()
