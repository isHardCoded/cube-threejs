import { DEFAULT_HAT, hatExists } from './hats.js'

const HAT_KEY = 'cube-game-hat'

export function getStoredHatId() {
  const id = localStorage.getItem(HAT_KEY) || ''
  return hatExists(id) ? id : DEFAULT_HAT
}

export function setStoredHatId(hatId) {
  const id = hatExists(hatId) ? hatId : DEFAULT_HAT
  localStorage.setItem(HAT_KEY, id)
  return id
}
