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
 * @property {number} [moteScale]      0..1 particle density hint for themes
 */

/** @type {Record<QualityTier, QualityProfile>} */
export const PROFILES = {
  // Tuned after M1 Pro jungle High ~40–45: keep look, cut fill-rate / AO / casters.
  high: {
    id: 'high',
    maxDpr: 1.75,
    msaaSamples: 2,
    shadowMapSize: 2048,
    shadowExtentScale: 0.55,
    shadowCast: 'heavy',
    maxShadowCasters: 14,
    ao: true,
    aoScale: 0.5,
    aoSamples: 5,
    bloomScale: 0.5,
    godray: true,
    cameraShadowCull: true,
    shadows: true,
    moteScale: 0.65,
  },
  balanced: {
    id: 'balanced',
    maxDpr: 1.5,
    msaaSamples: 2,
    shadowMapSize: 1024,
    shadowExtentScale: 0.5,
    shadowCast: 'heavy',
    maxShadowCasters: 12,
    ao: true,
    aoScale: 0.5,
    aoSamples: 4,
    bloomScale: 0.5,
    godray: true,
    cameraShadowCull: true,
    shadows: true,
    moteScale: 0.45,
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
    moteScale: 0.25,
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
    moteScale: 0.35,
  },
  high: {
    maxDpr: 1.5,
    msaaSamples: 2,
    shadowMapSize: 1024,
    shadowExtentScale: 0.5,
    shadowCast: 'heavy',
    maxShadowCasters: 10,
    ao: true,
    aoScale: 0.5,
    aoSamples: 4,
    bloomScale: 0.5,
    shadows: true,
    moteScale: 0.45,
  },
}

const TIER_ORDER = ['perf', 'balanced', 'high']

export function isMobileDevice() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
}

function isRetinaDisplay() {
  return typeof window !== 'undefined' && window.devicePixelRatio > 1.5
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

/** Optional per-theme tweaks from theme.gfx.quality[tier]. */
export function applyThemeQualityOverrides(profile, themeGfx = {}) {
  const over = themeGfx.quality?.[profile.id]
  return over ? { ...profile, ...over, id: profile.id } : profile
}

/** @param {QualityPreference} [preference] */
export function resolveProfile(preference = getQualityPreference()) {
  const tier = preference === 'auto' ? detectDeviceTier() : preference
  const base = PROFILES[tier] || PROFILES.high
  let profile = { ...base }
  if (isMobileDevice()) {
    const over = MOBILE_OVERRIDES[tier]
    if (over) profile = { ...profile, ...over, id: base.id }
  }
  // Retina (MacBook etc.): post+MSAA at DPR 2 is the usual High killer.
  if (isRetinaDisplay() && profile.id === 'high') {
    profile = {
      ...profile,
      maxDpr: Math.min(profile.maxDpr, 1.5),
      msaaSamples: Math.min(profile.msaaSamples, 2),
      aoScale: Math.min(profile.aoScale, 0.5),
      aoSamples: Math.min(profile.aoSamples, 5),
      bloomScale: Math.min(profile.bloomScale, 0.5),
      maxShadowCasters: Math.min(profile.maxShadowCasters, 12),
      moteScale: Math.min(profile.moteScale ?? 1, 0.55),
    }
  }
  return profile
}

/** @param {QualityTier} tier @param {-1|1} step */
export function stepTier(tier, step) {
  const i = TIER_ORDER.indexOf(tier)
  if (i < 0) return tier
  return TIER_ORDER[Math.max(0, Math.min(TIER_ORDER.length - 1, i + step))]
}
