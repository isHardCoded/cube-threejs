import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { DEFAULT_SKIN, createDie } from '../game/dice.js'
import { createHat, disposeHat, HAT_BASE_Y, HAT_BOB_AMP, HAT_BOB_SPEED, preloadHats } from '../game/hats.js'
import { createHands, disposeHands, updateHands, preloadHands } from '../game/hands.js'
import { createOrbit } from './orbitPreview.js'

// Small standalone viewport that reuses the in-game die factory. Drag to orbit,
// wheel to zoom; idle spin resumes when you let go.
export default function DiePreview({ skin = DEFAULT_SKIN, hatId = 'none', size = 180 }) {
  const holder = useRef(null)
  const api = useRef(null)
  const skinRef = useRef(skin)
  const hatRef = useRef(hatId)
  skinRef.current = skin
  hatRef.current = hatId

  useEffect(() => {
    const el = holder.current
    if (!el) return
    let cancelled = false

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 40)

    scene.add(new THREE.HemisphereLight('#ffffff', '#c9ddd0', 1.6))
    const key = new THREE.DirectionalLight('#ffffff', 2.2)
    key.position.set(2, 4, 3)
    scene.add(key)
    const rim = new THREE.PointLight(DEFAULT_SKIN.pip, 4, 8)
    rim.position.set(-2, 1, -2)
    scene.add(rim)

    const { group, bodyMat, pipMat } = createDie(DEFAULT_SKIN)
    scene.add(group)

    let hat = createHat(hatRef.current)
    scene.add(hat)

    let hands = createHands()
    scene.add(hands)

    const orbit = createOrbit(camera, {
      targetY: 0.15,
      dist: 3.4,
      minDist: 1.7,
      idleSpin: 0.4,
    })
    const detachOrbit = orbit.attach(el)

    function apply(next) {
      const s = { ...DEFAULT_SKIN, ...next }
      bodyMat.color.set(s.body)
      bodyMat.metalness = s.metalness
      bodyMat.roughness = s.roughness
      pipMat.color.set(s.pip)
      pipMat.emissive.set(s.pip)
      rim.color.set(s.pip)
    }

    function swapHat(id) {
      scene.remove(hat)
      disposeHat(hat)
      hat = createHat(id)
      scene.add(hat)
    }

    function fit() {
      const slot = Math.max(120, Math.min(size, Math.floor(el.clientWidth || size)))
      const px = Math.round(slot * 1.12)
      renderer.setSize(px, px, false)
      el.style.height = `${slot}px`
    }

    apply(skinRef.current)
    fit()

    // Swap to authored GLB once caches are warm (procedural / empty until then).
    Promise.all([preloadHats(), preloadHands()]).then(() => {
      if (cancelled) return
      swapHat(hatRef.current)
      scene.remove(hands)
      disposeHands(hands)
      hands = createHands()
      scene.add(hands)
    })

    let raf = 0
    const clock = new THREE.Clock()
    const tick = () => {
      const dt = Math.min(clock.getDelta(), 0.05)
      orbit.tick(dt)
      const bob = Math.sin(clock.elapsedTime * HAT_BOB_SPEED) * HAT_BOB_AMP
      const show = hat.userData.hatId && hat.userData.hatId !== 'none'
      hat.visible = !!show
      if (show) {
        hat.position.set(0, HAT_BASE_Y + bob, 0)
        hat.quaternion.identity()
      }
      updateHands(hands, { x: 0, y: 0, z: 0 }, {
        t: clock.elapsedTime,
        phase: 0.4,
        visible: true,
      })
      renderer.render(scene, camera)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    const ro = new ResizeObserver(fit)
    ro.observe(el.parentElement || el)

    api.current = { apply, swapHat }

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      detachOrbit()
      ro.disconnect()
      api.current = null
      disposeHat(hat)
      disposeHands(hands)
      renderer.domElement.remove()
      renderer.dispose()
    }
  }, [size])

  useEffect(() => {
    api.current?.apply(skin)
  }, [skin])

  useEffect(() => {
    api.current?.swapHat(hatId)
  }, [hatId])

  return <div ref={holder} className="model-preview" title="Drag to rotate · scroll to zoom" />
}
