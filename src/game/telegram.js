import { UI_BG } from '../config/brand.js'

export const tg = window.Telegram?.WebApp

let initialized = false

function enterFullscreen() {
  if (!tg || tg.isFullscreen) return
  try {
    tg.requestFullscreen?.()
  } catch {
    // Older clients / desktop without Bot API 8.0 — expand() still applied.
  }
}

// Mirror Telegram insets into CSS vars so menus + HUD clear the TG chrome
// (Close / ···), especially in fullscreen where env(safe-area) alone is not enough.
function syncSafeArea() {
  if (!tg) return
  const root = document.documentElement
  const sa = tg.safeAreaInset || {}
  const ca = tg.contentSafeAreaInset || {}
  for (const [key, val] of [
    ['--tg-safe-area-inset-top', sa.top],
    ['--tg-safe-area-inset-bottom', sa.bottom],
    ['--tg-safe-area-inset-left', sa.left],
    ['--tg-safe-area-inset-right', sa.right],
    ['--tg-content-safe-area-inset-top', ca.top],
    ['--tg-content-safe-area-inset-bottom', ca.bottom],
    ['--tg-content-safe-area-inset-left', ca.left],
    ['--tg-content-safe-area-inset-right', ca.right],
  ]) {
    root.style.setProperty(key, `${Number(val) || 0}px`)
  }
  root.classList.toggle('has-tg-content-inset', (Number(ca.top) || 0) > 0)
}

export function initTelegram() {
  if (!tg || initialized) return
  initialized = true
  document.documentElement.classList.add('is-tma')
  tg.ready()
  tg.expand()
  tg.disableVerticalSwipes?.()
  tg.setHeaderColor?.(UI_BG)
  tg.setBackgroundColor?.(UI_BG)
  syncSafeArea()
  enterFullscreen()
  tg.onEvent?.('activated', () => {
    syncSafeArea()
    enterFullscreen()
  })
  tg.onEvent?.('safeAreaChanged', syncSafeArea)
  tg.onEvent?.('contentSafeAreaChanged', syncSafeArea)
  tg.onEvent?.('fullscreenChanged', () => {
    syncSafeArea()
    if (!tg.isFullscreen) enterFullscreen()
  })
}

export const haptic = () => tg?.HapticFeedback?.impactOccurred?.('light')
export const hapticHeavy = () => tg?.HapticFeedback?.impactOccurred?.('heavy')
export const hapticError = () => tg?.HapticFeedback?.notificationOccurred?.('error')
