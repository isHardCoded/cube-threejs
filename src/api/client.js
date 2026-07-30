import { API_BASE } from '../config/env.js'
import { getToken } from '../auth/tokenStore.js'
import { t } from '../i18n/t.js'

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

export async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const token = getToken()
  if (auth && token) headers.Authorization = `Bearer ${token}`

  let res
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(t('common.serverDown'), 0)
  }

  let data = null
  try {
    data = await res.json()
  } catch {
    // empty or non-JSON body is fine for some responses
  }
  if (!res.ok) throw new ApiError(data?.error || t('common.error', { status: res.status }), res.status)
  return data
}

export const auth = {
  register: (username, password) => api('/api/register', { method: 'POST', body: { username, password }, auth: false }),
  login: (username, password) => api('/api/login', { method: 'POST', body: { username, password }, auth: false }),
  telegram: (initData) => api('/api/auth/telegram', { method: 'POST', body: { initData }, auth: false }),
  me: () => api('/api/me'),
}

export const profile = {
  skins: () => api('/api/skins', { auth: false }),
  mineSkins: () => api('/api/mine-skins', { auth: false }),
  hats: () => api('/api/hats', { auth: false }),
  setSkin: (skinId) => api('/api/me/skin', { method: 'POST', body: { skinId } }),
  setMineSkin: (mineSkinId) => api('/api/me/mine-skin', { method: 'POST', body: { mineSkinId } }),
  setHat: (hatId) => api('/api/me/hat', { method: 'POST', body: { hatId } }),
  setAvatar: async (file) => {
    const headers = {}
    const token = getToken()
    if (token) headers.Authorization = `Bearer ${token}`

    const form = new FormData()
    form.append('file', file)

    let res
    try {
      res = await fetch(`${API_BASE}/api/me/avatar`, {
        method: 'POST',
        headers,
        body: form,
      })
    } catch {
      throw new ApiError(t('common.serverDown'), 0)
    }

    let data = null
    try {
      data = await res.json()
    } catch {
      // ignore
    }
    if (!res.ok) throw new ApiError(data?.error || t('common.error', { status: res.status }), res.status)
    return data
  },
}

export const rating = {
  top: () => api('/api/rating'),
}

export const friends = {
  list: () => api('/api/friends'),
  search: (q) => api(`/api/friends/search?q=${encodeURIComponent(q)}`),
  blocked: () => api('/api/friends/blocked'),
  request: (userId) => api('/api/friends/request', { method: 'POST', body: { userId } }),
  accept: (userId) => api('/api/friends/accept', { method: 'POST', body: { userId } }),
  decline: (userId) => api('/api/friends/decline', { method: 'POST', body: { userId } }),
  cancel: (userId) => api('/api/friends/cancel', { method: 'POST', body: { userId } }),
  remove: (userId) => api('/api/friends/remove', { method: 'POST', body: { userId } }),
  block: (userId) => api('/api/friends/block', { method: 'POST', body: { userId } }),
  unblock: (userId) => api('/api/friends/unblock', { method: 'POST', body: { userId } }),
  user: (id) => api(`/api/users/${id}`),
}

export const matchmaking = {
  queue: (maps, size) => api('/api/match/queue', { method: 'POST', body: { maps, size } }),
  cancel: () => api('/api/match/queue', { method: 'DELETE' }),
  status: () => api('/api/match/status'),
}

export const quests = {
  list: () => api('/api/quests'),
  claim: (id) => api('/api/quests/claim', { method: 'POST', body: { id } }),
}

export const badges = {
  get: () => api('/api/badges'),
}
