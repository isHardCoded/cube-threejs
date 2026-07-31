const PREFIX = 'cube-game-light:'

export function lightStorageKey(mapId, isDay) {
  return `${PREFIX}${mapId || 'default'}:${isDay ? 'day' : 'night'}`
}

export function loadLightTweaks(mapId, isDay) {
  try {
    const raw = localStorage.getItem(lightStorageKey(mapId, isDay))
    if (!raw) return null
    const data = JSON.parse(raw)
    return data && typeof data === 'object' ? data : null
  } catch {
    return null
  }
}

export function saveLightTweaks(mapId, isDay, tweaks) {
  try {
    localStorage.setItem(lightStorageKey(mapId, isDay), JSON.stringify(tweaks))
  } catch {
    // quota / private mode — ignore
  }
}

export function clearLightTweaks(mapId, isDay) {
  try {
    localStorage.removeItem(lightStorageKey(mapId, isDay))
  } catch {
    // ignore
  }
}
