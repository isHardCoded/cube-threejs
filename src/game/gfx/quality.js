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
 * @property {boolean} ao
 * @property {number} aoScale           1 = full res, 0.5 = half
 * @property {number} aoSamples
 * @property {number} bloomScale
 * @property {boolean} godray
 * @property {boolean} cameraShadowCull
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
    ao: true,
    aoScale: 1,
    aoSamples: 8,
    bloomScale: 1,
    godray: true,
    cameraShadowCull: true,
  },
  balanced: {
    id: 'balanced',
    maxDpr: 1.5,
    msaaSamples: 2,
    shadowMapSize: 2048,
    shadowExtentScale: 0.52,
    shadowCast: 'heavy',
    ao: true,
    aoScale: 0.5,
    aoSamples: 5,
    bloomScale: 0.5,
    godray: true,
    cameraShadowCull: true,
  },
  perf: {
    id: 'perf',
    maxDpr: 1.25,
    msaaSamples: 2,
    shadowMapSize: 1024,
    shadowExtentScale: 0.42,
    shadowCast: 'core',
    ao: true,
    aoScale: 0.5,
    aoSamples: 4,
    bloomScale: 0.5,
    godray: true,
    cameraShadowCull: true,
  },
}

const TIER_ORDER = ['perf', 'balanced', 'high']

export function isMobileDevice() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
}

/** Heuristic device tier when preference is Auto. */
export function detectDeviceTier() {
  const mobile = isMobileDevice()
  const mem = typeof navigator.deviceMemory === 'number' ? navigator.deviceMemory : null
  const cores = navigator.hardwareConcurrency || 4

  if (mobile) {
    if (mem != null && mem <= 4) return 'perf'
    return 'balanced'
  }
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
  return PROFILES[tier] || PROFILES.high
}

/** @param {QualityTier} tier @param {-1|1} step */
export function stepTier(tier, step) {
  const i = TIER_ORDER.indexOf(tier)
  if (i < 0) return tier
  return TIER_ORDER[Math.max(0, Math.min(TIER_ORDER.length - 1, i + step))]
}
