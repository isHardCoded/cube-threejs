import { API_BASE } from '../config/env.js'

/** Absolute URL for img src; empty → use placeholder. */
export function resolveAvatarUrl(avatarUrl) {
  if (!avatarUrl) return ''
  if (/^https?:\/\//i.test(avatarUrl)) return avatarUrl
  return `${API_BASE}${avatarUrl.startsWith('/') ? '' : '/'}${avatarUrl}`
}

export function formatRegisteredAt(iso, locale = 'ru') {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(locale === 'en' ? 'en-US' : 'ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}
