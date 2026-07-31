import { useState } from 'react'

const LIGHT_SLIDERS = [
  { key: 'sunIntensity', label: 'Sun', min: 0, max: 6, step: 0.01 },
  { key: 'hemiIntensity', label: 'Hemi', min: 0, max: 3, step: 0.01 },
  { key: 'fillIntensity', label: 'Fill', min: 0, max: 2, step: 0.01 },
  { key: 'exposure', label: 'Exposure', min: 0.2, max: 2.5, step: 0.01 },
  { key: 'bloom', label: 'Bloom', min: 0, max: 1.5, step: 0.01 },
  { key: 'godray', label: 'Godray', min: 0, max: 1.5, step: 0.01 },
  { key: 'godraySpread', label: 'Ray spread', min: 0.2, max: 4, step: 0.05 },
  { key: 'ao', label: 'AO', min: 0, max: 1, step: 0.01 },
  { key: 'saturation', label: 'Sat', min: 0.5, max: 1.8, step: 0.01 },
  { key: 'contrast', label: 'Contrast', min: 0.5, max: 1.8, step: 0.01 },
  { key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.01 },
  { key: 'fogNear', label: 'Fog near', min: 5, max: 80, step: 1 },
  { key: 'fogFar', label: 'Fog far', min: 40, max: 250, step: 1 },
  { key: 'underGlow', label: 'Under', min: 0, max: 16, step: 0.05 },
  { key: 'accent', label: 'Accent', min: 0, max: 16, step: 0.05 },
]

function fmtLight(v) {
  if (typeof v !== 'number' || Number.isNaN(v)) return '—'
  return Number.isInteger(v) ? String(v) : v.toFixed(2)
}

const isPhone = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 480px)').matches

/** In-match light / post tuner — values persist per map + day/night. */
export default function LightDebugPanel({
  mapId,
  lightTweaks,
  onLightTweak,
  onReset,
  onCopy,
}) {
  const [open, setOpen] = useState(() => !isPhone())

  if (!lightTweaks || !onLightTweak) return null

  return (
    <div className={`light-debug${open ? ' is-open' : ''}`}>
      <button
        className="light-debug__toggle"
        type="button"
        onClick={() => setOpen((v) => !v)}
      >
        Light · {mapId || 'map'} {open ? '▾' : '▸'}
      </button>
      {open && (
        <div className="light-debug__panel">
          {LIGHT_SLIDERS.map(({ key, label, min, max, step }) => (
            <label key={key} className="light-debug__row">
              <span className="light-debug__label">
                {label} {fmtLight(lightTweaks[key])}
              </span>
              <input
                className="light-debug__range"
                type="range"
                min={min}
                max={max}
                step={step}
                value={lightTweaks[key] ?? min}
                onChange={(e) => onLightTweak(key, Number(e.target.value))}
              />
            </label>
          ))}
          <div className="light-debug__actions">
            <button
              className="light-debug__btn"
              type="button"
              onClick={() => {
                const json = JSON.stringify(lightTweaks, null, 2)
                console.log(`[light tweaks ${mapId}]`, lightTweaks)
                navigator.clipboard?.writeText?.(json).catch(() => {})
                onCopy?.()
              }}
            >
              Copy JSON
            </button>
            <button
              className="light-debug__btn light-debug__btn--ghost"
              type="button"
              onClick={() => onReset?.()}
            >
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
