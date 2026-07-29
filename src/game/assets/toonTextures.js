import * as THREE from 'three'

// Fall Guys / candy look: almost no albedo detail. Photo maps make Kenney meshes
// read as mud — flat pastel colour + soft toon ramp is the whole surface language.
// Only water keeps a soft scroll map so the river can animate.

const cache = new Map()
const inflight = new Map()
const loader = new THREE.TextureLoader()

function prepare(tex, repeat = 1.2) {
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.generateMipmaps = true
  tex.anisotropy = 2
  tex.repeat.set(repeat, repeat)
  tex.needsUpdate = true
  return tex
}

export function textureUrl(mapId, name) {
  return `/assets/maps/${mapId}/textures/${name}.png?v=fallguys1`
}

export async function preloadToonTextures(urls) {
  const list = [...new Set((urls || []).filter(Boolean))]
  await Promise.all(list.map((url) => {
    if (cache.has(url)) return Promise.resolve(cache.get(url))
    if (inflight.has(url)) return inflight.get(url)
    const job = loader.loadAsync(url)
      .then((tex) => {
        prepare(tex)
        cache.set(url, tex)
        inflight.delete(url)
        return tex
      })
      .catch((err) => {
        inflight.delete(url)
        console.warn(`[textures] failed to load ${url}`, err)
        return null
      })
    inflight.set(url, job)
    return job
  }))
}

export function getToonTexture(url) {
  return cache.get(url) || null
}

function cloneMap(tex, repeat) {
  if (!tex) return null
  const m = tex.clone()
  m.wrapS = THREE.RepeatWrapping
  m.wrapT = THREE.RepeatWrapping
  m.magFilter = THREE.LinearFilter
  m.minFilter = THREE.LinearMipmapLinearFilter
  m.colorSpace = THREE.SRGBColorSpace
  m.repeat.set(repeat, repeat)
  m.needsUpdate = true
  return m
}

/** Soft candy water bands only — every other material stays flat colour. */
export function jungleTextureMaps() {
  const water = getToonTexture(textureUrl('jungle', 'water'))
  return {
    Water: cloneMap(water, 1.6),
    WaterDeep: cloneMap(water, 1.4),
    WaterFoam: cloneMap(water, 1.8),
  }
}

export function jungleTextureUrls() {
  return [textureUrl('jungle', 'water')]
}
