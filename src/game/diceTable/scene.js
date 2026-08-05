import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import { createDie } from '../dice.js'
import { cloneGltf, preloadGltf } from '../assets/gltf.js'

const SCENE_URL = '/assets/dice/scene.glb?v=2'
const CHAMPION_URL = '/assets/dice/golden_cube_champion.glb?v=2'
const DIE_SIZE = 0.68
const GRAVITY = -9.5
/** Play surface from Blender Plat_MainDeck top (glTF Y-up). */
const TABLE_TOP = 0.34
/** Cup hangs above the hex center, then lowers to spill. */
const CUP_HANG = { x: 0, y: 6.05, z: 0 }
/** Drop distance from hang to pour height. */
const CUP_DROP = 1.7
/** Lowest hang point — still clear of the table. */
const CUP_LOW = { x: 0, y: CUP_HANG.y - CUP_DROP, z: 0 }
/** Cup mesh vertical half-ish size for seating dice. */
const CUP_INNER_R = 1.4
const CUP_DEPTH = 2.4
/** Blender (x,y,z) -> glTF (x,z,-y) pedestal tops — desktop side staging. */
const PED_YOU = { x: -3.4, y: 0.64, z: 1.35 }
const PED_RIVAL = { x: 3.4, y: 0.64, z: 1.35 }
/** Narrow screens: tuck champions behind the table (toward −Z). */
const PED_YOU_MOBILE = { x: -1.05, y: 0.64, z: -2.55 }
const PED_RIVAL_MOBILE = { x: 1.05, y: 0.64, z: -2.55 }
/** Keep pedestal path outside the main hex (~radius 2.5 + margin). */
const PED_PATH_CLEAR = 4.15
/** Head-only champion: pedestal top + half height × scale. */
const CHAMPION_Y = 1.12
const CHAMPION_Y_MOBILE = 1.35
const CHAMPION_SCALE = 1.84
const CHAMPION_IDLE_YOU = 0.35
const CHAMPION_IDLE_RIVAL = -0.35
const CHAMPION_IDLE_YOU_MOBILE = 0.12
const CHAMPION_IDLE_RIVAL_MOBILE = -0.12
/** Width range for smooth side→back staging (px). */
const LAYOUT_WIDE = 1100
const LAYOUT_NARROW = 480

/** Player-approved desktop camera (Aug 2026). */
const CAM = {
  posX: 0.1,
  posY: 2.2,
  posZ: 9.35,
  lookX: -0.2,
  lookY: 0.45,
  lookZ: -2.15,
  fov: 37,
}

/** Pulled back so platform + both champions fit on phones. */
const CAM_MOBILE = {
  posX: 0.1,
  posY: 3.6,
  posZ: 14.2,
  lookX: 0,
  lookY: 0.85,
  lookZ: -0.35,
  fov: 44,
}

const LIGHT_DEFAULTS = {
  ambient: 1.43,
  hemi: 1.19,
  sun: 2.18,
  fill: 1.54,
  rim: 2.73,
  keyFill: 1.84,
  exposure: 2.41,
  fog: 0.01,
}
/** Mid gold of champion albedo — used to recolor without yellow→green cast. */
const CHAMPION_GOLD_REF = new THREE.Color('#ffc24a')


/**
 * Cubion Dice PvP table: full Blender scene + Golden Cube Champions.
 */
export async function createDiceTable(canvas) {
  await preloadGltf([SCENE_URL, CHAMPION_URL], { preserveMaterials: true })

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NeutralToneMapping
  renderer.toneMappingExposure = LIGHT_DEFAULTS.exposure

  const fogColor = 0x12102a
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(fogColor)
  scene.fog = new THREE.FogExp2(fogColor, LIGHT_DEFAULTS.fog)

  const camera = new THREE.PerspectiveCamera(CAM.fov, 1, 0.1, 100)
  applyCameraFraming(camera, typeof window !== 'undefined' ? window.innerWidth : 1280, typeof window !== 'undefined' ? window.innerHeight : 800)

  const ambient = new THREE.AmbientLight(0xa8b8ff, LIGHT_DEFAULTS.ambient)
  scene.add(ambient)
  const hemi = new THREE.HemisphereLight(0xc8d8ff, 0x2a1848, LIGHT_DEFAULTS.hemi)
  scene.add(hemi)
  const sun = new THREE.DirectionalLight(0xfff0dd, LIGHT_DEFAULTS.sun)
  sun.position.set(3.5, 9, 4)
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 40
  sun.shadow.camera.left = -14
  sun.shadow.camera.right = 14
  sun.shadow.camera.top = 14
  sun.shadow.camera.bottom = -14
  scene.add(sun)
  const fill = new THREE.DirectionalLight(0x77eeff, LIGHT_DEFAULTS.fill)
  fill.position.set(-5, 4, -1)
  scene.add(fill)
  const rimLight = new THREE.PointLight(0xff55cc, LIGHT_DEFAULTS.rim, 22, 2)
  rimLight.position.set(0, 2.6, -1.5)
  scene.add(rimLight)
  const keyFill = new THREE.PointLight(0x88aaff, LIGHT_DEFAULTS.keyFill, 24, 2)
  keyFill.position.set(0, 5, 4)
  scene.add(keyFill)

  const lightTweaks = { ...LIGHT_DEFAULTS }
  applyLightTweaks({
    renderer, scene, ambient, hemi, sun, fill, rimLight, keyFill, fogColor,
  }, lightTweaks)

  const worldRoot = cloneGltf(SCENE_URL)
  let youPedestal = null
  let rivalPedestal = null
  if (worldRoot) {
    stripWorldBackdrop(worldRoot)
    boostPlatformNeon(worldRoot)
    youPedestal = extractPlayerPedestal(worldRoot, 'PlayerYou')
    rivalPedestal = extractPlayerPedestal(worldRoot, 'PlayerRival')
    scene.add(worldRoot)
    if (youPedestal) scene.add(youPedestal)
    if (rivalPedestal) scene.add(rivalPedestal)
  } else {
    console.warn('[dice] scene.glb missing — hex platform fallback')
    scene.add(buildHexPlatform().group)
  }

  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, GRAVITY, 0) })
  world.allowSleep = true
  world.broadphase = new CANNON.NaiveBroadphase()
  world.solver.iterations = 20
  world.defaultContactMaterial.friction = 0.85
  world.defaultContactMaterial.restitution = 0.02
  const diceMat = new CANNON.Material('dice')
  const groundMat = new CANNON.Material('ground')
  const cupMat = new CANNON.Material('cup')
  world.addContactMaterial(new CANNON.ContactMaterial(diceMat, groundMat, {
    friction: 0.95,
    restitution: 0.02,
    contactEquationStiffness: 1e8,
    contactEquationRelaxation: 3,
  }))
  world.addContactMaterial(new CANNON.ContactMaterial(diceMat, cupMat, {
    friction: 0.18,
    restitution: 0.15,
    contactEquationStiffness: 1e7,
    contactEquationRelaxation: 3,
  }))
  world.addContactMaterial(new CANNON.ContactMaterial(diceMat, diceMat, {
    friction: 0.35,
    restitution: 0.05,
  }))

  // Physics top must match Blender deck top
  const groundHalfH = 0.6
  const groundBody = new CANNON.Body({
    type: CANNON.Body.STATIC,
    material: groundMat,
    shape: new CANNON.Box(new CANNON.Vec3(3.2, groundHalfH, 3.2)),
  })
  groundBody.position.set(0, TABLE_TOP - groundHalfH, 0)
  world.addBody(groundBody)
  addRailBodies(world, groundMat, TABLE_TOP)

  const youChar = placeChampion(CHAMPION_URL, {
    x: PED_YOU.x,
    y: CHAMPION_Y,
    z: PED_YOU.z,
    rotY: CHAMPION_IDLE_YOU,
    tint: '#2f7dff',
  })
  const rivalChar = placeChampion(CHAMPION_URL, {
    x: PED_RIVAL.x,
    y: CHAMPION_Y,
    z: PED_RIVAL.z,
    rotY: CHAMPION_IDLE_RIVAL,
    tint: '#ff8a2a',
  })
  if (youChar) scene.add(youChar)
  if (rivalChar) scene.add(rivalChar)
  let lookBlend = 0
  let layoutBlend = layoutFactorFromWidth(
    typeof window !== 'undefined' ? window.innerWidth : LAYOUT_WIDE,
  )
  let layoutTarget = layoutBlend
  const lookTarget = new THREE.Vector3(CUP_HANG.x, CUP_HANG.y, CUP_HANG.z)
  const lookScratch = new THREE.Vector3()
  const youSlot = { x: PED_YOU.x, y: CHAMPION_Y, z: PED_YOU.z, yaw: CHAMPION_IDLE_YOU }
  const rivalSlot = { x: PED_RIVAL.x, y: CHAMPION_Y, z: PED_RIVAL.z, yaw: CHAMPION_IDLE_RIVAL }
  computeChampionSlots(layoutBlend)
  if (youChar) {
    youChar.position.set(youSlot.x, youSlot.y, youSlot.z)
    youChar.userData.yaw = youSlot.yaw
    youChar.userData.pitch = 0
    youChar.rotation.y = youSlot.yaw
  }
  if (rivalChar) {
    rivalChar.position.set(rivalSlot.x, rivalSlot.y, rivalSlot.z)
    rivalChar.userData.yaw = rivalSlot.yaw
    rivalChar.userData.pitch = 0
    rivalChar.rotation.y = rivalSlot.yaw
  }
  if (youPedestal) {
    youPedestal.position.set(youSlot.x - PED_YOU.x, 0, youSlot.z - PED_YOU.z)
  }
  if (rivalPedestal) {
    rivalPedestal.position.set(rivalSlot.x - PED_RIVAL.x, 0, rivalSlot.z - PED_RIVAL.z)
  }

  const cup = buildCup()
  cup.group.position.set(CUP_HANG.x, CUP_HANG.y, CUP_HANG.z)
  scene.add(cup.group)

  // Hollow cup collider (bottom + ring of wall boxes) — kinematic, follows the mesh
  const cupBody = new CANNON.Body({
    type: CANNON.Body.KINEMATIC,
    material: cupMat,
    mass: 0,
  })
  {
    const h = CUP_DEPTH
    // Walls sit near the visual shell so the hollow stays roomy for two dice
    const midR = CUP_INNER_R * 0.98
    const botR = CUP_INNER_R * 0.78
    cupBody.addShape(
      new CANNON.Box(new CANNON.Vec3(botR, 0.045, botR)),
      new CANNON.Vec3(0, -h * 0.5 + 0.02, 0),
    )
    const segs = 16
    const wallHalfH = h * 0.47
    const wallThick = 0.06
    const wallHalfW = (Math.PI * midR) / segs + 0.02
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2
      const q = new CANNON.Quaternion()
      q.setFromEuler(0, -a, 0)
      cupBody.addShape(
        new CANNON.Box(new CANNON.Vec3(wallHalfW, wallHalfH, wallThick * 0.5)),
        new CANNON.Vec3(Math.cos(a) * midR, 0, Math.sin(a) * midR),
        q,
      )
    }
  }
  world.addBody(cupBody)
  cupBody.position.set(CUP_HANG.x, CUP_HANG.y, CUP_HANG.z)

  const diceDefs = [
    { body: '#3de7ff', pip: '#0a3040' },
    { body: '#ff4ad2', pip: '#3a0a30' },
  ]
  const dice = diceDefs.map((skin) => {
    const visual = createDie(
      { ...skin, metalness: 0.2, roughness: 0.45 },
      { pips: true, face: false },
    )
    visual.group.scale.setScalar(DIE_SIZE)
    cup.group.add(visual.group)

    const half = DIE_SIZE * 0.49
    const body = new CANNON.Body({
      mass: 0.45,
      material: diceMat,
      shape: new CANNON.Box(new CANNON.Vec3(half, half, half)),
      linearDamping: 0.45,
      angularDamping: 0.55,
      allowSleep: true,
      sleepSpeedLimit: 0.08,
      sleepTimeLimit: 0.2,
    })
    world.addBody(body)
    return { visual, body, local: new THREE.Vector3(), frozen: false }
  })

  let mode = 'ready' // ready | shaking | lowering | settling | settled
  let shakeT = 0
  let settleTimer = 0
  let settleCb = null
  let cupSpin = 0
  let lowerT = 0
  let spilled = false
  let disposed = false
  let raf = 0
  let last = performance.now()
  const _worldPos = new THREE.Vector3()
  const _worldQuat = new THREE.Quaternion()
  let physicsAcc = 0

  function onSettle(cb) { settleCb = cb }

  function getState() {
    return { mode, values: dice.map((d) => readTopFace(d.body)) }
  }

  function seatDiceInCup(jitter = 0) {
    // Side-by-side with a clear gap so they don't jam against each other
    const halfGap = DIE_SIZE * 0.62
    const nestY = -CUP_DEPTH * 0.5 + DIE_SIZE * 0.55 + 0.05
    dice.forEach((d, i) => {
      const side = i === 0 ? -1 : 1
      d.frozen = false
      d.local.set(
        side * halfGap + (Math.random() - 0.5) * jitter * 0.15,
        nestY + (Math.random() - 0.5) * jitter * 0.1,
        (Math.random() - 0.5) * jitter * 0.15,
      )
      d.visual.group.position.copy(d.local)
      d.visual.group.rotation.set(
        (Math.random() - 0.5) * 0.35,
        Math.random() * Math.PI * 2,
        (Math.random() - 0.5) * 0.35,
      )
    })
  }

  function syncCupBody(dt = 1 / 60) {
    cup.group.updateMatrixWorld(true)
    const px = cup.group.position.x
    const py = cup.group.position.y
    const pz = cup.group.position.z
    const inv = Math.max(1e-4, dt)
    cupBody.velocity.set(
      (px - cupBody.position.x) / inv,
      (py - cupBody.position.y) / inv,
      (pz - cupBody.position.z) / inv,
    )
    // Visual tip is around X; feed kinematic spin so walls scoop dice toward the mouth
    const prevX = 2 * Math.atan2(cupBody.quaternion.x, cupBody.quaternion.w)
    cupBody.angularVelocity.set((cup.group.rotation.x - prevX) / inv, 0, 0)
    cupBody.position.set(px, py, pz)
    cupBody.quaternion.set(
      cup.group.quaternion.x,
      cup.group.quaternion.y,
      cup.group.quaternion.z,
      cup.group.quaternion.w,
    )
  }

  function freezeDie(d) {
    if (d.frozen) return
    d.frozen = true
    d.body.velocity.setZero()
    d.body.angularVelocity.setZero()
    d.body.type = CANNON.Body.KINEMATIC
    d.body.allowSleep = true
    d.body.sleep()
  }

  function attachDiceToCup() {
    dice.forEach((d) => {
      d.frozen = false
      if (d.visual.group.parent !== cup.group) cup.group.attach(d.visual.group)
      d.body.type = CANNON.Body.KINEMATIC
      d.body.velocity.setZero()
      d.body.angularVelocity.setZero()
      d.body.allowSleep = false
    })
  }

  function releaseDiceToWorld() {
    cup.group.updateMatrixWorld(true)
    dice.forEach((d) => {
      d.frozen = false
      d.visual.group.updateMatrixWorld(true)
      d.visual.group.getWorldPosition(_worldPos)
      d.visual.group.getWorldQuaternion(_worldQuat)
      scene.attach(d.visual.group)
      d.visual.group.position.copy(_worldPos)
      d.visual.group.quaternion.copy(_worldQuat)
      d.body.position.set(_worldPos.x, _worldPos.y, _worldPos.z)
      d.body.quaternion.set(_worldQuat.x, _worldQuat.y, _worldQuat.z, _worldQuat.w)
      d.body.velocity.setZero()
      d.body.angularVelocity.setZero()
      d.body.type = CANNON.Body.DYNAMIC
      d.body.allowSleep = true
      d.body.wakeUp()
    })
  }

  function applyCupLowerPose(t) {
    // Smooth continuous pose for the whole 0..1 pour — never jump mid-anim
    const ease = t * t * (3 - 2 * t)
    cup.group.position.set(
      CUP_HANG.x,
      CUP_HANG.y + (CUP_LOW.y - CUP_HANG.y) * ease,
      CUP_HANG.z,
    )
    cup.group.rotation.x = ease * Math.PI
    cup.group.rotation.z = Math.sin(ease * Math.PI) * 0.08
    cup.group.rotation.y *= 0.9
  }

  function resetDiceInCup() {
    mode = 'ready'
    cupSpin = 0
    lowerT = 0
    spilled = false
    settleTimer = 0
    physicsAcc = 0
    cup.group.position.set(CUP_HANG.x, CUP_HANG.y, CUP_HANG.z)
    cup.group.rotation.set(0, 0, 0)
    attachDiceToCup()
    seatDiceInCup(0.02)
  }

  function shake(intensity = 1) {
    if (mode === 'lowering' || mode === 'settling') return
    if (mode === 'settled') resetDiceInCup()
    mode = 'shaking'
    attachDiceToCup()
    shakeT = Math.max(shakeT, 0.5 * intensity)
    seatDiceInCup(0.05 * intensity)
    cupSpin += (Math.random() > 0.5 ? 1 : -1) * (1.4 + Math.random()) * intensity
  }

  function throwDice() {
    if (mode === 'lowering' || mode === 'settling') return
    if (mode === 'settled') resetDiceInCup()
    mode = 'lowering'
    lowerT = 0
    spilled = false
    settleTimer = 0
    cupSpin *= 0.1
    attachDiceToCup()
  }

  function spillDice() {
    if (spilled) return
    spilled = true
    syncCupBody(1 / 60)
    // Leave from real cup pose — walls keep them in until they pour from the mouth
    releaseDiceToWorld()
    const pour = new THREE.Vector3(0, 1, 0).applyQuaternion(cup.group.quaternion)
    dice.forEach((d, i) => {
      const side = i === 0 ? -1 : 1
      // Gentle pour out the mouth — small enough not to tunnel, enough to unjam
      d.body.velocity.set(
        pour.x * 0.9 + side * 0.35,
        pour.y * 0.9 + 0.15,
        pour.z * 0.9,
      )
      d.body.angularVelocity.set(
        (Math.random() - 0.5) * 3,
        (Math.random() - 0.5) * 3,
        (Math.random() - 0.5) * 2.5,
      )
      d.body.wakeUp()
    })
  }

  function setSize(w, h) {
    if (w < 1 || h < 1) return
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    layoutTarget = layoutFactorFromWidth(w)
    applyCameraFraming(camera, w, h)
  }

  function computeChampionSlots(t) {
    const u = t * t * (3 - 2 * t)
    const youPos = pedestalArcPos(PED_YOU, PED_YOU_MOBILE, u)
    const rivalPos = pedestalArcPos(PED_RIVAL, PED_RIVAL_MOBILE, u)
    youSlot.x = youPos.x
    youSlot.y = THREE.MathUtils.lerp(CHAMPION_Y, CHAMPION_Y_MOBILE, u)
    youSlot.z = youPos.z
    youSlot.yaw = THREE.MathUtils.lerp(CHAMPION_IDLE_YOU, CHAMPION_IDLE_YOU_MOBILE, u)
    rivalSlot.x = rivalPos.x
    rivalSlot.y = THREE.MathUtils.lerp(CHAMPION_Y, CHAMPION_Y_MOBILE, u)
    rivalSlot.z = rivalPos.z
    rivalSlot.yaw = THREE.MathUtils.lerp(CHAMPION_IDLE_RIVAL, CHAMPION_IDLE_RIVAL_MOBILE, u)
  }

  attachDiceToCup()
  seatDiceInCup(0.02)

  function tick(now) {
    if (disposed) return
    raf = requestAnimationFrame(tick)
    const dt = Math.min(0.033, (now - last) / 1000)
    last = now

    if (mode === 'shaking') {
      shakeT -= dt
      cup.group.position.y = CUP_HANG.y + Math.sin(now * 0.003) * 0.04
      cup.group.rotation.z = Math.sin(now * 0.04) * 0.32
      cup.group.rotation.x = Math.sin(now * 0.05) * 0.18
      cup.group.rotation.y += cupSpin * dt * 2.2
      cupSpin *= 0.96
      const nestY = -CUP_DEPTH * 0.5 + DIE_SIZE * 0.55 + 0.05
      const halfGap = DIE_SIZE * 0.62
      dice.forEach((d, i) => {
        const side = i === 0 ? -1 : 1
        const phase = now * 0.018 + i * 1.9
        d.visual.group.position.set(
          side * halfGap + Math.sin(phase) * 0.03,
          nestY + Math.abs(Math.cos(phase * 1.2)) * 0.05,
          Math.sin(phase * 0.9) * 0.03,
        )
        d.visual.group.rotation.set(
          Math.sin(phase) * 0.4,
          phase * 0.5,
          Math.cos(phase * 0.8) * 0.35,
        )
      })
      if (shakeT <= 0) {
        mode = 'ready'
        cup.group.rotation.set(0, cup.group.rotation.y, 0)
        seatDiceInCup(0.02)
      }
    } else if (mode === 'lowering') {
      // Continuous pour; release once mouth tips down so dice exit the open end
      lowerT = Math.min(1, lowerT + dt / 1.4)
      applyCupLowerPose(lowerT)
      if (lowerT >= 0.68) spillDice()
      if (lowerT >= 1) {
        mode = 'settling'
        settleTimer = 0
      }
    } else if (mode === 'settling' || mode === 'settled') {
      // Hold inverted cup, gentle lift — never snap
      const hold = Math.min(1, settleTimer * 0.55)
      cup.group.position.set(CUP_LOW.x, CUP_LOW.y + hold * 0.3, CUP_LOW.z)
      cup.group.rotation.x = Math.PI
      cup.group.rotation.z *= 0.92
    } else {
      // ready: hang and gentle sway
      cup.group.position.y = CUP_HANG.y + Math.sin(now * 0.0024) * 0.05
      cup.group.position.x = CUP_HANG.x
      cup.group.position.z = CUP_HANG.z
      cup.group.rotation.z = Math.sin(now * 0.0018) * 0.07
      cup.group.rotation.x *= 0.85
      cup.group.rotation.y += cupSpin * dt
      cupSpin *= 0.9
    }

    syncCupBody(dt)

    if (spilled && (mode === 'lowering' || mode === 'settling')) {
      // One fixed step per frame — never catch-up multiple steps (that skips the fall)
      physicsAcc += dt
      const step = 1 / 60
      if (physicsAcc >= step) {
        world.step(step)
        physicsAcc -= step
        if (physicsAcc > step) physicsAcc = step * 0.5
      }

      const minY = TABLE_TOP + DIE_SIZE * 0.5
      let allStill = true
      dice.forEach((d) => {
        if (!d.frozen) {
          // Soft floor only — don't kill downward motion until contact
          if (d.body.position.y < minY) {
            d.body.position.y = minY
            if (d.body.velocity.y < 0) d.body.velocity.y *= -0.15
          }
          const speed = d.body.velocity.length()
          const spin = d.body.angularVelocity.length()
          const onTable = d.body.position.y <= minY + 0.03
          if (onTable && speed < 0.55) {
            d.body.velocity.x *= 0.82
            d.body.velocity.z *= 0.82
            d.body.angularVelocity.x *= 0.82
            d.body.angularVelocity.y *= 0.82
            d.body.angularVelocity.z *= 0.82
          }
          // Freeze only after a real settle on the table — never mid-air
          if (onTable && speed + spin < 0.12) {
            freezeDie(d)
          } else {
            allStill = false
          }
        }
        d.visual.group.position.copy(d.body.position)
        d.visual.group.quaternion.set(
          d.body.quaternion.x, d.body.quaternion.y, d.body.quaternion.z, d.body.quaternion.w,
        )
      })

      if (mode === 'settling') {
        settleTimer += dt
        if ((allStill && settleTimer > 0.4) || settleTimer > 3.5) {
          mode = 'settled'
          dice.forEach(freezeDie)
          settleCb?.(getState().values)
        }
      }
    }

    layoutBlend += (layoutTarget - layoutBlend) * Math.min(1, dt * 5.5)
    computeChampionSlots(layoutBlend)

    const bob = Math.sin(now * 0.003) * 0.04
    if (youChar) {
      youChar.position.set(youSlot.x, youSlot.y + bob, youSlot.z)
    }
    if (rivalChar) {
      rivalChar.position.set(rivalSlot.x, rivalSlot.y - bob * 0.7, rivalSlot.z)
    }
    if (youPedestal) {
      youPedestal.position.set(youSlot.x - PED_YOU.x, 0, youSlot.z - PED_YOU.z)
    }
    if (rivalPedestal) {
      rivalPedestal.position.set(rivalSlot.x - PED_RIVAL.x, 0, rivalSlot.z - PED_RIVAL.z)
    }

    // Smooth look: watch dice while pouring / falling, ease back after settle
    const wantLook = (mode === 'lowering' || mode === 'settling') ? 1 : 0
    const lookSpeed = wantLook > lookBlend ? 1.35 : 1.75
    lookBlend += (wantLook - lookBlend) * Math.min(1, dt * lookSpeed)

    if (spilled && dice.length) {
      lookTarget.set(0, 0, 0)
      dice.forEach((d) => {
        d.visual.group.getWorldPosition(lookScratch)
        lookTarget.add(lookScratch)
      })
      lookTarget.multiplyScalar(1 / dice.length)
    } else {
      lookTarget.copy(cup.group.position)
    }
    orientChampionSmooth(youChar, youSlot.yaw, lookBlend, lookTarget, dt)
    orientChampionSmooth(rivalChar, rivalSlot.yaw, lookBlend, lookTarget, dt)

    renderer.render(scene, camera)
  }
  raf = requestAnimationFrame(tick)

  function dispose() {
    disposed = true
    cancelAnimationFrame(raf)
    world.bodies.slice().forEach((b) => world.removeBody(b))
    scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose?.()
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.())
        else obj.material.dispose?.()
      }
    })
    renderer.dispose()
  }

  return {
    setSize,
    dispose,
    shake,
    throwDice,
    resetDiceInCup,
    getState,
    onSettle,
  }
}

function layoutFactorFromWidth(w) {
  return THREE.MathUtils.clamp((LAYOUT_WIDE - w) / (LAYOUT_WIDE - LAYOUT_NARROW), 0, 1)
}

/** Arc around the main platform (XZ): never cut through the hex. */
function pedestalArcPos(from, to, u) {
  const a0 = Math.atan2(from.x, from.z)
  const a1 = Math.atan2(to.x, to.z)
  let da = a1 - a0
  while (da > Math.PI) da -= Math.PI * 2
  while (da < -Math.PI) da += Math.PI * 2
  const a = a0 + da * u
  const r0 = Math.hypot(from.x, from.z)
  const r1 = Math.hypot(to.x, to.z)
  const rBase = THREE.MathUtils.lerp(r0, r1, u)
  // Mid-path push-out only (endpoints stay exact)
  const mid = Math.sin(Math.PI * u)
  const r = rBase + mid * Math.max(0, PED_PATH_CLEAR - rBase)
  return {
    x: Math.sin(a) * r,
    z: Math.cos(a) * r,
  }
}

function applyCameraFraming(camera, w, h) {
  const aspect = w / Math.max(1, h)
  const mobile = layoutFactorFromWidth(w)
  const tall = aspect < 0.55 ? 1 : 0
  camera.fov = THREE.MathUtils.lerp(CAM.fov, CAM_MOBILE.fov, mobile) + tall * 3
  camera.position.set(
    THREE.MathUtils.lerp(CAM.posX, CAM_MOBILE.posX, mobile),
    THREE.MathUtils.lerp(CAM.posY, CAM_MOBILE.posY, mobile) + tall * 0.4,
    THREE.MathUtils.lerp(CAM.posZ, CAM_MOBILE.posZ, mobile) + tall * 1.6,
  )
  camera.lookAt(
    THREE.MathUtils.lerp(CAM.lookX, CAM_MOBILE.lookX, mobile),
    THREE.MathUtils.lerp(CAM.lookY, CAM_MOBILE.lookY, mobile),
    THREE.MathUtils.lerp(CAM.lookZ, CAM_MOBILE.lookZ, mobile),
  )
  camera.updateProjectionMatrix()
}

/** Pull PlayerYou_* / PlayerRival_* into a movable group (world positions preserved). */
function extractPlayerPedestal(root, prefix) {
  const nodes = []
  root.traverse((obj) => {
    if (obj.name && obj.name.startsWith(prefix)) nodes.push(obj)
  })
  if (!nodes.length) return null
  root.updateMatrixWorld(true)
  const g = new THREE.Group()
  g.name = `${prefix}_Pedestal`
  for (const obj of nodes) {
    obj.updateMatrixWorld(true)
    const pos = new THREE.Vector3()
    const quat = new THREE.Quaternion()
    const scl = new THREE.Vector3()
    obj.matrixWorld.decompose(pos, quat, scl)
    obj.parent?.remove(obj)
    g.add(obj)
    obj.position.copy(pos)
    obj.quaternion.copy(quat)
    obj.scale.copy(scl)
  }
  return g
}

function lerpAngle(a, b, t) {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

function orientChampionSmooth(char, idleY, blend, focus, dt) {
  if (!char) return
  const dx = focus.x - char.position.x
  const dy = focus.y - char.position.y
  const dz = focus.z - char.position.z
  const yawLook = Math.atan2(dx, dz)
  const horiz = Math.hypot(dx, dz) || 1
  const pitchLook = THREE.MathUtils.clamp(-Math.atan2(dy, horiz), -0.55, 0.15)
  const yawGoal = THREE.MathUtils.lerp(idleY, yawLook, blend)
  const pitchGoal = THREE.MathUtils.lerp(0, pitchLook, blend)
  const turn = Math.min(1, dt * 3.2)
  char.userData.yaw = lerpAngle(char.userData.yaw ?? idleY, yawGoal, turn)
  char.userData.pitch = THREE.MathUtils.lerp(char.userData.pitch ?? 0, pitchGoal, turn)
  char.rotation.y = char.userData.yaw
  char.rotation.x = char.userData.pitch
}

function stripWorldBackdrop(root) {
  root.traverse((obj) => {
    const n = obj.name || ''
    if (!n) return
    if (
      n.startsWith('Env_Bldg')
      || n.startsWith('Env_BldgMid')
      || n.startsWith('Env_Casino')
      || n.startsWith('Env_Cloud')
      || n.startsWith('Env_Island')
      || n.startsWith('Env_Tree')
      || n.startsWith('Env_Detail')
      || n.startsWith('Env_Sign')
      || n.startsWith('Env_Ground')
      || n.startsWith('Env_')
    ) {
      obj.visible = false
    }
  })
}

function applyLightTweaks(refs, tweaks) {
  const {
    renderer, scene, ambient, hemi, sun, fill, rimLight, keyFill, fogColor,
  } = refs
  ambient.intensity = tweaks.ambient
  hemi.intensity = tweaks.hemi
  sun.intensity = tweaks.sun
  fill.intensity = tweaks.fill
  rimLight.intensity = tweaks.rim
  keyFill.intensity = tweaks.keyFill
  renderer.toneMappingExposure = tweaks.exposure
  if (scene.fog) {
    scene.fog.color.setHex(fogColor)
    scene.fog.density = tweaks.fog
  }
  scene.background?.setHex?.(fogColor)
}

function placeChampion(url, { x, y, z, rotY = 0, tint = '#ffffff', scale = CHAMPION_SCALE }) {
  const root = cloneGltf(url)
  if (!root) {
    console.warn('[dice] golden_cube_champion.glb missing')
    return null
  }
  // Albedo = map * color. Gold map × cyan → green; divide out gold mid so tint hue wins.
  const want = new THREE.Color(tint)
  const tintColor = new THREE.Color(
    Math.min(3, want.r / Math.max(0.001, CHAMPION_GOLD_REF.r)),
    Math.min(3, (want.g * 0.72) / Math.max(0.001, CHAMPION_GOLD_REF.g)),
    Math.min(3, (want.b * 1.25) / Math.max(0.001, CHAMPION_GOLD_REF.b)),
  )
  root.traverse((obj) => {
    if (!obj.isMesh) return
    const cloneMat = (m) => {
      if (!m) return m
      const next = m.clone()
      if (next.color) next.color.copy(tintColor)
      next.needsUpdate = true
      return next
    }
    obj.material = Array.isArray(obj.material)
      ? obj.material.map(cloneMat)
      : cloneMat(obj.material)
    obj.castShadow = true
    obj.receiveShadow = true
  })
  root.scale.setScalar(scale)
  root.position.set(x, y, z)
  root.rotation.y = rotY
  return root
}

function boostPlatformNeon(root) {
  root.traverse((obj) => {
    if (!obj.isMesh) return
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const m of mats) {
      if (!m) continue
      const name = m.name || obj.name || ''
      if (!name.includes('Neon') && !name.includes('Tree') && !name.includes('Casino')) continue
      if (m.emissive) {
        const boost = name.includes('Pink') ? 3.2
          : name.includes('Orange') ? 2.4
            : name.includes('Tree') ? 1.6
              : name.includes('Casino') ? 2.8
                : 2.2
        m.emissiveIntensity = Math.max(m.emissiveIntensity || 1, boost)
        m.toneMapped = false
        m.needsUpdate = true
      }
      const isNeon = name.includes('Neon')
      obj.castShadow = !isNeon
      obj.receiveShadow = !isNeon
    }
  })
}

function readTopFace(body) {
  const faces = [
    { v: 1, n: new THREE.Vector3(0, 1, 0) },
    { v: 6, n: new THREE.Vector3(0, -1, 0) },
    { v: 2, n: new THREE.Vector3(0, 0, 1) },
    { v: 5, n: new THREE.Vector3(0, 0, -1) },
    { v: 3, n: new THREE.Vector3(1, 0, 0) },
    { v: 4, n: new THREE.Vector3(-1, 0, 0) },
  ]
  const q = new THREE.Quaternion(
    body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w,
  )
  const up = new THREE.Vector3(0, 1, 0)
  let best = 1
  let bestDot = -Infinity
  for (const f of faces) {
    const dot = f.n.clone().applyQuaternion(q).dot(up)
    if (dot > bestDot) { bestDot = dot; best = f.v }
  }
  return best
}

function buildHexPlatform() {
  const group = new THREE.Group()
  const shape = new THREE.Shape()
  const r = 2.4
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6
    const x = Math.cos(a) * r
    const y = Math.sin(a) * r
    if (i === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  }
  shape.closePath()
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.28, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2,
  })
  geo.rotateX(-Math.PI / 2)
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color: 0x14122a, roughness: 0.55, metalness: 0.35,
  }))
  mesh.receiveShadow = true
  mesh.castShadow = true
  group.add(mesh)

  const rimPts = []
  for (let i = 0; i <= 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6
    rimPts.push(new THREE.Vector3(Math.cos(a) * (r + 0.02), 0.02, Math.sin(a) * (r + 0.02)))
  }
  group.add(new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rimPts, true), 64, 0.035, 8, true),
    new THREE.MeshStandardMaterial({
      color: 0xff44cc, emissive: 0xff22aa, emissiveIntensity: 1.4, roughness: 0.3, metalness: 0.2,
    }),
  ))

  const inner = []
  for (let i = 0; i <= 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6
    inner.push(new THREE.Vector3(Math.cos(a) * (r * 0.88), 0.03, Math.sin(a) * (r * 0.88)))
  }
  group.add(new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(inner, true), 48, 0.02, 6, true),
    new THREE.MeshStandardMaterial({
      color: 0x44eeff, emissive: 0x22ccff, emissiveIntensity: 1.1, roughness: 0.35,
    }),
  ))
  return { group }
}

function buildCup() {
  const group = new THREE.Group()
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x12121c, roughness: 0.4, metalness: 0.55, side: THREE.DoubleSide,
  })
  const innerMat = new THREE.MeshStandardMaterial({
    color: 0x1a2238, roughness: 0.55, metalness: 0.3, side: THREE.BackSide,
  })
  const glowMat = new THREE.MeshStandardMaterial({
    color: 0x33eeff, emissive: 0x22ddff, emissiveIntensity: 1.2, roughness: 0.3,
  })

  // Sized for DIE_SIZE ~0.34 — two dice nest inside with room to pour out
  const topR = CUP_INNER_R
  const botR = CUP_INNER_R * 0.82
  const h = CUP_DEPTH
  const outer = new THREE.Mesh(new THREE.CylinderGeometry(topR, botR, h, 32, 1, true), wallMat)
  outer.castShadow = true
  group.add(outer)
  group.add(new THREE.Mesh(
    new THREE.CylinderGeometry(topR * 0.94, botR * 0.94, h * 0.97, 32, 1, true),
    innerMat,
  ))

  const bottom = new THREE.Mesh(new THREE.CylinderGeometry(botR, botR, 0.07, 32), wallMat)
  bottom.position.y = -h * 0.5
  bottom.castShadow = true
  group.add(bottom)

  const ring1 = new THREE.Mesh(new THREE.TorusGeometry(topR + 0.02, 0.035, 10, 40), glowMat)
  ring1.rotation.x = Math.PI / 2
  ring1.position.y = h * 0.38
  group.add(ring1)
  const ring2 = ring1.clone()
  ring2.position.y = -h * 0.08
  group.add(ring2)
  return { group }
}

function addRailBodies(world, groundMat, tableTop = 0.3) {
  const r = 2.5
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6
    const a2 = (Math.PI / 3) * (i + 1) + Math.PI / 6
    const x1 = Math.cos(a) * r
    const z1 = Math.sin(a) * r
    const x2 = Math.cos(a2) * r
    const z2 = Math.sin(a2) * r
    const mx = (x1 + x2) / 2
    const mz = (z1 + z2) / 2
    const len = Math.hypot(x2 - x1, z2 - z1)
    const angle = Math.atan2(z2 - z1, x2 - x1)
    const body = new CANNON.Body({
      type: CANNON.Body.STATIC,
      material: groundMat,
      shape: new CANNON.Box(new CANNON.Vec3(len * 0.5, 0.55, 0.12)),
    })
    body.position.set(mx, tableTop + 0.45, mz)
    body.quaternion.setFromEuler(0, -angle, 0)
    world.addBody(body)
  }
}
