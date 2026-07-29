import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { createOrbit } from './orbitPreview.js'

const TARGET_SIZE = 1.85

/** Scale + center any authored mesh so it fits the orbit preview. */
function normalizeForPreview(obj) {
  obj.updateMatrixWorld(true)
  let box = new THREE.Box3().setFromObject(obj)
  if (box.isEmpty()) return
  const size = box.getSize(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z, 1e-4)
  const s = TARGET_SIZE / maxDim
  obj.scale.multiplyScalar(s)
  obj.updateMatrixWorld(true)
  box = new THREE.Box3().setFromObject(obj)
  if (box.isEmpty()) return
  const center = box.getCenter(new THREE.Vector3())
  obj.position.sub(center)
  obj.updateMatrixWorld(true)
}

/** Right-pane 3D viewer: drag to orbit, wheel to zoom. */
export default function MapAssetPreview({ build, title }) {
  const holder = useRef(null)
  const api = useRef(null)

  useEffect(() => {
    const el = holder.current
    if (!el) return

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'low-power',
    })
    renderer.setClearColor(0x000000, 0)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 200)

    scene.add(new THREE.HemisphereLight('#f4fbff', '#7aa868', 1.35))
    const key = new THREE.DirectionalLight('#fff5e8', 1.8)
    key.position.set(3, 5, 2)
    scene.add(key)
    const fill = new THREE.DirectionalLight('#b8d8ef', 0.55)
    fill.position.set(-3, 2, -2)
    scene.add(fill)

    const stage = new THREE.Group()
    scene.add(stage)

    const orbit = createOrbit(camera, {
      targetY: 0,
      dist: 3.4,
      minDist: 1.4,
      idleSpin: 0.35,
    })
    const detachOrbit = orbit.attach(el)

    function show(nextBuild) {
      while (stage.children.length) {
        stage.remove(stage.children[0])
      }
      if (!nextBuild) return
      try {
        const obj = nextBuild()
        if (!obj) return
        // Drop any leftover world-scale from backdrop clones, then fit.
        normalizeForPreview(obj)
        stage.add(obj)
        orbit.frame(3.4, 0.75, 0.42)
      } catch (err) {
        console.warn('[MapAssetPreview]', err)
      }
    }

    function fit() {
      const w = Math.max(120, Math.floor(el.clientWidth || 0))
      const h = Math.max(120, Math.floor(el.clientHeight || 0))
      if (w < 2 || h < 2) return
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }

    fit()
    show(build)

    let raf = 0
    const clock = new THREE.Clock()
    const tick = () => {
      const dt = Math.min(clock.getDelta(), 0.05)
      orbit.tick(dt)
      renderer.render(scene, camera)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    const ro = new ResizeObserver(() => {
      fit()
    })
    ro.observe(el)

    api.current = { show }

    return () => {
      cancelAnimationFrame(raf)
      detachOrbit()
      ro.disconnect()
      api.current = null
      while (stage.children.length) stage.remove(stage.children[0])
      renderer.domElement.remove()
      // Dispose only this preview's GL resources — do NOT forceContextLoss
      // (that can nuke the main game canvas when contexts are recycled).
      renderer.dispose()
    }
  }, [])

  useEffect(() => {
    api.current?.show(build)
  }, [build])

  return (
    <div
      ref={holder}
      className="asset-preview"
      title={title || 'Drag to rotate · scroll to zoom'}
    />
  )
}
