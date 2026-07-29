import * as THREE from 'three'
import { themeFor } from './themes/index.js'
import { cloneGltf, getGltfTemplate } from './assets/gltf.js'

function centerObject(root) {
  root.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(root)
  if (box.isEmpty()) return root
  const center = box.getCenter(new THREE.Vector3())
  root.position.sub(center)
  root.updateMatrixWorld(true)
  return root
}

/** Clone asset root without inheriting huge world placement; keep local scale. */
function cloneForPreview(asset) {
  const clone = asset.clone(true)
  clone.position.set(0, 0, 0)
  clone.rotation.set(0, 0, 0)
  // Cap absurd authored scales (DirtRing / mountains) before preview normalize.
  const sx = Math.abs(clone.scale.x) || 1
  if (sx > 8) clone.scale.setScalar(1)
  return clone
}

function cloneAsset(url) {
  return cloneGltf(url) || cloneGltf(String(url).replace(/\?.*$/, ''))
}

function typeKeyFromName(name) {
  let n = (name || 'mesh').replace(/\.\d+$/, '')
  if (n.startsWith('KitInst_')) {
    const rest = n.slice('KitInst_'.length)
    // KitInst_012_Bush_A  or  KitInst_PalmShore_00
    if (/^\d+_/.test(rest)) return rest.replace(/^\d+_/, '')
    return rest.replace(/_\d+$/, '')
  }
  // JungleTree_00 / Foam_03 -> JungleTree / Foam
  return n.replace(/_\d+$/, '')
}

function findAssetRoot(mesh) {
  let best = mesh
  let o = mesh
  while (o && o.parent) {
    const n = (o.name || '').replace(/\.\d+$/, '')
    if (
      n
      && !/^Scene/i.test(n)
      && n !== 'RootNode'
      && n !== 'Node'
    ) {
      best = o
      if (
        n.startsWith('KitInst_')
        || /_[0-9]+$/.test(n)
        || /^(Bee|Butterfly|Caterpillar|Palm|Bush|Rock|Fern|Hill|Mountain)/i.test(n)
      ) {
        return o
      }
    }
    if (o.parent.type === 'Scene') break
    o = o.parent
  }
  return best
}

const SKIP_TYPES = new Set([
  // gameplay / review proxies if they ever leak in
  'Arena', 'Obs', 'Col', 'Tpl', 'Template', 'Review', 'VisCell', 'MatSwatch',
])

/** Unique backdrop object types from the authored scene GLB. */
function itemsFromBackdrop(url, mapId) {
  const root = getGltfTemplate(url) || getGltfTemplate(String(url).replace(/\?.*$/, ''))
  if (!root) return []
  root.updateMatrixWorld(true)

  const exemplars = new Map() // typeKey -> Object3D
  root.traverse((obj) => {
    if (!obj.isMesh || obj.visible === false) return
    const asset = findAssetRoot(obj)
    const key = typeKeyFromName(asset.name)
    if (!key || SKIP_TYPES.has(key.split('_')[0])) return
    if (exemplars.has(key)) return
    exemplars.set(key, asset)
  })

  return [...exemplars.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, asset]) => ({
      id: `bg:${id}`,
      labelKey: `assets.${mapId}.${id}`,
      fallback: id,
      build() {
        return centerObject(cloneForPreview(asset))
      },
    }))
}

/** Build a catalog of inspectable meshes for the current map. */
export function mapAssetCatalog(mapId) {
  const theme = themeFor(mapId)
  const fx = { blinkers: [], holos: [], platformSpots: [] }
  const props = theme.createProps(fx)
  const items = []
  const seen = new Set()

  function push(id, fallback, build) {
    if (seen.has(id)) return
    seen.add(id)
    items.push({
      id,
      labelKey: `assets.${mapId}.${id}`,
      fallback,
      build: () => centerObject(build() || new THREE.Group()),
    })
  }

  // 1) Obstacle / prop factories used on the board
  for (const [kind, fn] of Object.entries(props.byKind || {})) {
    push(kind, kind, () => {
      const obj = fn(0, 0)
      obj.position.set(0, 0, 0)
      obj.rotation.set(0, 0, 0)
      return obj
    })
  }

  if (typeof props.trampoline === 'function') {
    push('trampoline', 'trampoline', () => {
      const { g } = props.trampoline()
      g.visible = true
      g.position.set(0, 0, 0)
      return g
    })
  }

  for (const extra of theme.libraryExtras || []) {
    push(extra.id, extra.label || extra.id, () => extra.build())
  }

  // 2) Standalone prop GLBs (piranha, etc.)
  for (const url of theme.assets || []) {
    const m = String(url).match(/\/props\/([^/?#]+)\.glb/)
    if (!m) continue
    const id = m[1]
    push(id, id, () => cloneAsset(url))
  }

  // 3) Every unique type from the authored backdrop scene
  const sceneUrl = (theme.assets || []).find((u) => /\/backdrop\/scene\.glb/.test(String(u)))
  if (sceneUrl) {
    for (const it of itemsFromBackdrop(sceneUrl, mapId)) {
      // Prefer board prop entry when id matches (tree, fern, …)
      const bare = it.id.replace(/^bg:/, '')
      if (seen.has(bare)) continue
      if (seen.has(it.id)) continue
      seen.add(it.id)
      items.push(it)
    }
  }

  return items
}
