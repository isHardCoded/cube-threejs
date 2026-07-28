import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { createMineModel, DEFAULT_MINE_SKIN, disposeMineModel } from '../game/mineModels.js'
import { createOrbit } from './orbitPreview.js'

// Wardrobe viewport for mine cosmetics — same factory as the arena, with orbit
// + zoom so you can inspect the model before equipping.
export default function MinePreview({ skinId = DEFAULT_MINE_SKIN, size = 180 }) {
  const holder = useRef(null)
  const api = useRef(null)
  const idRef = useRef(skinId)
  idRef.current = skinId

  useEffect(() => {
    const el = holder.current
    if (!el) return

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 40)

    scene.add(new THREE.HemisphereLight('#ffffff', '#d8cfc0', 1.5))
    const key = new THREE.DirectionalLight('#ffffff', 2.4)
    key.position.set(2.2, 4, 2.5)
    scene.add(key)
    const fill = new THREE.PointLight('#ffe8c8', 3.5, 10)
    fill.position.set(-2, 1.5, -1.5)
    scene.add(fill)

    const pivot = new THREE.Group()
    scene.add(pivot)

    let current = null

    function swap(id) {
      if (current) {
        pivot.remove(current.group)
        disposeMineModel(current.group)
      }
      current = createMineModel(id)
      // Arena mines are tiny; scale them up for the wardrobe card.
      current.group.scale.setScalar(2.8)
      current.group.position.y = -0.15
      pivot.add(current.group)
    }

    swap(idRef.current)

    const orbit = createOrbit(camera, {
      targetY: 0.35,
      dist: 3.6,
      minDist: 1.8,
      idleSpin: 0.4,
    })
    const detachOrbit = orbit.attach(el)

    function fit() {
      const slot = Math.max(120, Math.min(size, Math.floor(el.clientWidth || size)))
      const px = Math.round(slot * 1.12)
      renderer.setSize(px, px, false)
      el.style.height = `${slot}px`
    }
    fit()

    let raf = 0
    const clock = new THREE.Clock()
    const tick = () => {
      const dt = Math.min(clock.getDelta(), 0.05)
      orbit.tick(dt)
      if (current?.lamp?.material) {
        const t = clock.elapsedTime
        current.lamp.material.emissiveIntensity = 0.45 + Math.abs(Math.sin(t * 2.4)) * 0.7
      }
      renderer.render(scene, camera)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    const ro = new ResizeObserver(fit)
    ro.observe(el.parentElement || el)

    api.current = { swap }

    return () => {
      cancelAnimationFrame(raf)
      detachOrbit()
      ro.disconnect()
      api.current = null
      if (current) disposeMineModel(current.group)
      renderer.domElement.remove()
      renderer.dispose()
    }
  }, [size])

  useEffect(() => {
    api.current?.swap(skinId)
  }, [skinId])

  return <div ref={holder} className="model-preview" title="Drag to rotate · scroll to zoom" />
}
