import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { themeFor } from './themes/index.js'
import { floorY } from './layouts.js'

const DAY_KEY = 'cube-game-day'

// Mild grade for themes that opt in (Stage 9). Canvas-only — React UI untouched.
const GradeShader = {
  name: 'JungleGradeShader',
  uniforms: {
    tDiffuse: { value: null },
    vignette: { value: 0 },
    contrast: { value: 1 },
    saturation: { value: 1 },
    sharpen: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float vignette;
    uniform float contrast;
    uniform float saturation;
    uniform float sharpen;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      // Soft unsharp — tiny only (toy look, not cinematic)
      if (sharpen > 0.001) {
        vec2 px = vec2(1.0 / 1280.0, 1.0 / 720.0);
        vec3 blur = (
          texture2D(tDiffuse, vUv + vec2( px.x, 0.0)).rgb +
          texture2D(tDiffuse, vUv + vec2(-px.x, 0.0)).rgb +
          texture2D(tDiffuse, vUv + vec2(0.0,  px.y)).rgb +
          texture2D(tDiffuse, vUv + vec2(0.0, -px.y)).rgb
        ) * 0.25;
        color.rgb += (color.rgb - blur) * sharpen;
      }
      color.rgb = (color.rgb - 0.5) * contrast + 0.5;
      float g = dot(color.rgb, vec3(0.299, 0.587, 0.114));
      color.rgb = mix(vec3(g), color.rgb, saturation);
      vec2 d = vUv - 0.5;
      float vig = 1.0 - dot(d, d) * vignette;
      color.rgb *= clamp(vig, 0.0, 1.0);
      gl_FragColor = color;
    }
  `,
}

// Phones get fewer samples and a lower pixel ratio; edges still read smooth
// because multisampling is doing the work instead of raw resolution.
const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
const SAMPLES = isMobile ? 2 : 4
const MAX_DPR = isMobile ? 1.75 : 2

// Renderer, lights, the map's backdrop and the follow camera. Everything
// map-specific comes from the theme; this module only wires it up.
export function createEnvironment(canvas, mapId) {
  const theme = themeFor(mapId)

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_DPR))
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  // Neutral keeps the flat cartoon colours; ACES was pulling everything towards
  // a smoky film look and washing the neon into a haze.
  renderer.toneMapping = THREE.NeutralToneMapping
  renderer.toneMappingExposure = 1.0

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(theme.night.sky)
  scene.fog = new THREE.Fog(theme.night.sky, theme.night.fogNear, theme.night.fogFar)

  // Jungle authored backdrop stretches ~100 units out; keep far plane roomy.
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 220)
  camera.position.set(0, 9, 10)

  // The composer renders into its own target, so the renderer's `antialias` flag
  // does nothing on its own — the multisampled target is what smooths the edges.
  const size = new THREE.Vector2()
  renderer.getDrawingBufferSize(size)
  const aaTarget = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    samples: SAMPLES,
  })
  const composer = new EffectComposer(renderer, aaTarget)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    theme.night.bloom,
    0.5,  // radius: wide and faint reads as soft light, not as glare
    0.85  // threshold: only the brightest neon blooms at all
  )
  composer.addPass(bloom)

  // Optional theme grade (jungle Stage 9). Other maps skip — no cinematic stack.
  let grade = null
  if (theme.post) {
    grade = new ShaderPass(GradeShader)
    const p = theme.post
    grade.uniforms.vignette.value = p.vignette ?? 0.25
    grade.uniforms.contrast.value = p.contrast ?? 1.05
    grade.uniforms.saturation.value = p.saturation ?? 1.06
    grade.uniforms.sharpen.value = p.sharpen ?? 0.08
    composer.addPass(grade)
  }
  composer.addPass(new OutputPass())

  // --- lights ---
  const hemi = new THREE.HemisphereLight(theme.night.hemiSky, theme.night.hemiGround, 1)
  scene.add(hemi)

  // one directional light plays sun by day and moon by night
  const sun = new THREE.DirectionalLight(theme.night.sunColor, 1)
  sun.position.set(12, 26, 10)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.left = -16
  sun.shadow.camera.right = 16
  sun.shadow.camera.top = 20
  sun.shadow.camera.bottom = -16
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 60
  sun.shadow.bias = -0.0006
  sun.shadow.normalBias = 0.02
  sun.shadow.radius = 3 // softer contact edges, in keeping with the cartoon look
  scene.add(sun)

  const accentA = new THREE.PointLight(theme.accents[0], 1, 26)
  accentA.position.set(-7, 4, -7)
  scene.add(accentA)

  const accentB = new THREE.PointLight(theme.accents[1], 1, 26)
  accentB.position.set(7, 4, 7)
  scene.add(accentB)

  // light from below so the bottom platform floats over coloured haze
  const underGlow = new THREE.PointLight(theme.night.underGlow, 1, 22)
  underGlow.position.set(0, -4, 0)
  scene.add(underGlow)

  // animated bits shared with the prop factories and the platform builder
  const fx = { blinkers: [], holos: [], platformSpots: [] }

  const backdrop = theme.createBackdrop(scene, fx)

  // --- day / night ---
  let isDay = localStorage.getItem(DAY_KEY) === '1'
  let accentBase = theme.night.accentIntensity

  function setDayMode(day) {
    isDay = day
    localStorage.setItem(DAY_KEY, day ? '1' : '0')
    const m = day ? theme.day : theme.night

    scene.background.set(m.sky)
    scene.fog.color.set(m.sky)
    scene.fog.near = m.fogNear
    scene.fog.far = m.fogFar

    hemi.color.set(m.hemiSky)
    hemi.groundColor.set(m.hemiGround)
    hemi.intensity = m.hemiIntensity

    sun.color.set(m.sunColor)
    sun.intensity = m.sunIntensity

    bloom.strength = m.bloom
    renderer.toneMappingExposure = m.exposure
    if (grade && m.post) {
      grade.uniforms.vignette.value = m.post.vignette ?? grade.uniforms.vignette.value
      grade.uniforms.contrast.value = m.post.contrast ?? grade.uniforms.contrast.value
      grade.uniforms.saturation.value = m.post.saturation ?? grade.uniforms.saturation.value
      grade.uniforms.sharpen.value = m.post.sharpen ?? grade.uniforms.sharpen.value
    }

    accentBase = m.accentIntensity
    underGlow.color.set(m.underGlow)
    underGlow.intensity = m.underGlowIntensity
    for (const s of fx.platformSpots) {
      s.color.set(m.spot)
      s.intensity = m.spotIntensity
    }
    backdrop.setDay(day)
  }

  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_DPR))
    renderer.setSize(window.innerWidth, window.innerHeight)
    composer.setSize(window.innerWidth, window.innerHeight)
  }

  function update(dt, t) {
    backdrop.update(dt, t)

    for (const b of fx.blinkers) {
      b.mesh.material.emissiveIntensity = 0.55 + Math.sin(t * b.speed + b.phase) * 0.35
    }
    for (const h of fx.holos) {
      h.rotation.y = t * 1.2
      h.position.y = 2.0 + Math.sin(t * 2) * 0.08
    }

    // accent lights breathe, which keeps the arena from looking baked
    accentA.intensity = accentBase * (1 + Math.sin(t * 1.7) * 0.16)
    accentB.intensity = accentBase * (1 + Math.cos(t * 1.3) * 0.16)
  }

  // --- follow camera ---
  const camOffset = new THREE.Vector3(0, 8.5, 9.5)
  const camTarget = new THREE.Vector3()
  const lookTarget = new THREE.Vector3(0, 0.5, 0)
  const lookGoal = new THREE.Vector3()
  let shake = 0

  const addShake = (v) => { shake = Math.max(shake, v) }

  // focus: { x, z, level } of the die the camera rides with
  function updateCamera(dt, t, focus) {
    const fx2 = focus ? focus.x : 0
    const fz = focus ? focus.z : 0
    const lvlY = focus ? floorY(focus.level, theme.arenaLift || 0) : 0

    camTarget.set(fx2 * 0.55 + Math.sin(t * 0.25) * 0.6, lvlY, fz * 0.55).add(camOffset)
    // frame-rate independent smoothing: reaches 99.9% of the target in a second
    camera.position.lerp(camTarget, 1 - Math.pow(0.0006, dt))
    if (shake > 0) {
      shake = Math.max(0, shake - dt * 1.4)
      camera.position.x += (Math.random() - 0.5) * shake * 0.3
      camera.position.y += (Math.random() - 0.5) * shake * 0.3
    }
    lookGoal.set(fx2 * 0.6, lvlY + 0.5, fz * 0.6)
    lookTarget.lerp(lookGoal, 1 - Math.pow(0.0006, dt))
    camera.lookAt(lookTarget)
  }

  function render() {
    composer.render()
  }

  function dispose() {
    composer.dispose?.()
    aaTarget.dispose()
    renderer.dispose()
  }

  return {
    scene, camera, renderer, fx, theme,
    setDayMode, isDay: () => isDay,
    resize, update, updateCamera, render, addShake, dispose,
    splash(x, z, strength = 1) {
      return backdrop.splash?.(x, z, strength) || false
    },
  }
}
