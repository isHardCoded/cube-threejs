import { useCallback, useEffect, useMemo, useState } from 'react'
import { auth as authApi } from '../api/client.js'
import { getToken, setToken } from './tokenStore.js'
import { tg } from '../game/telegram.js'
import { getStoredHatId } from '../game/hatStore.js'
import { AuthContext } from './context.js'

function withLocalHat(user) {
  if (!user) return user
  if (user.hatId) return user
  return { ...user, hatId: getStoredHatId() }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [ownedSkins, setOwnedSkins] = useState([])
  const [ownedMineSkins, setOwnedMineSkins] = useState([])
  const [ownedHats, setOwnedHats] = useState([])
  const [loading, setLoading] = useState(true)

  const accept = useCallback((res) => {
    setToken(res.token)
    setUser(withLocalHat(res.user))
    setOwnedSkins(res.ownedSkins || [])
    setOwnedMineSkins(res.ownedMineSkins || [])
    setOwnedHats(res.ownedHats || [])
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
            setUser(withLocalHat(res.user))
            setOwnedSkins(res.ownedSkins || [])
            setOwnedMineSkins(res.ownedMineSkins || [])
            setOwnedHats(res.ownedHats || [])
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
    ownedMineSkins,
    ownedHats,
    loading,
    login: async (username, password) => accept(await authApi.login(username, password)),
    register: async (username, password) => accept(await authApi.register(username, password)),
    logout: () => {
      setToken('')
      setUser(null)
      setOwnedSkins([])
      setOwnedMineSkins([])
      setOwnedHats([])
    },
    refresh: async () => {
      const res = await authApi.me()
      setUser(withLocalHat(res.user))
      setOwnedSkins(res.ownedSkins || [])
      setOwnedMineSkins(res.ownedMineSkins || [])
      setOwnedHats(res.ownedHats || [])
      return res.user
    },
    patchUser: (patch) => setUser((u) => (u ? { ...u, ...patch } : u)),
  }), [user, ownedSkins, ownedMineSkins, ownedHats, loading, accept])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
