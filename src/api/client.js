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
  setSkin: (skinId) => api('/api/me/skin', { method: 'POST', body: { skinId } }),
  setMineSkin: (mineSkinId) => api('/api/me/mine-skin', { method: 'POST', body: { mineSkinId } }),
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
