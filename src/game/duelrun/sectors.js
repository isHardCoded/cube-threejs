import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { glow, toon } from '../themes/kit.js'

/** Shared jungle-style sector tile kit (same look as platforms.js). */
export function createSectorKit(theme) {
  const s = theme?.surface || {}
  const steps = theme?.materialSteps || 7
  const bevel = s.tileBevel ?? 0.11
  const bevelSegs = s.tileBevelSegs ?? 3
  const tileGeo = new RoundedBoxGeometry(0.96, 0.32, 0.96, bevelSegs, bevel)
  const boxGeo = new THREE.BoxGeometry(1, 1, 1)
  const heightJitter = s.tileHeightJitter ?? 0.022

  const tileMats = [
    toon(s.tileA || '#8CDB66', { steps }),
    toon(s.tileB || '#6BBC5C', { steps }),
  ]
  if (s.tileC) tileMats.push(toon(s.tileC, { steps }))
  if (s.tileD) tileMats.push(toon(s.tileD, { steps }))
  const baseMat = toon(s.base || '#F0D19E', { steps })
  const hazardMat = toon('#8a5050', { steps })
  const pitMat = toon('#1a1520', { steps })
  const rockMat = toon('#6a7380', { steps })
  const crateMat = toon(s.post || '#8a6444', { steps })
  const spikeMat = toon('#c45a5a', { steps })
  const lavaMat = toon('#e07030', { steps })
  const electricMat = glow('#6ec8ff', 0.35)
  const barrierMat = toon('#a87848', { steps })
  const wallMat = toon('#5a6a58', { steps })
  const hammerMat = toon('#9a7060', { steps })
  const pickupMat = toon('#ffe040', { steps })
  const postMat = toon(s.post || '#8a6444', { steps })
  const fenceMat = glow(s.fence || '#8CDB66', 0.07)

  function pickTileMat(x, z) {
    const checker = (x + z) & 1
    if (tileMats.length < 3) return tileMats[checker]
    const variant = ((x * 3 + z * 7) % (tileMats.length / 2 | 0)) | 0
    return tileMats[checker + variant * 2] || tileMats[checker]
  }

  function addObstacleMesh(group, x, z, yJ, kind, tall) {
    const t = kind || 'rock'
    let mesh
    if (t === 'crate') {
      mesh = new THREE.Mesh(new RoundedBoxGeometry(0.7, 0.7, 0.7, 2, 0.06), crateMat)
      mesh.position.set(x, 0.35 + yJ, z)
    } else if (t === 'rock') {
      mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(0.42, 0), rockMat)
      mesh.position.set(x, 0.38 + yJ, z)
      mesh.rotation.set(0.2, x * 0.7, 0.1)
    } else if (t === 'low_barrier') {
      mesh = new THREE.Mesh(new RoundedBoxGeometry(0.9, 0.45, 0.35, 2, 0.05), barrierMat)
      mesh.position.set(x, 0.22 + yJ, z)
    } else if (t === 'high_barrier' || t === 'wall') {
      const h = t === 'wall' ? 1.55 : 1.35
      mesh = new THREE.Mesh(new RoundedBoxGeometry(0.85, h, 0.4, 2, 0.06), t === 'wall' ? wallMat : barrierMat)
      mesh.position.set(x, h / 2 - 0.02 + yJ, z)
    } else if (t === 'spikes') {
      const g = new THREE.Group()
      for (let i = 0; i < 3; i++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.55, 5), spikeMat)
        spike.position.set(x + (i - 1) * 0.22, 0.28 + yJ, z)
        g.add(spike)
      }
      group.add(g)
      return
    } else if (t === 'lava' || t === 'piranha_water') {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.42, 0.18, 8), lavaMat)
      mesh.position.set(x, 0.08 + yJ, z)
    } else if (t === 'electric') {
      mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.35, 0), electricMat)
      mesh.position.set(x, 0.55 + yJ, z)
    } else if (t === 'swing_hammer' || t === 'spin_beam') {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 1.1, 6), hammerMat)
      mesh.position.set(x, 0.7 + yJ, z)
      mesh.rotation.z = Math.PI / 2
    } else if (t === 'moving_block' || t === 'falling_object') {
      mesh = new THREE.Mesh(new RoundedBoxGeometry(0.65, 0.65, 0.65, 2, 0.05), wallMat)
      mesh.position.set(x, 0.55 + yJ, z)
    } else if (t === 'crumble' || t === 'moving_platform') {
      mesh = new THREE.Mesh(new RoundedBoxGeometry(0.88, 0.2, 0.88, 2, 0.04), rockMat)
      mesh.position.set(x, 0.12 + yJ, z)
    } else {
      const h = tall ? 1.6 : 0.85
      mesh = new THREE.Mesh(new RoundedBoxGeometry(0.75, h, 0.75, 2, 0.08), hazardMat)
      mesh.position.set(x, h / 2 - 0.05 + yJ, z)
    }
    if (mesh) {
      mesh.castShadow = true
      group.add(mesh)
    }
  }

  function addCell(group, x, z, opts = {}) {
    const yJ = heightJitter
      ? ((((x * 12.9898 + z * 78.233) % 1) + 1) % 1 - 0.5) * 2 * heightJitter
      : 0
    if (opts.missing) {
      // gap — faint pit rim so the hole reads
      const rim = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.48, 10), pitMat)
      rim.rotation.x = -Math.PI / 2
      rim.position.set(x, -0.12 + yJ, z)
      group.add(rim)
      return
    }
    const mat = opts.hazard ? (opts.obsType === 'lava' ? lavaMat : hazardMat) : pickTileMat(x, z)
    const tile = new THREE.Mesh(tileGeo, mat)
    tile.position.set(x, -0.15 + yJ, z)
    tile.receiveShadow = true
    group.add(tile)

    const baseH = 0.55 + (((x * 7 + z * 13) % 10) / 10) * 0.5
    const base = new THREE.Mesh(boxGeo, opts.pit ? pitMat : baseMat)
    base.scale.set(0.9, baseH, 0.9)
    base.position.set(x, -0.3 - baseH / 2 + yJ, z)
    group.add(base)

    if (opts.blocker) {
      addObstacleMesh(group, x, z, yJ, opts.obsType, opts.tall)
    }
  }

  function addPickup(group, x, z, id = '') {
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), pickupMat)
    gem.position.set(x, 0.75, z)
    gem.userData.pickup = true
    gem.userData.pickupId = id || `${x},${z}`
    group.add(gem)
  }

  /** Visual side rails like classic arena fence: walk/dash bump, jump can clear. */
  function addSideRails(group, z0, z1) {
    const fence = 1.62 // just outside lanes x=±1
    const postGeo = new THREE.CylinderGeometry(0.03, 0.045, 0.62, 6)
    const railLen = Math.max(1, z1 - z0 + 1)
    const railGeo = new THREE.BoxGeometry(0.032, 0.032, railLen + 0.2)
    const midZ = (z0 + z1) * 0.5
    for (let z = z0; z <= z1; z++) {
      for (const px of [-fence, fence]) {
        const post = new THREE.Mesh(postGeo, postMat)
        post.position.set(px, 0.31, z)
        post.userData.rim = true
        group.add(post)
      }
    }
    for (const y of [0.3, 0.56]) {
      for (const px of [-fence, fence]) {
        const rail = new THREE.Mesh(railGeo, fenceMat)
        rail.position.set(px, y, midZ)
        rail.userData.rim = true
        group.add(rail)
      }
    }
  }

  return {
    addCell, addPickup, addSideRails, tileGeo,
    dispose() { tileGeo.dispose(); boxGeo.dispose() },
  }
}

/** Lane index 0/1/2 → world X cell (-1/0/1). */
export function laneToX(lane) {
  return (lane | 0) - 1
}
