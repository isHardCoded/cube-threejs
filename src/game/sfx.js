// Tiny WebAudio synth: every sound is generated, no asset files.

const MUTE_KEY = 'cube-sfx-muted'

let audioCtx = null
let muted = (() => {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
})()

export function isSoundEnabled() {
  return !muted
}

export function setSoundEnabled(on) {
  muted = !on
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
  } catch { /* private mode */ }
}

export function ensureAudio() {
  if (muted) return
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return
  if (!audioCtx) audioCtx = new AC()
  if (audioCtx.state === 'suspended') audioCtx.resume()
}

function ready() {
  return audioCtx && !muted
}

function envGain(t0, peak, dur) {
  const g = audioCtx.createGain()
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(peak, t0 + 0.006)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  g.connect(audioCtx.destination)
  return g
}

function makeNoise(dur) {
  const n = Math.floor(audioCtx.sampleRate * dur)
  const buf = audioCtx.createBuffer(1, n, audioCtx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1
  const src = audioCtx.createBufferSource()
  src.buffer = buf
  return src
}

export const sfx = {
  // dull wooden knock of a die tipping onto the next tile
  roll() {
    if (!ready()) return
    const t0 = audioCtx.currentTime
    const o = audioCtx.createOscillator()
    o.type = 'triangle'
    o.frequency.setValueAtTime(190 + Math.random() * 40, t0)
    o.frequency.exponentialRampToValueAtTime(85, t0 + 0.07)
    o.connect(envGain(t0, 0.1, 0.09))
    o.start(t0)
    o.stop(t0 + 0.1)
  },
  // rising whoosh
  dash() {
    if (!ready()) return
    const t0 = audioCtx.currentTime
    const src = makeNoise(0.25)
    const f = audioCtx.createBiquadFilter()
    f.type = 'bandpass'
    f.Q.value = 1.4
    f.frequency.setValueAtTime(350, t0)
    f.frequency.exponentialRampToValueAtTime(3400, t0 + 0.18)
    src.connect(f).connect(envGain(t0, 0.22, 0.24))
    src.start(t0)
  },
  // springy hop
  jump() {
    if (!ready()) return
    const t0 = audioCtx.currentTime
    const o = audioCtx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(240, t0)
    o.frequency.exponentialRampToValueAtTime(560, t0 + 0.14)
    o.connect(envGain(t0, 0.14, 0.18))
    o.start(t0)
    o.stop(t0 + 0.2)
  },
  // big trampoline boing up to the next platform
  launch() {
    if (!ready()) return
    const t0 = audioCtx.currentTime
    const o = audioCtx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(150, t0)
    o.frequency.exponentialRampToValueAtTime(880, t0 + 0.4)
    o.connect(envGain(t0, 0.25, 0.5))
    o.start(t0)
    o.stop(t0 + 0.5)
    const src = makeNoise(0.3)
    const f = audioCtx.createBiquadFilter()
    f.type = 'bandpass'
    f.Q.value = 1.2
    f.frequency.setValueAtTime(500, t0)
    f.frequency.exponentialRampToValueAtTime(4000, t0 + 0.3)
    src.connect(f).connect(envGain(t0, 0.12, 0.3))
    src.start(t0)
  },
  // a tile breaking off and dropping away
  crumble() {
    if (!ready()) return
    const t0 = audioCtx.currentTime
    const src = makeNoise(0.22)
    const f = audioCtx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.setValueAtTime(700, t0)
    f.frequency.exponentialRampToValueAtTime(120, t0 + 0.2)
    src.connect(f).connect(envGain(t0, 0.16, 0.22))
    src.start(t0)
    const o = audioCtx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(90, t0)
    o.frequency.exponentialRampToValueAtTime(40, t0 + 0.18)
    o.connect(envGain(t0, 0.18, 0.2))
    o.start(t0)
    o.stop(t0 + 0.2)
  },
  // alarm when a platform starts to crumble
  alarm() {
    if (!ready()) return
    const t0 = audioCtx.currentTime
    for (const dt of [0, 0.22, 0.44]) {
      const o = audioCtx.createOscillator()
      o.type = 'square'
      o.frequency.setValueAtTime(660, t0 + dt)
      o.frequency.setValueAtTime(880, t0 + dt + 0.09)
      o.connect(envGain(t0 + dt, 0.06, 0.16))
      o.start(t0 + dt)
      o.stop(t0 + dt + 0.18)
    }
  },
  // heavy impact: low thump + noise crack
  hit() {
    if (!ready()) return
    const t0 = audioCtx.currentTime
    const o = audioCtx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(130, t0)
    o.frequency.exponentialRampToValueAtTime(42, t0 + 0.16)
    o.connect(envGain(t0, 0.4, 0.2))
    o.start(t0)
    o.stop(t0 + 0.2)
    const src = makeNoise(0.12)
    const f = audioCtx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = 900
    src.connect(f).connect(envGain(t0, 0.24, 0.11))
    src.start(t0)
  },
  // falling pitch + rumble
  death() {
    if (!ready()) return
    const t0 = audioCtx.currentTime
    const o = audioCtx.createOscillator()
    o.type = 'sawtooth'
    o.frequency.setValueAtTime(320, t0)
    o.frequency.exponentialRampToValueAtTime(38, t0 + 0.55)
    o.connect(envGain(t0, 0.22, 0.6))
    o.start(t0)
    o.stop(t0 + 0.6)
    const src = makeNoise(0.5)
    const f = audioCtx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.setValueAtTime(2600, t0)
    f.frequency.exponentialRampToValueAtTime(120, t0 + 0.5)
    src.connect(f).connect(envGain(t0, 0.2, 0.5))
    src.start(t0)
  },
  // mechanical click of a mine arming itself
  arm() {
    if (!ready()) return
    const t0 = audioCtx.currentTime
    const o = audioCtx.createOscillator()
    o.type = 'square'
    o.frequency.setValueAtTime(880, t0)
    o.frequency.exponentialRampToValueAtTime(320, t0 + 0.07)
    o.connect(envGain(t0, 0.1, 0.08))
    o.start(t0)
    o.stop(t0 + 0.09)
  },
  // soft wet plop when arming a poop mine
  poopArm() {
    if (!ready()) return
    const t0 = audioCtx.currentTime
    const src = makeNoise(0.18)
    const f = audioCtx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.setValueAtTime(220, t0)
    f.frequency.exponentialRampToValueAtTime(70, t0 + 0.16)
    src.connect(f).connect(envGain(t0, 0.2, 0.18))
    src.start(t0)
    const o = audioCtx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(110, t0)
    o.frequency.exponentialRampToValueAtTime(45, t0 + 0.14)
    o.connect(envGain(t0, 0.12, 0.16))
    o.start(t0)
    o.stop(t0 + 0.16)
  },
  // cartoon fart when someone steps on a poop mine
  fart() {
    if (!ready()) return
    const t0 = audioCtx.currentTime
    const src = makeNoise(0.42)
    const f = audioCtx.createBiquadFilter()
    f.type = 'bandpass'
    f.Q.value = 2.2
    f.frequency.setValueAtTime(160, t0)
    f.frequency.exponentialRampToValueAtTime(55, t0 + 0.28)
    f.frequency.exponentialRampToValueAtTime(95, t0 + 0.38)
    src.connect(f).connect(envGain(t0, 0.34, 0.4))
    src.start(t0)
    const o = audioCtx.createOscillator()
    o.type = 'sawtooth'
    o.frequency.setValueAtTime(95, t0)
    o.frequency.exponentialRampToValueAtTime(38, t0 + 0.32)
    o.connect(envGain(t0, 0.18, 0.36))
    o.start(t0)
    o.stop(t0 + 0.38)
    // trailing bubble
    const o2 = audioCtx.createOscillator()
    o2.type = 'sine'
    o2.frequency.setValueAtTime(70, t0 + 0.2)
    o2.frequency.exponentialRampToValueAtTime(28, t0 + 0.4)
    o2.connect(envGain(t0 + 0.2, 0.14, 0.22))
    o2.start(t0 + 0.2)
    o2.stop(t0 + 0.45)
  },
  // short UI tap
  click() {
    ensureAudio()
    if (!ready()) return
    const t0 = audioCtx.currentTime
    const o = audioCtx.createOscillator()
    o.type = 'triangle'
    o.frequency.setValueAtTime(720, t0)
    o.frequency.exponentialRampToValueAtTime(380, t0 + 0.04)
    o.connect(envGain(t0, 0.07, 0.05))
    o.start(t0)
    o.stop(t0 + 0.06)
  },
  // soft whoosh when a modal collapses
  modalClose() {
    ensureAudio()
    if (!ready()) return
    const t0 = audioCtx.currentTime
    const o = audioCtx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(420, t0)
    o.frequency.exponentialRampToValueAtTime(160, t0 + 0.1)
    o.connect(envGain(t0, 0.06, 0.12))
    o.start(t0)
    o.stop(t0 + 0.13)
    const src = makeNoise(0.08)
    const f = audioCtx.createBiquadFilter()
    f.type = 'highpass'
    f.frequency.value = 900
    src.connect(f).connect(envGain(t0, 0.04, 0.08))
    src.start(t0)
  },
  // short double blip for a denied action
  deny() {
    if (!ready()) return
    const t0 = audioCtx.currentTime
    for (const dt of [0, 0.09]) {
      const o = audioCtx.createOscillator()
      o.type = 'square'
      o.frequency.value = 150
      o.connect(envGain(t0 + dt, 0.07, 0.06))
      o.start(t0 + dt)
      o.stop(t0 + dt + 0.07)
    }
  },
}

/** Soft UI clicks / modal-close sounds for menu buttons. */
export function bindUiSfx() {
  if (typeof document === 'undefined') return
  document.addEventListener('pointerdown', (e) => {
    if (e.button != null && e.button !== 0) return
    const el = e.target.closest('button, .btn, [role="button"]')
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return
    if (el.classList.contains('modal__backdrop') || el.dataset.sfx === 'close') {
      sfx.modalClose()
    } else {
      sfx.click()
    }
  }, true)
}
