import { useCallback, useEffect, useMemo, useState } from 'react'
import { auth as authApi } from '../api/client.js'
import { getToken, setToken } from './tokenStore.js'
import { tg } from '../game/telegram.js'
import { AuthContext } from './context.js'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [ownedSkins, setOwnedSkins] = useState([])
  const [loading, setLoading] = useState(true)

  const accept = useCallback((res) => {
    setToken(res.token)
    setUser(res.user)
    setOwnedSkins(res.ownedSkins || [])
    return res.user
  }, [])

  // Restore the session on load: a stored token, or Telegram's signed initData.
  useEffect(() => {
    let cancelled = false

    async function restore() {
      if (getToken()) {
        try {
          const res = await authApi.me()
          if (!cancelled) {
            setUser(res.user)
            setOwnedSkins(res.ownedSkins || [])
          }
          return
        } catch {
          setToken('') // expired or revoked
        }
      }
      const initData = tg?.initData
      if (initData) {
        try {
          const res = await authApi.telegram(initData)
          if (!cancelled) accept(res)
        } catch {
          // fall through to the login screen
        }
      }
    }

    restore().finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [accept])

  const value = useMemo(() => ({
    user,
    ownedSkins,
    loading,
    login: async (username, password) => accept(await authApi.login(username, password)),
    register: async (username, password) => accept(await authApi.register(username, password)),
    logout: () => {
      setToken('')
      setUser(null)
      setOwnedSkins([])
    },
    refresh: async () => {
      const res = await authApi.me()
      setUser(res.user)
      setOwnedSkins(res.ownedSkins || [])
      return res.user
    },
    patchUser: (patch) => setUser((u) => (u ? { ...u, ...patch } : u)),
  }), [user, ownedSkins, loading, accept])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
