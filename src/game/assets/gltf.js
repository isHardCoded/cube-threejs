import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { gradientMap } from '../themes/kit.js'

// Shared GLB pipeline for map themes. Templates are loaded once, materials are
// forced into the game's cel-shaded look, and callers clone for each instance.

const loader = new GLTFLoader()
const templates = new Map() // url -> Object3D
const inflight = new Map() // url -> Promise<Object3D>

function colorFromMaterial(mat) {
  if (!mat) return new THREE.Color('#888888')
  if (mat.color && mat.color.isColor) return mat.color.clone()
  if (mat.emissive && mat.emissive.isColor && mat.emissive.getHex() !== 0) {
    return mat.emissive.clone()
  }
  return new THREE.Color('#888888')
}

// Replace Standard/PBR export materials with MeshToonMaterial so imported
// meshes match the procedural arena. Optional palette remaps by material name.
// When `maps` is an object, ONLY those keys get an albedo (no glTF photo fallback) —
// Fall Guys / candy looks need flat colour, not PBR maps baked into the GLB.
export function applyToonMaterials(root, { palette = null, maps = null, steps = 4 } = {}) {
  const ramp = gradientMap(steps)
  const mapsProvided = maps != null && typeof maps === 'object'

  function toToon(src) {
    const key = (src?.name || '').replace(/\.\d+$/, '')
    const map = mapsProvided ? (maps[key] || null) : (src?.map ?? null)
    const color = palette?.[key]
      ? new THREE.Color(palette[key])
      : colorFromMaterial(src)
    const mat = new THREE.MeshToonMaterial({
      color,
      map: map || null,
      gradientMap: ramp,
    })
    mat.name = key
    if (mat.map) {
      mat.map.colorSpace = THREE.SRGBColorSpace
      mat.map.wrapS = THREE.RepeatWrapping
      mat.map.wrapT = THREE.RepeatWrapping
    }
    if (src?.emissiveIntensity > 0.01 && src?.emissive) {
      mat.emissive = src.emissive.clone()
      mat.emissiveIntensity = Math.min(src.emissiveIntensity, 0.9)
    }
    return mat
  }

  root.traverse((obj) => {
    if (!obj.isMesh) return
    if (Array.isArray(obj.material)) {
      obj.material = obj.material.map(toToon)
    } else {
      obj.material = toToon(obj.material)
    }
    obj.castShadow = true
    obj.receiveShadow = true
  })
  return root
}

async function loadTemplate(url, opts = {}) {
  if (templates.has(url)) return templates.get(url)
  if (inflight.has(url)) return inflight.get(url)

  const job = loader.loadAsync(url)
    .then((gltf) => {
      const root = gltf.scene || gltf.scenes[0]
      root.updateMatrixWorld(true)
      applyToonMaterials(root, opts)
      // Freeze as a clean template: clones share geometry, own transforms.
      templates.set(url, root)
      inflight.delete(url)
      return root
    })
    .catch((err) => {
      inflight.delete(url)
      console.warn(`[assets] failed to load ${url}`, err)
      throw err
    })

  inflight.set(url, job)
  return job
}

export async function preloadGltf(urls, opts = {}) {
  const list = [...new Set((urls || []).filter(Boolean))]
  if (!list.length) return
  await Promise.all(list.map((url) => loadTemplate(url, opts).catch(() => null)))
}

// Sync clone after preload. Returns null if the asset is missing (caller falls
// back to a procedural mesh so maps never hard-fail).
export function cloneGltf(url) {
  const template = templates.get(url)
  if (!template) return null
  const root = template.clone(true)
  // Cloned materials stay shared on purpose — same toon look, fewer uploads.
  return root
}

export function getGltfTemplate(url) {
  return templates.get(url)
    || templates.get(String(url).replace(/\?.*$/, ''))
    || null
}

export function hasGltf(url) {
  return templates.has(url) || templates.has(String(url).replace(/\?.*$/, ''))
}

export function assetUrl(mapId, kind, name) {
  return `/assets/maps/${mapId}/${kind}/${name}.glb`
}
