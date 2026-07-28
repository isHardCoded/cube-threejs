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

export function initTelegram() {
  if (!tg || initialized) return
  initialized = true
  tg.ready()
  tg.expand()
  tg.disableVerticalSwipes?.()
  tg.setHeaderColor?.(UI_BG)
  tg.setBackgroundColor?.(UI_BG)
  enterFullscreen()
  // Keep fullscreen if Telegram drops it (app reactivation / user swipe).
  tg.onEvent?.('activated', enterFullscreen)
  tg.onEvent?.('fullscreenChanged', () => {
    if (!tg.isFullscreen) enterFullscreen()
  })
}

export const haptic = () => tg?.HapticFeedback?.impactOccurred?.('light')
export const hapticHeavy = () => tg?.HapticFeedback?.impactOccurred?.('heavy')
export const hapticError = () => tg?.HapticFeedback?.notificationOccurred?.('error')
