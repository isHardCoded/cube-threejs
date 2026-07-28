// Playable worlds. Each id has a server hub with its own layout and a client
// theme in src/game/themes with its own lighting, backdrop and props.
// Banners live in /public/maps and are served as static assets.
export const MAPS = [
  { id: 'cyberpunk', name: 'Кибер', desc: 'Ночной город', ready: true, banner: '/maps/cyberpunk.png?v=2' },
  { id: 'lava', name: 'Лава', desc: 'Вулканы', ready: true, banner: '/maps/lava.png?v=2' },
  { id: 'desert', name: 'Пустыня', desc: 'Оазис', ready: true, banner: '/maps/desert.png?v=2' },
  { id: 'kawaii', name: 'Китти', desc: 'Сладкий мир', ready: true, banner: '/maps/kawaii.png?v=2' },
  { id: 'jungle', name: 'Джунгли', desc: 'Густой лес', ready: true, banner: '/maps/jungle.png?v=1' },
  { id: 'ocean', name: 'Океан', desc: 'Под водой', ready: true, banner: '/maps/ocean.png?v=1' },
]

export const DEFAULT_MAP = 'cyberpunk'

// Guards the ?map= query: an unknown or not-yet-playable id falls back.
export function resolveMapId(id) {
  return MAPS.some((m) => m.id === id && m.ready) ? id : DEFAULT_MAP
}
