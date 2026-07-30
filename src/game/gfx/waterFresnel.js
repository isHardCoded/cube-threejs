/**
 * View-angle fresnel on transparent water materials (MeshStandard from GLB).
 * Edge-on water reads denser; looking down stays clearer.
 */
export function applyWaterFresnel(material, {
  opacityMin = 0.28,
  opacityMax = 0.78,
  power = 2.4,
} = {}) {
  if (!material || material.userData?.waterFresnel) return material
  material.transparent = true
  material.depthWrite = false
  material.userData.waterFresnel = true

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFresnelMin = { value: opacityMin }
    shader.uniforms.uFresnelMax = { value: opacityMax }
    shader.uniforms.uFresnelPower = { value: power }
    shader.fragmentShader = `uniform float uFresnelMin;
uniform float uFresnelMax;
uniform float uFresnelPower;
${shader.fragmentShader}`

    // `normal` exists after <normal_fragment_maps>; tweak alpha before lighting writes out.
    const hook = '#include <opaque_fragment>'
    if (shader.fragmentShader.includes(hook)) {
      shader.fragmentShader = shader.fragmentShader.replace(
        hook,
        /* glsl */`
        {
          float _fNdotV = abs(dot(normalize(normal), normalize(vViewPosition)));
          float _fres = pow(clamp(1.0 - _fNdotV, 0.0, 1.0), uFresnelPower);
          diffuseColor.a = mix(uFresnelMin, uFresnelMax, _fres);
        }
        #include <opaque_fragment>
        `,
      )
    }
    material.userData.shader = shader
  }
  material.customProgramCacheKey = () => 'waterFresnel'
  material.needsUpdate = true
  return material
}
