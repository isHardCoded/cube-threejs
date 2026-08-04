import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

export const MAX_HP = 30

/** Freefight / freeroam face moods. Default resting face is happy. */
export const EMOTIONS = ['happy', 'sad', 'angry']
export const EMOTE_MS = 5000

export const dieGeo = new RoundedBoxGeometry(1, 1, 1, 4, 0.09)
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

export const yAxis = new THREE.Vector3(0, 1, 0)

// Skins come from the server catalog; this is only the shape createDie needs
// and the look a cube falls back to before the catalog has arrived.
export const DEFAULT_SKIN = {
  id: 'chrome-yellow', body: '#ffcf3f', pip: '#3c3010', metalness: 0.1, roughness: 0.55,
}

function normalizeEmotion(emotion) {
  return EMOTIONS.includes(emotion) ? emotion : 'happy'
}

// die with glowing pips (opposite faces sum to 7)
// opts.pips — dice dots (default true). opts.face — toy eyes on −Z for freeroam.
export function createDie(skin, opts = {}) {
  const { pips = true, face = false, emotion = 'happy' } = opts
  const s = { ...DEFAULT_SKIN, ...skin }
  const group = new THREE.Group()
  const bodyMat = new THREE.MeshStandardMaterial({
    color: s.body, roughness: s.roughness, metalness: s.metalness,
  })
  const body = new THREE.Mesh(dieGeo, bodyMat)
  body.castShadow = true
  body.receiveShadow = true
  group.add(body)

  let pipMat = null
  if (pips) {
    // pips read by contrast against a bright body now, so the emissive is only a
    // hint of self-illumination instead of the glowing dots of the neon era
    pipMat = new THREE.MeshStandardMaterial({
      color: s.pip, emissive: s.pip, emissiveIntensity: 0.35, roughness: 0.5,
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
  }

  if (face) addToyFace(group, s, emotion)

  return { group, bodyMat, pipMat, skin: s }
}

function disposeObject3D(obj) {
  obj.traverse((o) => {
    if (o.geometry && o.geometry !== dieGeo && o.geometry !== pipGeo) o.geometry.dispose?.()
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose?.())
      else o.material.dispose?.()
    }
  })
}

/** Simple eyes + expression on the −Z face (front when yaw follows move dir). */
function addToyFace(group, skin, emotion = 'happy') {
  const root = new THREE.Group()
  root.name = 'TOY_FACE'
  group.add(root)
  group.userData.toyFace = root
  group.userData.faceSkin = skin
  buildToyFace(root, skin, emotion)
  group.userData.emotion = normalizeEmotion(emotion)
}

function buildToyFace(root, skin, emotion) {
  const mood = normalizeEmotion(emotion)
  const ink = new THREE.MeshStandardMaterial({
    color: skin.pip || '#2a2010',
    roughness: 0.55,
    metalness: 0.05,
  })
  const white = new THREE.MeshStandardMaterial({
    color: '#fff8ee',
    roughness: 0.4,
  })

  const eyeWhiteGeo = new THREE.SphereGeometry(0.11, 14, 12)
  const pupilGeo = new THREE.SphereGeometry(0.055, 12, 10)

  const eyeY = mood === 'sad' ? 0.08 : 0.12
  const pupilY = mood === 'sad' ? 0.05 : mood === 'angry' ? 0.12 : 0.11
  const eyeScaleY = mood === 'angry' ? 0.82 : 1.05

  for (const side of [-1, 1]) {
    const sclera = new THREE.Mesh(eyeWhiteGeo, white)
    sclera.position.set(side * 0.17, eyeY, -0.5)
    sclera.scale.set(1, eyeScaleY, 0.55)
    sclera.castShadow = true
    root.add(sclera)

    const pupil = new THREE.Mesh(pupilGeo, ink)
    pupil.position.set(side * 0.17, pupilY, -0.545)
    root.add(pupil)
  }

  if (mood === 'angry') {
    const browGeo = new THREE.BoxGeometry(0.16, 0.035, 0.04)
    for (const side of [-1, 1]) {
      const brow = new THREE.Mesh(browGeo, ink)
      brow.position.set(side * 0.17, 0.26, -0.52)
      brow.rotation.z = side * 0.45
      root.add(brow)
    }
  }

  // Mouth — Torus arc in XY is the *upper* half by default (∩).
  // Flip 180° around Z for a smile (∪); leave upright for a frown.
  if (mood === 'happy') {
    const smile = new THREE.Mesh(
      new THREE.TorusGeometry(0.15, 0.028, 8, 20, Math.PI * 0.95),
      ink,
    )
    smile.position.set(0, -0.06, -0.51)
    smile.rotation.set(0, 0, Math.PI)
    smile.scale.set(1, 0.9, 1)
    root.add(smile)
  } else if (mood === 'sad') {
    const frown = new THREE.Mesh(
      new THREE.TorusGeometry(0.14, 0.028, 8, 24, Math.PI),
      ink,
    )
    frown.position.set(0, -0.2, -0.53)
    frown.rotation.set(0, 0, 0)
    frown.scale.set(1, 0.85, 1)
    root.add(frown)
  } else {
    // angry — full upper semicircle (arc must be π or one side looks cut off)
    const scowl = new THREE.Mesh(
      new THREE.TorusGeometry(0.13, 0.028, 8, 24, Math.PI),
      ink,
    )
    scowl.position.set(0, -0.15, -0.53)
    scowl.rotation.set(0, 0, 0)
    scowl.scale.set(1.05, 0.72, 1)
    root.add(scowl)
  }

  if (mood === 'happy') {
    const blushMat = new THREE.MeshStandardMaterial({
      color: '#ff8fab',
      roughness: 0.7,
      transparent: true,
      opacity: 0.45,
    })
    const blushGeo = new THREE.SphereGeometry(0.07, 10, 8)
    for (const side of [-1, 1]) {
      const blush = new THREE.Mesh(blushGeo, blushMat)
      blush.position.set(side * 0.32, -0.02, -0.48)
      blush.scale.set(1, 0.7, 0.35)
      root.add(blush)
    }
  }
}

/** Swap the toy-face expression on an existing die group. */
export function setDieEmotion(group, emotion) {
  if (!group?.userData?.toyFace) return false
  const mood = normalizeEmotion(emotion)
  if (group.userData.emotion === mood) return true
  const root = group.userData.toyFace
  const skin = group.userData.faceSkin || DEFAULT_SKIN
  while (root.children.length) {
    const child = root.children[0]
    root.remove(child)
    disposeObject3D(child)
  }
  buildToyFace(root, skin, mood)
  group.userData.emotion = mood
  return true
}

// orientation lookup: (top, east, south) -> quaternion, all 24 rotations
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

export const quatForOrient = (o) => orientTable.get(`${o.top},${o.east},${o.south}`)

// mirrors server/dice.go — used for instant local roll prediction
export function rollOrient(o, dx, dz) {
  switch (true) {
    case dx === 1: return { top: 7 - o.east, east: o.top, south: o.south }
    case dx === -1: return { top: o.east, east: 7 - o.top, south: o.south }
    case dz === 1: return { top: 7 - o.south, east: o.east, south: o.top }
    case dz === -1: return { top: o.south, east: o.east, south: 7 - o.top }
    default: return o
  }
}
