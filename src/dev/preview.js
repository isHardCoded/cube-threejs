import * as THREE from 'three'
import { createEnvironment } from '../game/environment.js'
import { createArena } from '../game/platforms.js'
import { createDie } from '../game/dice.js'
import { levelY } from '../game/layouts.js'

// Dev harness for the map themes: no server, no networking, no gameplay. Open
//   /preview.html?map=lava&day=0&level=0
// to judge lighting and props, which is the one thing the game itself makes slow
// to check (you would have to log in, pick the map and wait for a round).

const KINDS = {
  cyberpunk: ['pylon', 'crate', 'barrel', 'column', 'antenna'],
  lava: ['spire', 'boulder', 'vent', 'basalt'],
  desert: ['cactus', 'palm', 'rock', 'ruin'],
  kawaii: ['bow', 'gift', 'heart', 'cloud'],
  jungle: ['tree', 'vine', 'stump', 'fern'],
  ocean: ['coral', 'kelp', 'serock', 'anemone'],
}

const SKINS = [
  { id: 'chrome-yellow', body: '#ffcf3f', pip: '#3c3010', metalness: 0.1, roughness: 0.55 },
  { id: 'cyan-glass', body: '#54d8e8', pip: '#0e3a44', metalness: 0.1, roughness: 0.55 },
  { id: 'magenta-neon', body: '#ff74a6', pip: '#4a1330', metalness: 0.1, roughness: 0.55 },
]

const params = new URLSearchParams(location.search)
const mapId = params.get('map') || 'cyberpunk'
const level = Number(params.get('level') || 0)
const day = params.get('day') === '1'

// one obstacle of every kind, laid out in a readable row, plus a ring of them
function sampleLayout(id) {
  const kinds = KINDS[id] || KINDS.cyberpunk
  const cells = [
    [-4, -4], [-2, -4], [0, -4], [2, -4], [4, -4],
    [-4, 0], [4, 0], [-4, 4], [0, 4], [4, 4],
    [-2, 2], [2, -2], [3, 3], [-3, -1],
  ]
  return {
    obstacles: cells.map(([x, z], i) => ({ x, z, kind: kinds[i % kinds.length] })),
    decals: [[1, 1], [-1, -1], [1, -3]],
  }
}

const canvas = document.getElementById('scene')
const env = createEnvironment(canvas, mapId)
// the composer's last pass would otherwise reset the counters to "one quad"
env.renderer.info.autoReset = false
const arena = createArena(env)
arena.build([sampleLayout(mapId), sampleLayout(mapId), sampleLayout(mapId)])
env.setDayMode(day)
arena.showTramp(level, 0, 0)

// a few cubes to judge readability against the floor
const dice = SKINS.map((skin, i) => {
  const { group } = createDie(skin)
  group.position.set(-1 + i * 1.6, levelY(level) + 0.5, 1.5 - i * 0.4)
  group.rotation.y = i * 0.7
  env.scene.add(group)
  const light = new THREE.PointLight(skin.body, 1.6, 3.5)
  light.position.y = 0.2
  group.add(light)
  return group
})

// draw calls and triangles are the numbers that decide whether a phone can run
// this, and they are the same on every machine — unlike an FPS reading
const hint = document.getElementById('hint')
let hintAt = 0
function showStats(t) {
  if (t - hintAt < 1) return
  hintAt = t
  const r = env.renderer.info.render
  const m = env.renderer.info.memory
  hint.textContent = `${mapId} · level ${level} · ${day ? 'day' : 'night'}`
    + ` · ${r.calls} calls · ${(r.triangles / 1000).toFixed(1)}k tris`
    + ` · ${m.geometries} geo / ${m.textures} tex`
}

window.addEventListener('resize', () => env.resize())

const clock = new THREE.Clock()
let orbit = 0
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05)
  const t = clock.elapsedTime
  arena.update(dt, t, level)
  env.update(dt, t)

  // slow orbit around the platform so props are seen from every side
  orbit += dt * 0.15
  const focus = { x: Math.cos(orbit) * 2.5, z: Math.sin(orbit) * 2.5, level }
  env.updateCamera(dt, t, focus)

  for (const d of dice) d.rotation.y += dt * 0.4
  env.renderer.info.reset()
  env.render()
  showStats(t)
  requestAnimationFrame(tick)
}
tick()
