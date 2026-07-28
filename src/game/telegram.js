import { UI_BG } from '../config/brand.js'

export const tg = window.Telegram?.WebApp

let initialized = false

export function initTelegram() {
  if (!tg || initialized) return
  initialized = true
  tg.ready()
  tg.expand()
  tg.disableVerticalSwipes?.()
  tg.setHeaderColor?.(UI_BG)
  tg.setBackgroundColor?.(UI_BG)
}

export const haptic = () => tg?.HapticFeedback?.impactOccurred?.('light')
export const hapticHeavy = () => tg?.HapticFeedback?.impactOccurred?.('heavy')
export const hapticError = () => tg?.HapticFeedback?.notificationOccurred?.('error')
