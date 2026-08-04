import { SPRITE_LAYER } from './sprites.js'

/**
 * P2P voice over WebRTC, signaled through the game WebSocket.
 * Toggle with K — mic badge above the head.
 *
 * Uses Perfect Negotiation + TURN (VPS coturn + public fallbacks).
 * STUN alone fails for most cross-NAT / mobile peers.
 */
export function createVoiceChat({ send, getMyId, getPeerIds }) {
  /** @type {Map<string, RTCPeerConnection>} */
  const peers = new Map()
  /** @type {Map<string, object[]>} */
  const pendingIce = new Map()
  /** @type {Map<string, boolean>} */
  const makingOffer = new Map()
  /** @type {Map<string, boolean>} */
  const ignoreOffer = new Map()
  const remoteMicOn = new Set()
  let localStream = null
  let micOn = false
  let disposed = false

  // Prefer our VPS coturn; keep public TURN/STUN as fallback.
  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: [
        'turn:104.171.132.140:3478',
        'turn:104.171.132.140:3478?transport=tcp',
        'turn:104-171-132-140.sslip.io:3478',
        'turn:104-171-132-140.sslip.io:3478?transport=tcp',
      ],
      username: 'cube2077',
      credential: 'cube-voice-turn',
    },
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: [
        'turn:freeturn.net:3478',
        'turn:freeturn.net:3478?transport=tcp',
        'turns:freeturn.net:5349',
      ],
      username: 'free',
      credential: 'free',
    },
  ]

  /** Lower id is impolite (always wins glare). */
  function isPolite(peerId) {
    const me = getMyId()
    return !!me && String(me) > String(peerId)
  }

  async function ensureMic() {
    if (localStream) return localStream
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('mic unsupported')
    }
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    })
    return localStream
  }

  function stopMicTracks() {
    if (!localStream) return
    for (const t of localStream.getTracks()) t.stop()
    localStream = null
  }

  function setTrackEnabled(on) {
    if (!localStream) return
    for (const t of localStream.getAudioTracks()) t.enabled = on
  }

  function attachLocalTracks(pc) {
    if (!localStream) return false
    const track = localStream.getAudioTracks()[0]
    if (!track) return false

    // Prefer replaceTrack on the pre-created transceiver so we keep one m-line.
    const audioSender = pc.getSenders().find((s) =>
      s.track?.kind === 'audio' || (!s.track && s.transport !== undefined)
    )
    const bareAudio = pc.getTransceivers().find((t) => t.receiver?.track?.kind === 'audio' || t.mid != null || t.sender)
    if (bareAudio?.sender && (!bareAudio.sender.track || bareAudio.sender.track.id !== track.id)) {
      bareAudio.sender.replaceTrack(track).catch(() => {})
      bareAudio.direction = 'sendrecv'
      return true
    }
    if (audioSender && (!audioSender.track || audioSender.track.id !== track.id)) {
      audioSender.replaceTrack(track).catch(() => {})
      return true
    }
    const has = pc.getSenders().some((s) => s.track && s.track.id === track.id)
    if (!has) {
      pc.addTrack(track, localStream)
      return true
    }
    return false
  }

  async function createAndSendOffer(peerId) {
    const pc = peers.get(peerId)
    if (disposed || !pc || !micOn) return
    try {
      makingOffer.set(peerId, true)
      attachLocalTracks(pc)
      const offer = await pc.createOffer()
      // Glare / state changed while awaiting.
      if (pc.signalingState !== 'stable') return
      await pc.setLocalDescription(offer)
      send({ t: 'voice-offer', to: peerId, sdp: pc.localDescription.sdp })
    } catch (err) {
      console.warn('[voice] offer failed', peerId, err)
    } finally {
      makingOffer.set(peerId, false)
    }
  }

  function bindRemoteAudio(peerId, stream) {
    let audio = document.getElementById(`voice-audio-${peerId}`)
    if (!audio) {
      audio = document.createElement('audio')
      audio.id = `voice-audio-${peerId}`
      audio.autoplay = true
      audio.playsInline = true
      audio.setAttribute('playsinline', '')
      audio.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;'
      document.body.appendChild(audio)
    }
    audio.srcObject = stream
    audio.muted = false
    audio.volume = 1
    const play = () => {
      audio.play().catch((err) => console.warn('[voice] audio.play', peerId, err))
    }
    play()
    audio.onloadedmetadata = play
  }

  function ensurePeer(peerId) {
    if (disposed || !peerId) return null
    let pc = peers.get(peerId)
    if (pc) return pc

    pc = new RTCPeerConnection({ iceServers, iceCandidatePoolSize: 4 })
    peers.set(peerId, pc)

    // Guarantee an audio m-line even before local mic is ready.
    try {
      pc.addTransceiver('audio', { direction: 'sendrecv' })
    } catch { /* ignore */ }

    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return
      send({
        t: 'voice-ice',
        to: peerId,
        candidate: ev.candidate.toJSON(),
      })
    }

    pc.ontrack = (ev) => {
      const stream = ev.streams?.[0] || new MediaStream([ev.track])
      bindRemoteAudio(peerId, stream)
      ev.track.onunmute = () => bindRemoteAudio(peerId, stream)
    }

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState
      if (state === 'failed' && micOn) {
        console.warn('[voice] connection failed, restarting ICE', peerId)
        try {
          pc.restartIce?.()
          createAndSendOffer(peerId)
        } catch { /* ignore */ }
      }
      if (state === 'closed') teardownPeer(peerId)
    }

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed' && micOn) {
        try {
          pc.restartIce?.()
          createAndSendOffer(peerId)
        } catch { /* ignore */ }
      }
    }

    attachLocalTracks(pc)
    return pc
  }

  async function flushIce(peerId, pc) {
    const list = pendingIce.get(peerId) || []
    pendingIce.delete(peerId)
    for (const c of list) {
      try { await pc.addIceCandidate(c) } catch { /* ignore */ }
    }
  }

  function teardownPeer(peerId) {
    const pc = peers.get(peerId)
    if (pc) {
      try { pc.close() } catch { /* ignore */ }
      peers.delete(peerId)
    }
    pendingIce.delete(peerId)
    makingOffer.delete(peerId)
    ignoreOffer.delete(peerId)
    const audio = document.getElementById(`voice-audio-${peerId}`)
    if (audio) {
      audio.srcObject = null
      audio.remove()
    }
  }

  /** Connect / renegotiate with every peer who has (or may have) mic on. */
  async function connectAll() {
    const me = getMyId()
    if (!me || !micOn) return
    const ids = new Set([...(getPeerIds?.() || []), ...remoteMicOn])
    for (const id of ids) {
      if (!id || id === me) continue
      ensurePeer(id)
      await createAndSendOffer(id)
    }
  }

  async function setMic(on) {
    if (disposed) return micOn
    if (on === micOn) return micOn
    try {
      if (on) {
        await ensureMic()
        setTrackEnabled(true)
        micOn = true
        send({ t: 'voice', on: true })
        await connectAll()
      } else {
        setTrackEnabled(false)
        micOn = false
        send({ t: 'voice', on: false })
      }
    } catch (err) {
      console.warn('[voice] mic failed', err)
      micOn = false
      try { send({ t: 'voice', on: false }) } catch { /* ignore */ }
      stopMicTracks()
    }
    return micOn
  }

  async function toggle() {
    return setMic(!micOn)
  }

  async function handleSignal(msg) {
    if (disposed) return
    const from = msg.from
    if (!from) return
    const me = getMyId()
    if (msg.to && msg.to !== me) return

    if (msg.t === 'voice-offer') {
      const pc = ensurePeer(from)
      if (!pc || !msg.sdp) return
      try {
        const offering = !!makingOffer.get(from)
        const offerCollision = offering || pc.signalingState !== 'stable'
        const polite = isPolite(from)
        ignoreOffer.set(from, !polite && offerCollision)
        if (ignoreOffer.get(from)) {
          console.warn('[voice] ignoring colliding offer (impolite)', from)
          return
        }
        if (offerCollision) {
          await Promise.all([
            pc.setLocalDescription({ type: 'rollback' }),
            pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp }),
          ])
        } else {
          await pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp })
        }
        if (micOn) attachLocalTracks(pc)
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        send({ t: 'voice-answer', to: from, sdp: answer.sdp })
        await flushIce(from, pc)
      } catch (err) {
        console.warn('[voice] handle offer failed', err)
      }
      return
    }

    if (msg.t === 'voice-answer') {
      const pc = peers.get(from) || ensurePeer(from)
      if (!pc || !msg.sdp) return
      try {
        if (pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp })
          await flushIce(from, pc)
        }
      } catch (err) {
        console.warn('[voice] handle answer failed', err)
      }
      return
    }

    if (msg.t === 'voice-ice') {
      const cand = msg.candidate
      if (!cand || typeof cand !== 'object') return
      const pc = peers.get(from)
      if (!pc || !pc.remoteDescription) {
        const list = pendingIce.get(from) || []
        list.push(cand)
        pendingIce.set(from, list)
        return
      }
      try { await pc.addIceCandidate(cand) } catch { /* ignore */ }
    }
  }

  function onPeerJoined(peerId) {
    if (!peerId || !micOn) return
    ensurePeer(peerId)
    createAndSendOffer(peerId)
  }

  function onPeerLeft(peerId) {
    remoteMicOn.delete(peerId)
    teardownPeer(peerId)
  }

  function onRemoteVoice(peerId, on) {
    if (!peerId) return
    if (on) remoteMicOn.add(peerId)
    else remoteMicOn.delete(peerId)
    if (on && micOn) {
      ensurePeer(peerId)
      createAndSendOffer(peerId)
    }
  }

  function dispose() {
    disposed = true
    micOn = false
    remoteMicOn.clear()
    for (const id of [...peers.keys()]) teardownPeer(id)
    stopMicTracks()
  }

  return {
    toggle,
    setMic,
    handleSignal,
    onPeerJoined,
    onPeerLeft,
    onRemoteVoice,
    dispose,
    get micOn() { return micOn },
  }
}

export function attachMicBadge(THREE, scene, p) {
  if (p.micBadge) return p.micBadge
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  const ctx = c.getContext('2d')
  const draw = (active) => {
    ctx.clearRect(0, 0, 64, 64)
    ctx.fillStyle = active ? 'rgba(36, 190, 90, 0.95)' : 'rgba(18, 18, 24, 0.8)'
    ctx.beginPath()
    ctx.arc(32, 32, 28, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = active ? '#f0fff0' : '#778'
    ctx.lineWidth = 3
    ctx.stroke()
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.fillRect(27, 14, 10, 18)
    ctx.beginPath()
    ctx.arc(32, 14, 5, Math.PI, 0)
    ctx.arc(32, 32, 5, 0, Math.PI)
    ctx.fill()
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.arc(32, 30, 11, 0.1 * Math.PI, 0.9 * Math.PI)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(32, 41)
    ctx.lineTo(32, 48)
    ctx.moveTo(24, 48)
    ctx.lineTo(40, 48)
    ctx.stroke()
  }
  draw(false)
  const tex = new THREE.CanvasTexture(c)
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: false, depthWrite: false,
  }))
  sprite.scale.set(0.55, 0.55, 1)
  sprite.visible = false
  sprite.layers.set(SPRITE_LAYER)
  sprite.renderOrder = 11
  scene.add(sprite)
  p.micBadge = { sprite, tex, draw, active: false }
  return p.micBadge
}

export function setMicBadge(p, on) {
  const b = p?.micBadge
  if (!b) return
  b.active = !!on
  b.draw(!!on)
  b.tex.needsUpdate = true
  b.sprite.visible = !!on
  if (p) p.voiceOn = !!on
}
