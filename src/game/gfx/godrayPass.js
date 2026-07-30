import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import * as THREE from 'three'

/**
 * Wide soft sun wash — atmospheric backlight, not a visible cone/tracer
 * landing on bushes and tiles.
 */
const GodrayShader = {
  name: 'JungleGodrayShader',
  uniforms: {
    tDiffuse: { value: null },
    uSunPos: { value: new THREE.Vector2(0.72, 0.82) },
    uIntensity: { value: 0 },
    uSpread: { value: 1.35 },
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
    uniform vec2 uSunPos;
    uniform float uIntensity;
    uniform float uSpread;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      if (uIntensity < 0.001) {
        gl_FragColor = base;
        return;
      }

      vec2 d = (vUv - uSunPos) * vec2(1.0, 1.15);
      float dist = length(d) / max(uSpread, 0.01);

      // Broad Gaussian wash — covers a large area, no hard shaft edges
      float wash = exp(-dist * dist * 1.15);
      // Very soft secondary lobe so light fills more of the frame
      float fill = exp(-dist * dist * 0.35) * 0.45;
      float core = exp(-dist * dist * 4.5) * 0.22;

      float amp = (wash + fill + core) * uIntensity;
      // Warm sunlight, capped so it never reads as a spotlight cone
      vec3 sun = vec3(1.12, 1.02, 0.82) * amp;
      sun = min(sun, vec3(0.16));

      gl_FragColor = vec4(base.rgb + sun, base.a);
    }
  `,
}

export function createGodrayPass(opts = {}) {
  const pass = new ShaderPass(GodrayShader)
  if (opts.spread != null) pass.uniforms.uSpread.value = opts.spread
  pass.enabled = false
  return pass
}

/** Project sun world position into UV. */
export function updateGodraySun(pass, camera, sunWorldPos, intensity) {
  if (!pass) return
  const v = sunWorldPos.clone().project(camera)
  const sx = THREE.MathUtils.clamp(v.x * 0.5 + 0.5, -0.2, 1.2)
  const sy = THREE.MathUtils.clamp(v.y * 0.5 + 0.5, -0.1, 1.25)
  pass.uniforms.uSunPos.value.set(sx, sy)
  const inFront = v.z < 1.25
  const edge = Math.max(Math.abs(v.x), Math.abs(v.y))
  const edgeFade = THREE.MathUtils.clamp(1.15 - edge * 0.4, 0.5, 1)
  pass.uniforms.uIntensity.value = inFront ? intensity * edgeFade : intensity * 0.35
  pass.enabled = intensity > 0.001
}
