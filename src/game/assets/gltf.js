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
//
// maps: optional albedo overrides by material name (e.g. scrolling Water).
// keepSourceMaps: when true, glTF albedos are kept unless an override exists
//   (needed for NatureKit PixelPalette atlas — candy strip mode was wrong).
// keepSourceColors: when true, skip palette remaps for mats that already have
//   an albedo map, vertex colours, or an authored non-default base colour.
export function applyToonMaterials(root, {
  palette = null,
  maps = null,
  steps = 4,
  keepSourceMaps = false,
  keepSourceColors = false,
} = {}) {
  const ramp = gradientMap(steps)
  const mapsProvided = maps != null && typeof maps === 'object'

  function resolveKey(name) {
    const raw = name || ''
    const stripped = raw.replace(/\.\d+$/, '')
    // Prefer exact Blender names (Material.001 vs Material.002) when mapped
    if ((palette && palette[raw]) || (mapsProvided && maps?.[raw])) return raw
    if ((palette && palette[stripped]) || (mapsProvided && maps?.[stripped])) return stripped
    if (stripped.startsWith('PixelPalette')) return stripped
    return stripped || raw
  }

  function mapFor(key, src) {
    if (mapsProvided && maps[key]) return maps[key]
    if (mapsProvided && key.startsWith('PixelPalette') && maps.PixelPalette) {
      return maps.PixelPalette
    }
    if (!mapsProvided || keepSourceMaps) return src?.map ?? null
    return null
  }

  function toToon(src) {
    const key = resolveKey(src?.name)
    const map = mapFor(key, src)
    const srcColor = colorFromMaterial(src)
    const hasAuthoredColor = srcColor.getHex() !== 0x888888
    let color
    if (keepSourceColors && (map || src?.vertexColors || hasAuthoredColor)) {
      // Atlas / solids: white multiply so texel or base colour wins.
      color = map ? new THREE.Color('#ffffff') : srcColor
    } else if (palette?.[key]) {
      color = new THREE.Color(palette[key])
    } else {
      color = srcColor
    }
    const mat = new THREE.MeshToonMaterial({
      color,
      map: map || null,
      gradientMap: ramp,
      vertexColors: !!(src?.vertexColors),
    })
    mat.name = key
    if (mat.map) {
      mat.map.colorSpace = THREE.SRGBColorSpace
      mat.map.wrapS = THREE.RepeatWrapping
      mat.map.wrapT = THREE.RepeatWrapping
      // NatureKit atlas is a tiny pixel sheet — nearest sampling.
      if (key.startsWith('PixelPalette')) {
        mat.map.magFilter = THREE.NearestFilter
        mat.map.minFilter = THREE.NearestFilter
        mat.map.generateMipmaps = false
      }
    }
    if (src?.emissiveIntensity > 0.01 && src?.emissive) {
      mat.emissive = src.emissive.clone()
      mat.emissiveIntensity = Math.min(src.emissiveIntensity, 0.9)
    }
    if (src?.transparent) {
      mat.transparent = true
      mat.opacity = src.opacity ?? 1
      mat.depthWrite = src.depthWrite ?? (mat.opacity >= 0.99)
    }
    return mat
  }

  root.traverse((obj) => {
    if (!obj.isMesh) return
    const hasVertexColors = !!(obj.geometry?.attributes?.color)
    if (hasVertexColors) {
      const attr = obj.geometry.attributes.color
      if ('colorSpace' in attr) attr.colorSpace = THREE.SRGBColorSpace
    }
    if (Array.isArray(obj.material)) {
      obj.material = obj.material.map((m) => {
        const next = toToon(m)
        if (hasVertexColors) {
          next.vertexColors = true
          // Don't multiply atlas/mask colours by a palette tint
          next.color.set('#ffffff')
        }
        return next
      })
    } else {
      obj.material = toToon(obj.material)
      if (hasVertexColors) {
        obj.material.vertexColors = true
        obj.material.color.set('#ffffff')
      }
    }
    obj.castShadow = true
    obj.receiveShadow = true
  })
  return root
}

/**
 * Keep glTF materials as authored (MeshStandard / vertex colours / atlas).
 * Use for Blender backdrop scenes where MeshToon + candy remaps destroy fidelity.
 */
export function preserveGltfMaterials(root) {
  root.traverse((obj) => {
    if (!obj.isMesh) return
    const hasVertexColors = !!(obj.geometry?.attributes?.color)
    if (hasVertexColors) {
      const attr = obj.geometry.attributes.color
      if ('colorSpace' in attr) attr.colorSpace = THREE.SRGBColorSpace
    }
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const m of mats) {
      if (!m) continue
      if (hasVertexColors) {
        m.vertexColors = true
        if (m.color) m.color.set('#ffffff')
      }
      if (m.map) {
        m.map.colorSpace = THREE.SRGBColorSpace
        const n = m.name || ''
        if (n.startsWith('PixelPalette')) {
          m.map.magFilter = THREE.NearestFilter
          m.map.minFilter = THREE.NearestFilter
          m.map.generateMipmaps = false
          m.map.needsUpdate = true
        }
        // Atlas must not be multiplied by a leftover tint
        if (m.color) m.color.set('#ffffff')
      }
      if (m.normalMap) m.normalMap.colorSpace = THREE.LinearSRGBColorSpace
      m.needsUpdate = true
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
      if (opts.preserveMaterials) {
        preserveGltfMaterials(root)
      } else {
        applyToonMaterials(root, opts)
      }
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
