import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { DEFAULT_SKIN, createDie } from '../game/dice.js'

// Small standalone viewport that reuses the in-game die factory, so the preview
// cannot drift from what the arena actually renders. The scene is mounted once;
// swapping a skin only recolors the existing materials so the spin keeps going.
export default function DiePreview({ skin = DEFAULT_SKIN, size = 180 }) {
  const holder = useRef(null)
  const api = useRef(null)
  const skinRef = useRef(skin)
  skinRef.current = skin

  useEffect(() => {
    const el = holder.current
    if (!el) return

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 20)
    camera.position.set(1.7, 1.5, 2.2)
    camera.lookAt(0, 0, 0)

    scene.add(new THREE.HemisphereLight('#ffffff', '#c9ddd0', 1.6))
    const key = new THREE.DirectionalLight('#ffffff', 2.2)
    key.position.set(2, 4, 3)
    scene.add(key)
    const rim = new THREE.PointLight(DEFAULT_SKIN.pip, 4, 8)
    rim.position.set(-2, 1, -2)
    scene.add(rim)

    const { group, bodyMat, pipMat } = createDie(DEFAULT_SKIN)
    scene.add(group)

    function apply(next) {
      const s = { ...DEFAULT_SKIN, ...next }
      bodyMat.color.set(s.body)
      bodyMat.metalness = s.metalness
      bodyMat.roughness = s.roughness
      pipMat.color.set(s.pip)
      pipMat.emissive.set(s.pip)
      rim.color.set(s.pip)
    }

    function fit() {
      // Prefer the caller's size, but shrink to the card width on a phone so the
      // canvas never overflows and never stretches a low-res buffer.
      const px = Math.max(120, Math.min(size, Math.floor(el.clientWidth || size)))
      renderer.setSize(px, px, false)
      el.style.width = `${px}px`
      el.style.height = `${px}px`
    }

    apply(skinRef.current)
    fit()

    let raf = 0
    const clock = new THREE.Clock()
    const tick = () => {
      const t = clock.getElapsedTime()
      group.rotation.y = t * 0.7
      group.rotation.x = Math.sin(t * 0.5) * 0.35
      renderer.render(scene, camera)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    const ro = new ResizeObserver(fit)
    ro.observe(el.parentElement || el)

    api.current = { apply }

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      api.current = null
      renderer.domElement.remove()
      renderer.dispose()
    }
  }, [size])

  useEffect(() => {
    api.current?.apply(skin)
  }, [skin])

  return <div ref={holder} className="die-preview" />
}
