import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { getLocale, setLocale, subscribeLocale, t, translateError } from './t.js'

const LocaleContext = createContext(null)

export function LocaleProvider({ children }) {
  const [locale, setLocaleState] = useState(getLocale)

  useEffect(() => subscribeLocale(setLocaleState), [])

  const value = useMemo(() => ({
    locale,
    setLocale,
    t,
    translateError,
  }), [locale])

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useLocale() {
  const ctx = useContext(LocaleContext)
  if (!ctx) throw new Error('useLocale outside LocaleProvider')
  return ctx
}
