import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { themeFor } from './themes/index.js'
import { floorY } from './layouts.js'
import { createGodrayPass, updateGodraySun } from './gfx/godrayPass.js'
import {
  getQualityPreference,
  resolveProfile,
  applyThemeQualityOverrides,
  stepTier,
} from './gfx/quality.js'
import { SPRITE_LAYER } from './sprites.js'

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

const DEFAULT_SHADOWS = {
  mapSize: 2048,
  mapSizeMobile: 2048,
  extent: 16,
  extentY: 20,
  near: 1,
  far: 60,
  bias: -0.0006,
  normalBias: 0.02,
  radius: 3,
  follow: false,
  sunOffset: [12, 26, 10],
}

// Renderer, lights, the map's backdrop and the follow camera. Everything
// map-specific comes from the theme; this module only wires it up.
export function createEnvironment(canvas, mapId) {
  const theme = themeFor(mapId)
  const shadowCfg = { ...DEFAULT_SHADOWS, ...(theme.shadows || {}) }
  const gfx = theme.gfx || {}

  let qualityPref = getQualityPreference()
  let profile = applyThemeQualityOverrides(resolveProfile(qualityPref), theme.gfx || {})
  let adaptiveTier = profile.id

  const wantAo = !!gfx.ao && profile.ao
  const wantGodray = !!gfx.godray && profile.godray
  const wantShadows = profile.shadows !== false

  // EffectComposer owns AA via the MSAA render target — canvas AA would double the cost.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, profile.maxDpr))
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.shadowMap.enabled = wantShadows
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
  // Layer 0 = world (composer). Layer 1 = nameplates/popups (drawn after post).
  camera.layers.enable(0)
  camera.layers.enable(SPRITE_LAYER)

  const size = new THREE.Vector2()
  renderer.getDrawingBufferSize(size)
  const aaTarget = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    samples: profile.msaaSamples,
  })
  const composer = new EffectComposer(renderer, aaTarget)
  composer.addPass(new RenderPass(scene, camera))

  let gtao = null
  if (wantAo) {
    const aoW = Math.max(1, Math.round(size.x * profile.aoScale))
    const aoH = Math.max(1, Math.round(size.y * profile.aoScale))
    gtao = new GTAOPass(scene, camera, aoW, aoH)
    gtao.output = GTAOPass.OUTPUT.Default
    gtao.blendIntensity = gfx.aoIntensity ?? 0.32
    if (typeof gtao.updateGtaoMaterial === 'function') {
      gtao.updateGtaoMaterial({
        radius: gfx.aoRadius ?? 0.35,
        distanceExponent: 1.5,
        thickness: 0.85,
        scale: 1.0,
        samples: profile.aoSamples,
        distanceFallOff: 0.85,
      })
    }
    // Denoise is a second full-screen pass — keep it light.
    if (typeof gtao.updatePdMaterial === 'function') {
      gtao.updatePdMaterial({
        lumaPhi: 10,
        depthPhi: 2,
        normalPhi: 3,
        radius: 4,
        radiusExponent: 1,
        rings: 2,
        samples: profile.id === 'high' ? 8 : 6,
      })
    }
    composer.addPass(gtao)
  }

  // Bloom before godrays so sky/palm gaps are bright enough to punch shafts through.
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(
      Math.max(1, Math.round(size.x * profile.bloomScale)),
      Math.max(1, Math.round(size.y * profile.bloomScale)),
    ),
    theme.night.bloom,
    0.55,
    0.78,
  )
  composer.addPass(bloom)

  let godray = null
  if (wantGodray) {
    godray = createGodrayPass({
      spread: gfx.godraySpread,
    })
    composer.addPass(godray)
  }

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

  const [sunOx, sunOy, sunOz] = shadowCfg.sunOffset
  const sun = new THREE.DirectionalLight(theme.night.sunColor, 1)
  sun.position.set(sunOx, sunOy, sunOz)
  sun.castShadow = wantShadows

  function applyShadowVolume() {
    const enabled = profile.shadows !== false
    renderer.shadowMap.enabled = enabled
    sun.castShadow = enabled
    if (!enabled) return shadowCfg.extent * profile.shadowExtentScale

    const mapSize = profile.shadowMapSize
    if (sun.shadow.mapSize.x !== mapSize) {
      sun.shadow.mapSize.set(mapSize, mapSize)
      if (sun.shadow.map) {
        sun.shadow.map.dispose()
        sun.shadow.map = null
      }
    }
    const ext = shadowCfg.extent * profile.shadowExtentScale
    const extY = (shadowCfg.extentY ?? shadowCfg.extent) * profile.shadowExtentScale
    sun.shadow.camera.left = -ext
    sun.shadow.camera.right = ext
    sun.shadow.camera.top = extY
    sun.shadow.camera.bottom = -extY
    sun.shadow.camera.near = shadowCfg.near
    sun.shadow.camera.far = shadowCfg.far
    sun.shadow.bias = shadowCfg.bias
    sun.shadow.normalBias = shadowCfg.normalBias
    // Keep softness readable as mapSize drops
    const sizeRatio = mapSize / 2048
    sun.shadow.radius = shadowCfg.radius * Math.max(0.85, Math.min(1.15, 1 / Math.sqrt(sizeRatio)))
    sun.shadow.camera.updateProjectionMatrix()
    return ext
  }

  applyShadowVolume()
  scene.add(sun)
  scene.add(sun.target)

  // Soft opposite fill / rim — no shadows, keeps volume without washing albedo
  const fill = new THREE.DirectionalLight(
    gfx.fillColor || '#c8d8e8',
    gfx.fillIntensity ?? 0,
  )
  fill.position.set(-(sunOx * 0.7), sunOy * 0.55, -(sunOz * 0.7))
  fill.castShadow = false
  scene.add(fill)

  const accentA = new THREE.PointLight(theme.accents[0], 1, 26)
  accentA.position.set(-7, 4, -7)
  scene.add(accentA)

  const accentB = new THREE.PointLight(theme.accents[1], 1, 26)
  accentB.position.set(7, 4, 7)
  scene.add(accentB)

  const underGlow = new THREE.PointLight(theme.night.underGlow, 1, 22)
  underGlow.position.set(0, -4, 0)
  scene.add(underGlow)

  const fx = { blinkers: [], holos: [], platformSpots: [] }

  const backdrop = theme.createBackdrop(scene, fx, {
    mobile: profile.id === 'perf',
    shadowCast: profile.shadowCast,
    moteScale: profile.moteScale ?? 1,
  })

  const shadowCasters = []
  scene.traverse((obj) => {
    if (!obj.isMesh) return
    const tier = obj.userData.shadowCastTier
    if (tier === 'core' || tier === 'heavy') shadowCasters.push(obj)
  })

  let isDay = localStorage.getItem(DAY_KEY) === '1'
  let accentBase = theme.night.accentIntensity
  let godrayDayIntensity = gfx.godrayIntensity ?? 0.2
  const shadowFocus = new THREE.Vector3()
  const sunWorld = new THREE.Vector3()
  const casterWorld = new THREE.Vector3()
  /** @type {{ obj: THREE.Object3D, score: number }[]} */
  const casterRank = []
  let viewCullAccum = 0
  let viewCullBoot = true
  const VIEW_CULL_HZ = 8
  // Lock heavy shadow GPU state for the session — adaptive must not dispose maps mid-match.
  const sessionShadows = profile.shadows !== false
  const sessionShadowMapSize = profile.shadowMapSize

  const lightTweaks = {
    sunIntensity: 1,
    hemiIntensity: 1,
    fillIntensity: 0,
    exposure: 1,
    bloom: 0.05,
    godray: 0,
    godraySpread: 1.5,
    ao: 0.12,
    saturation: 1,
    contrast: 1,
    vignette: 0.2,
    fogNear: 40,
    fogFar: 120,
    underGlow: 0.4,
    accent: 1,
  }

  function syncTweaksFromMode() {
    const m = isDay ? theme.day : theme.night
    const p = m.post || theme.post || {}
    lightTweaks.sunIntensity = m.sunIntensity
    lightTweaks.hemiIntensity = m.hemiIntensity
    lightTweaks.fillIntensity = isDay
      ? (gfx.fillIntensity ?? 0)
      : (gfx.fillIntensityNight ?? (gfx.fillIntensity ?? 0) * 0.45)
    lightTweaks.exposure = m.exposure
    lightTweaks.bloom = m.bloom
    lightTweaks.godray = isDay ? (gfx.godrayIntensity ?? 0) : 0
    lightTweaks.godraySpread = gfx.godraySpread ?? 1.5
    lightTweaks.ao = isDay ? (gfx.aoIntensity ?? 0.12) : (gfx.aoIntensityNight ?? 0.26)
    lightTweaks.saturation = p.saturation ?? 1
    lightTweaks.contrast = p.contrast ?? 1
    lightTweaks.vignette = p.vignette ?? 0.2
    lightTweaks.fogNear = m.fogNear
    lightTweaks.fogFar = m.fogFar
    lightTweaks.underGlow = m.underGlowIntensity
    lightTweaks.accent = m.accentIntensity
  }

  function applyLightTweaks() {
    sun.intensity = lightTweaks.sunIntensity
    hemi.intensity = lightTweaks.hemiIntensity
    fill.intensity = lightTweaks.fillIntensity
    renderer.toneMappingExposure = lightTweaks.exposure
    bloom.strength = lightTweaks.bloom
    scene.fog.near = lightTweaks.fogNear
    scene.fog.far = lightTweaks.fogFar
    underGlow.intensity = lightTweaks.underGlow
    accentBase = lightTweaks.accent
    godrayDayIntensity = isDay ? lightTweaks.godray : 0
    if (godray) {
      godray.uniforms.uSpread.value = lightTweaks.godraySpread
      godray.enabled = isDay && lightTweaks.godray > 0.001
      if (!isDay) godray.uniforms.uIntensity.value = 0
    }
    if (gtao) gtao.blendIntensity = lightTweaks.ao
    if (grade) {
      grade.uniforms.saturation.value = lightTweaks.saturation
      grade.uniforms.contrast.value = lightTweaks.contrast
      grade.uniforms.vignette.value = lightTweaks.vignette
    }
  }

  function getLightTweaks() {
    return { ...lightTweaks }
  }

  function setLightTweaks(partial = {}) {
    Object.assign(lightTweaks, partial)
    applyLightTweaks()
    return getLightTweaks()
  }

  function applyShadowFollow(x, z) {
    if (!shadowCfg.follow) return
    shadowFocus.set(x, 0, z)
    sun.target.position.copy(shadowFocus)
    sun.target.updateMatrixWorld()
    sun.position.set(x + sunOx, sunOy, z + sunOz)
    fill.position.set(x - sunOx * 0.7, sunOy * 0.55, z - sunOz * 0.7)
  }

  function updateShadowCasterCull() {
    const enabled = sessionShadows && profile.shadows !== false
    const allowHeavy = profile.shadowCast === 'heavy'
    const maxN = Math.max(0, profile.maxShadowCasters ?? 16)
    const fx = shadowFocus.x
    const fz = shadowFocus.z
    let n = 0

    for (let i = 0; i < shadowCasters.length; i++) {
      const obj = shadowCasters[i]
      obj.castShadow = false
      if (!enabled || maxN === 0 || !obj.visible) continue
      const tier = obj.userData.shadowCastTier
      if (!(tier === 'core' || (allowHeavy && tier === 'heavy'))) continue
      obj.getWorldPosition(casterWorld)
      const dx = casterWorld.x - fx
      const dz = casterWorld.z - fz
      // Prefer palms/cliffs (core) when the budget is tight.
      const score = (dx * dx + dz * dz) * (tier === 'core' ? 0.4 : 1)
      if (n < casterRank.length) {
        casterRank[n].obj = obj
        casterRank[n].score = score
      } else {
        casterRank.push({ obj, score })
      }
      n++
    }

    // Partial selection: keep the N best without full sort when large.
    const take = Math.min(maxN, n)
    for (let i = 0; i < take; i++) {
      let best = i
      for (let j = i + 1; j < n; j++) {
        if (casterRank[j].score < casterRank[best].score) best = j
      }
      if (best !== i) {
        const tmp = casterRank[i]
        casterRank[i] = casterRank[best]
        casterRank[best] = tmp
      }
      casterRank[i].obj.castShadow = true
    }
  }

  function refreshViewAndShadows() {
    backdrop.cullToCamera?.(camera)
    updateShadowCasterCull()
  }

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

    fill.intensity = day
      ? (gfx.fillIntensity ?? 0)
      : (gfx.fillIntensityNight ?? (gfx.fillIntensity ?? 0) * 0.45)
    fill.color.set(day ? (gfx.fillColor || '#c8d8e8') : (gfx.fillColorNight || '#8898b0'))

    bloom.strength = m.bloom
    renderer.toneMappingExposure = m.exposure
    if (grade && m.post) {
      grade.uniforms.vignette.value = m.post.vignette ?? grade.uniforms.vignette.value
      grade.uniforms.contrast.value = m.post.contrast ?? grade.uniforms.contrast.value
      grade.uniforms.saturation.value = m.post.saturation ?? grade.uniforms.saturation.value
      grade.uniforms.sharpen.value = m.post.sharpen ?? grade.uniforms.sharpen.value
    }

    if (gtao) {
      gtao.blendIntensity = day
        ? (gfx.aoIntensity ?? 0.32)
        : (gfx.aoIntensityNight ?? 0.4)
    }

    if (godray) {
      godrayDayIntensity = day ? (gfx.godrayIntensity ?? 0.2) : 0
      godray.enabled = day && godrayDayIntensity > 0
      if (!day) godray.uniforms.uIntensity.value = 0
    }

    accentBase = m.accentIntensity
    underGlow.color.set(m.underGlow)
    underGlow.intensity = m.underGlowIntensity
    for (const s of fx.platformSpots) {
      s.color.set(m.spot)
      s.intensity = m.spotIntensity
    }
    backdrop.setDay(day)
    syncTweaksFromMode()
    applyLightTweaks()
  }

  function resizePostTargets() {
    renderer.getDrawingBufferSize(size)
    if (gtao) {
      const aoW = Math.max(1, Math.round(size.x * profile.aoScale))
      const aoH = Math.max(1, Math.round(size.y * profile.aoScale))
      gtao.setSize(aoW, aoH)
    }
    bloom.setSize(
      Math.max(1, Math.round(size.x * profile.bloomScale)),
      Math.max(1, Math.round(size.y * profile.bloomScale)),
    )
  }

  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    const dpr = Math.min(window.devicePixelRatio, profile.maxDpr)
    renderer.setPixelRatio(dpr)
    renderer.setSize(window.innerWidth, window.innerHeight)
    composer.setPixelRatio(dpr)
    composer.setSize(window.innerWidth, window.innerHeight)
    // Composer resets pass sizes to full res — re-apply cheaper AO/bloom scales.
    resizePostTargets()
  }

  // Adaptive quality (Auto only): soften DPR / AO / bloom / caster caps.
  // Never dispose/recreate the shadow map mid-match (that hitch felt like a freeze).
  let fpsEma = 60
  let adaptCooldown = 2.5
  let adaptHold = 0

  function applyAdaptiveTier(nextTier) {
    if (nextTier === adaptiveTier) return
    adaptiveTier = nextTier
    const next = applyThemeQualityOverrides(resolveProfile(nextTier), gfx)
    profile = {
      ...next,
      // Keep session shadow GPU allocation stable
      shadows: sessionShadows,
      shadowMapSize: sessionShadowMapSize,
    }
    if (gtao) gtao.enabled = !!profile.ao
    const dpr = Math.min(window.devicePixelRatio, profile.maxDpr)
    renderer.setPixelRatio(dpr)
    composer.setPixelRatio(dpr)
    resizePostTargets()
    if (gtao && typeof gtao.updateGtaoMaterial === 'function') {
      gtao.updateGtaoMaterial({ samples: profile.aoSamples })
    }
    // Re-rank casters under the new budget without rebuilding the map
    updateShadowCasterCull()
  }

  function update(dt, t) {
    backdrop.update(dt, t)

    for (const b of fx.blinkers) {
      if (b.mesh.visible === false) continue
      b.mesh.material.emissiveIntensity = 0.55 + Math.sin(t * b.speed + b.phase) * 0.35
    }
    for (const h of fx.holos) {
      if (h.visible === false) continue
      h.rotation.y = t * 1.2
      h.position.y = 2.0 + Math.sin(t * 2) * 0.08
    }

    accentA.intensity = accentBase * (1 + Math.sin(t * 1.7) * 0.16)
    accentB.intensity = accentBase * (1 + Math.cos(t * 1.3) * 0.16)

    if (qualityPref === 'auto' && dt > 0 && dt < 0.25) {
      const fps = 1 / dt
      fpsEma = fpsEma * 0.9 + fps * 0.1
      adaptCooldown = Math.max(0, adaptCooldown - dt)
      adaptHold = Math.max(0, adaptHold - dt)
      if (adaptCooldown <= 0 && adaptHold <= 0) {
        if (fpsEma < 38) {
          applyAdaptiveTier(stepTier(adaptiveTier, -1))
          adaptCooldown = 3.5
          adaptHold = 6
        } else if (fpsEma > 56) {
          const base = resolveProfile('auto').id
          const next = stepTier(adaptiveTier, 1)
          // Never climb above the device's auto baseline in this session
          const order = ['perf', 'balanced', 'high']
          if (order.indexOf(next) <= order.indexOf(base) && next !== adaptiveTier) {
            applyAdaptiveTier(next)
            adaptCooldown = 5
            adaptHold = 8
          }
        }
      }
    }
  }

  const camDist0 = 9.5
  const camHeight0 = 8.5
  let camYawDeg = 0
  let camElevDeg = 30
  const camOffset = new THREE.Vector3(0, camHeight0, camDist0)
  const camTarget = new THREE.Vector3()
  const lookTarget = new THREE.Vector3(0, 0.5, 0)
  const lookGoal = new THREE.Vector3()
  let shake = 0

  const addShake = (v) => { shake = Math.max(shake, v) }

  function setCameraYaw(deg) {
    camYawDeg = Number.isFinite(deg) ? deg : 0
  }

  function getCameraYaw() {
    return camYawDeg
  }

  function setCameraElev(deg) {
    if (!Number.isFinite(deg)) return
    camElevDeg = Math.max(12, Math.min(78, deg))
  }

  function getCameraElev() {
    return camElevDeg
  }

  function updateCamera(dt, t, focus) {
    const fx2 = focus ? focus.x : 0
    const fz = focus ? focus.z : 0
    // Prefer the live focus height (cube during trampoline launch) so level
    // changes don't yank the camera up a full platform in one frame.
    const lvlY = focus?.y != null
      ? focus.y
      : (focus ? floorY(focus.level, theme.arenaLift || 0) : 0)

    applyShadowFollow(fx2 * 0.55, fz * 0.55)

    const yaw = (camYawDeg * Math.PI) / 180
    const elev = (camElevDeg * Math.PI) / 180
    const radius = Math.hypot(camDist0, camHeight0)
    camOffset.set(
      Math.sin(yaw) * Math.cos(elev) * radius,
      Math.sin(elev) * radius,
      Math.cos(yaw) * Math.cos(elev) * radius,
    )
    camTarget.set(fx2 * 0.55 + Math.sin(t * 0.25) * 0.6, lvlY, fz * 0.55).add(camOffset)
    camera.position.lerp(camTarget, 1 - Math.pow(0.0006, dt))
    if (shake > 0) {
      shake = Math.max(0, shake - dt * 1.8)
      const amp = shake * 0.65
      camera.position.x += (Math.random() - 0.5) * amp
      camera.position.y += (Math.random() - 0.5) * amp
      camera.position.z += (Math.random() - 0.5) * amp * 0.45
    }
    lookGoal.set(fx2 * 0.6, lvlY + 0.5, fz * 0.6)
    lookTarget.lerp(lookGoal, 1 - Math.pow(0.0006, dt))
    camera.lookAt(lookTarget)

    // View cull + shadow budget at ~8 Hz (hysteresis avoids edge flicker).
    viewCullAccum += dt
    if (viewCullBoot || viewCullAccum >= 1 / VIEW_CULL_HZ) {
      viewCullAccum = 0
      viewCullBoot = false
      refreshViewAndShadows()
    }

    if (godray && isDay && godrayDayIntensity > 0) {
      sun.getWorldPosition(sunWorld)
      updateGodraySun(godray, camera, sunWorld, godrayDayIntensity)
    }
  }

  function render() {
    // World only through post — keeps godrays/bloom from trailing nameplates.
    camera.layers.disable(SPRITE_LAYER)
    composer.render()
    camera.layers.enable(SPRITE_LAYER)

    // Overlay sprites without wiping the graded frame.
    // (A normal scene render would redraw scene.background = blue sky over everything.)
    const prevBg = scene.background
    const prevFog = scene.fog
    scene.background = null
    scene.fog = null
    camera.layers.disable(0)
    renderer.autoClear = false
    renderer.clearDepth()
    renderer.render(scene, camera)
    camera.layers.enable(0)
    scene.background = prevBg
    scene.fog = prevFog
    renderer.autoClear = true
  }

  function dispose() {
    composer.dispose?.()
    aaTarget.dispose()
    gtao?.dispose?.()
    renderer.dispose()
  }

  function getQuality() {
    return {
      preference: qualityPref,
      active: adaptiveTier,
      profile: { ...profile },
    }
  }

  return {
    scene, camera, renderer, fx, theme,
    setDayMode, isDay: () => isDay,
    resize, update, updateCamera, render, addShake, dispose,
    setCameraYaw, getCameraYaw,
    setCameraElev, getCameraElev,
    getLightTweaks, setLightTweaks,
    getQuality,
    splash(x, z, strength = 1) {
      return backdrop.splash?.(x, z, strength) || false
    },
  }
}
