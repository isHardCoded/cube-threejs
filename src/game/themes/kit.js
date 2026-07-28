import * as THREE from 'three'

// Shared toolkit for the map themes. Everything here exists to keep the three
// maps consistent (same cartoon shading model, same determinism) and cheap
// (geometry and materials are cached, never rebuilt per prop).

// Cel shading in a few flat bands: this is what makes the game read as a
// cartoon instead of a glossy render. One ramp per step count, reused.
const ramps = new Map()
export function gradientMap(steps = 4) {
  if (ramps.has(steps)) return ramps.get(steps)
  const data = new Uint8Array(steps)
  for (let i = 0; i < steps; i++) {
    // The darkest band is lifted so nothing goes to black, but not so far that
    // cast shadows and shaded sides disappear — that flattened the whole arena.
    data[i] = Math.round((0.3 + 0.7 * (i / (steps - 1))) * 255)
  }
  const tex = new THREE.DataTexture(data, steps, 1, THREE.RedFormat)
  tex.minFilter = THREE.NearestFilter
  tex.magFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  ramps.set(steps, tex)
  return tex
}

// Flat cartoon surface. No metalness and no roughness by design: shiny
// reflections are exactly what made the old arena hard to read.
export function toon(color, extra = {}) {
  return new THREE.MeshToonMaterial({
    color, gradientMap: gradientMap(extra.steps || 4), ...omit(extra, 'steps'),
  })
}

// Cartoon "neon": the colour itself lights up, but gently — bloom is deliberately
// weak now, so intensity here is about the surface reading as lit, not glare.
export function glow(color, intensity = 0.75, extra = {}) {
  return toon(color, { emissive: color, emissiveIntensity: intensity, ...extra })
}

function omit(obj, key) {
  const { [key]: _drop, ...rest } = obj
  return rest
}

// Geometry cache. Props are built per cell, so without this a map with 20 rocks
// would allocate 20 identical sphere buffers.
const geos = new Map()
export function geo(key, make) {
  if (!geos.has(key)) geos.set(key, make())
  return geos.get(key)
}

// The server sends only a cell and a kind, so every visual detail is derived
// from the coordinates: a hash instead of Math.random keeps each client's arena
// identical without shipping colours and scales over the wire.
export function cellRng(x, z) {
  let s = (x * 374761393 + z * 668265263) | 0
  return () => {
    s = ((s ^ (s >>> 13)) * 1274126177) | 0
    return ((s ^ (s >>> 16)) >>> 0) / 4294967296
  }
}

export const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)]

// Shadow casting is set in one place: props are small and numerous, so only the
// bodies cast, never the decorative glowing bits.
export function solid(mesh) {
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

// A rounded-ish blob, the workhorse shape for rocks and cacti: cheap, soft and
// unmistakably hand-drawn once cel shaded.
export function blob(radius, detail = 0) {
  return new THREE.IcosahedronGeometry(radius, detail)
}

// Points-based weather/embers. Shared so every theme gets the same wrap-around
// behaviour and the same (small) particle budget.
export function createDrift({
  count, color, size, opacity, spread = 40, top = 24, bottom = -6,
  speed = [1, 2], sway = 0, blending = THREE.NormalBlending,
}) {
  const pos = new Float32Array(count * 3)
  const vel = new Float32Array(count)
  const phase = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * spread
    pos[i * 3 + 1] = bottom + Math.random() * (top - bottom)
    pos[i * 3 + 2] = (Math.random() - 0.5) * spread
    vel[i] = speed[0] + Math.random() * (speed[1] - speed[0])
    phase[i] = Math.random() * Math.PI * 2
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({
    color, size, transparent: true, opacity, depthWrite: false, blending,
  }))

  // positive speed falls, negative rises (embers)
  function update(dt, t) {
    const a = geometry.attributes.position.array
    for (let i = 0; i < count; i++) {
      a[i * 3 + 1] -= vel[i] * dt
      if (sway) a[i * 3] += Math.sin(t * 1.5 + phase[i]) * sway * dt
      if (vel[i] > 0 && a[i * 3 + 1] < bottom) a[i * 3 + 1] = top
      if (vel[i] < 0 && a[i * 3 + 1] > top) a[i * 3 + 1] = bottom
    }
    geometry.attributes.position.needsUpdate = true
  }

  return { points, update, material: points.material }
}

// Canvas textures: themes draw their own floor decals, so the helper is shared
// but the drawing is not.
export function canvasTexture(draw, w = 128, h = 128) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d'), c)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}
