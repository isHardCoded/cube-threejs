// Playable worlds. Each id has a server hub with its own layout and a client
// theme in src/game/themes with its own lighting, backdrop and props.
// Banners live in /public/maps and are served as static assets.
export const MAPS = [
  { id: 'cyberpunk', name: 'Кибер', desc: 'Ночной город', ready: true, banner: '/maps/cyberpunk.png' },
  { id: 'lava', name: 'Лава', desc: 'Вулканы', ready: true, banner: '/maps/lava.png' },
  { id: 'desert', name: 'Пустыня', desc: 'Оазис', ready: true, banner: '/maps/desert.png' },
]

export const DEFAULT_MAP = 'cyberpunk'

// Guards the ?map= query: an unknown or not-yet-playable id falls back.
export function resolveMapId(id) {
  return MAPS.some((m) => m.id === id && m.ready) ? id : DEFAULT_MAP
}
