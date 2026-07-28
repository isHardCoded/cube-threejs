import { createContext, useContext } from 'react'

// Kept out of AuthContext.jsx so that file exports only a component:
// mixing a component and a hook in one module disables Fast Refresh.
export const AuthContext = createContext(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
