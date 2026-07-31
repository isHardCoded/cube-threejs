// Shared polished look used by desert/jungle — enable on every map until
// authored Blender scenes replace procedural backdrops.

export const POLISHED_POST = {
  vignette: 0.9,
  contrast: 1.08,
  saturation: 1.2,
  sharpen: 0.04,
}

export const POLISHED_POST_NIGHT = {
  vignette: 0.34,
  contrast: 1.06,
  saturation: 1.03,
  sharpen: 0.04,
}

export const POLISHED_SHADOWS = {
  mapSize: 2048,
  mapSizeMobile: 1024,
  extent: 56,
  extentY: 58,
  near: 2,
  far: 120,
  bias: -0.00035,
  normalBias: 0.035,
  radius: 5.5,
  follow: true,
  sunOffset: [22, 28, 18],
}

/** Soft AO / godray / fill — same defaults as desert. Override fill colors per map. */
export function polishedGfx(extra = {}) {
  return {
    ao: true,
    aoIntensity: 0.12,
    aoIntensityNight: 0.26,
    aoRadius: 0.3,
    godray: true,
    godrayIntensity: 0.21,
    godraySpread: 1.45,
    fillIntensity: 0.21,
    fillIntensityNight: 0.12,
    fillColor: '#ffe8c8',
    fillColorNight: '#7a8aa0',
    ...extra,
  }
}

export function markReceive(mesh) {
  mesh.receiveShadow = true
  mesh.castShadow = false
  mesh.userData.shadowCastTier = 'never'
}

export function markCast(mesh, tier = 'heavy', castMode = 'heavy') {
  mesh.receiveShadow = true
  mesh.userData.shadowCastTier = tier
  mesh.castShadow = tier === 'core' || castMode === 'heavy'
}
