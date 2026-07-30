import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

export const MAX_HP = 30

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

// die with glowing pips (opposite faces sum to 7)
export function createDie(skin) {
  const s = { ...DEFAULT_SKIN, ...skin }
  const group = new THREE.Group()
  const bodyMat = new THREE.MeshStandardMaterial({
    color: s.body, roughness: s.roughness, metalness: s.metalness,
  })
  const body = new THREE.Mesh(dieGeo, bodyMat)
  body.castShadow = true
  body.receiveShadow = true
  group.add(body)

  // pips read by contrast against a bright body now, so the emissive is only a
  // hint of self-illumination instead of the glowing dots of the neon era
  const pipMat = new THREE.MeshStandardMaterial({
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
  return { group, bodyMat, pipMat, skin: s }
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
