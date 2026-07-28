import { DEFAULT_LOCALE, ERROR_ALIASES, LOCALES, STORAGE_KEY, en, ru } from './messages.js'

const dicts = { ru, en }

let locale = readStored()
const listeners = new Set()

function readStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (LOCALES.includes(v)) return v
  } catch {
    // ignore
  }
  return DEFAULT_LOCALE
}

export function getLocale() {
  return locale
}

export function setLocale(next) {
  if (!LOCALES.includes(next) || next === locale) return
  locale = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // ignore
  }
  document.documentElement.lang = next === 'ru' ? 'ru' : 'en'
  listeners.forEach((fn) => fn(locale))
}

export function subscribeLocale(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function t(key, vars) {
  const table = dicts[locale] || dicts[DEFAULT_LOCALE]
  let text = table[key] ?? dicts[DEFAULT_LOCALE][key] ?? key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replaceAll(`{${k}}`, String(v))
    }
  }
  return text
}

export function translateError(message) {
  if (!message) return message
  const key = ERROR_ALIASES[message]
  if (key) return t(key)
  const status = /^Ошибка (\d+)$/.exec(message) || /^Error (\d+)$/.exec(message)
  if (status) return t('common.error', { status: status[1] })
  return message
}

// Apply lang attribute ASAP for the first paint.
document.documentElement.lang = locale === 'ru' ? 'ru' : 'en'
