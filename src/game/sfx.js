// Tiny WebAudio synth: every sound is generated, no asset files.

let audioCtx = null

export function ensureAudio() {
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return
  if (!audioCtx) audioCtx = new AC()
  if (audioCtx.state === 'suspended') audioCtx.resume()
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
    if (!audioCtx) return
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
    if (!audioCtx) return
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
    if (!audioCtx) return
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
    if (!audioCtx) return
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
    if (!audioCtx) return
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
    if (!audioCtx) return
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
    if (!audioCtx) return
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
    if (!audioCtx) return
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
    if (!audioCtx) return
    const t0 = audioCtx.currentTime
    const o = audioCtx.createOscillator()
    o.type = 'square'
    o.frequency.setValueAtTime(880, t0)
    o.frequency.exponentialRampToValueAtTime(320, t0 + 0.07)
    o.connect(envGain(t0, 0.1, 0.08))
    o.start(t0)
    o.stop(t0 + 0.09)
  },
  // short double blip for a denied action
  deny() {
    if (!audioCtx) return
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
