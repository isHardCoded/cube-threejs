/** Graphics quality profiles — same look, cheaper internals on weaker devices. */

export const QUALITY_KEY = 'cube-game-gfx-quality'
export const QUALITY_IDS = ['auto', 'high', 'balanced', 'perf']

/** @typedef {'high' | 'balanced' | 'perf'} QualityTier */
/** @typedef {'auto' | QualityTier} QualityPreference */

/**
 * @typedef {object} QualityProfile
 * @property {QualityTier} id
 * @property {number} maxDpr
 * @property {number} msaaSamples
 * @property {number} shadowMapSize
 * @property {number} shadowExtentScale  fraction of theme shadow extent
 * @property {'heavy' | 'core'} shadowCast
 * @property {number} maxShadowCasters
 * @property {boolean} ao
 * @property {number} aoScale           1 = full res, 0.5 = half
 * @property {number} aoSamples
 * @property {number} bloomScale
 * @property {boolean} godray
 * @property {boolean} cameraShadowCull
 * @property {boolean} [shadows]        false = disable shadow map entirely
 */

/** @type {Record<QualityTier, QualityProfile>} */
export const PROFILES = {
  high: {
    id: 'high',
    maxDpr: 2,
    msaaSamples: 4,
    shadowMapSize: 2048,
    shadowExtentScale: 0.62,
    shadowCast: 'heavy',
    maxShadowCasters: 22,
    ao: true,
    aoScale: 1,
    aoSamples: 8,
    bloomScale: 1,
    godray: true,
    cameraShadowCull: true,
    shadows: true,
  },
  balanced: {
    id: 'balanced',
    maxDpr: 1.5,
    msaaSamples: 2,
    shadowMapSize: 2048,
    shadowExtentScale: 0.52,
    shadowCast: 'heavy',
    maxShadowCasters: 14,
    ao: true,
    aoScale: 0.5,
    aoSamples: 5,
    bloomScale: 0.5,
    godray: true,
    cameraShadowCull: true,
    shadows: true,
  },
  // Phone-friendly: keep wash/grade/bloom, drop heavy shadow pass for stable 60.
  perf: {
    id: 'perf',
    maxDpr: 1.25,
    msaaSamples: 0,
    shadowMapSize: 512,
    shadowExtentScale: 0.38,
    shadowCast: 'core',
    maxShadowCasters: 0,
    ao: false,
    aoScale: 0.5,
    aoSamples: 4,
    bloomScale: 0.5,
    godray: true,
    cameraShadowCull: true,
    shadows: false,
  },
}

/** Phone overrides when user manually picks Balanced / High on mobile. */
const MOBILE_OVERRIDES = {
  balanced: {
    maxDpr: 1.35,
    msaaSamples: 0,
    shadowMapSize: 1024,
    shadowExtentScale: 0.45,
    shadowCast: 'core',
    maxShadowCasters: 10,
    ao: true,
    aoScale: 0.5,
    aoSamples: 4,
    bloomScale: 0.5,
    shadows: true,
  },
  // Soft-cap: High on a phone still shouldn't be a slideshow.
  high: {
    maxDpr: 1.5,
    msaaSamples: 2,
    shadowMapSize: 1024,
    shadowExtentScale: 0.5,
    shadowCast: 'heavy',
    maxShadowCasters: 12,
    ao: true,
    aoScale: 0.5,
    aoSamples: 5,
    bloomScale: 0.5,
    shadows: true,
  },
}

const TIER_ORDER = ['perf', 'balanced', 'high']

export function isMobileDevice() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
}

/**
 * Auto on phones → Perf (measured ~60). Balanced was ~47–48; High ~20.
 * Desktop stays High unless the machine looks weak.
 */
export function detectDeviceTier() {
  const mobile = isMobileDevice()
  const mem = typeof navigator.deviceMemory === 'number' ? navigator.deviceMemory : null
  const cores = navigator.hardwareConcurrency || 4

  if (mobile) return 'perf'
  if (mem != null && mem <= 4) return 'balanced'
  if (cores <= 4 && mem != null && mem <= 8) return 'balanced'
  return 'high'
}

/** @returns {QualityPreference} */
export function getQualityPreference() {
  const v = localStorage.getItem(QUALITY_KEY)
  if (QUALITY_IDS.includes(v)) return /** @type {QualityPreference} */ (v)
  return 'auto'
}

/** @param {QualityPreference} id */
export function setQualityPreference(id) {
  if (!QUALITY_IDS.includes(id)) return getQualityPreference()
  localStorage.setItem(QUALITY_KEY, id)
  return id
}

/** @param {QualityPreference} [preference] */
export function resolveProfile(preference = getQualityPreference()) {
  const tier = preference === 'auto' ? detectDeviceTier() : preference
  const base = PROFILES[tier] || PROFILES.high
  if (!isMobileDevice()) return { ...base }
  const over = MOBILE_OVERRIDES[tier]
  return over ? { ...base, ...over, id: base.id } : { ...base }
}

/** @param {QualityTier} tier @param {-1|1} step */
export function stepTier(tier, step) {
  const i = TIER_ORDER.indexOf(tier)
  if (i < 0) return tier
  return TIER_ORDER[Math.max(0, Math.min(TIER_ORDER.length - 1, i + step))]
}
