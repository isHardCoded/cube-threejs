import { SPRITE_LAYER } from './sprites.js'

/**
 * P2P voice chat over WebRTC, signaled through the game WebSocket.
 * Toggle with K — broadcasts voice on/off for the mic icon above the head.
 */
export function createVoiceChat({ send, getMyId, getPeerIds }) {
  /** @type {Map<string, RTCPeerConnection>} */
  const peers = new Map()
  /** @type {Map<string, RTCIceCandidate[]>} */
  const pendingIce = new Map()
  let localStream = null
  let micOn = false
  let disposed = false

  const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }]

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

  async function ensurePeer(peerId, polite) {
    if (disposed || !peerId) return null
    let pc = peers.get(peerId)
    if (pc) return pc

    pc = new RTCPeerConnection({ iceServers })
    peers.set(peerId, pc)

    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return
      send({
        t: 'voice-ice',
        to: peerId,
        candidate: ev.candidate.toJSON(),
      })
    }

    pc.ontrack = (ev) => {
      const stream = ev.streams[0]
      if (!stream) return
      let audio = document.getElementById(`voice-audio-${peerId}`)
      if (!audio) {
        audio = document.createElement('audio')
        audio.id = `voice-audio-${peerId}`
        audio.autoplay = true
        audio.playsInline = true
        audio.style.display = 'none'
        document.body.appendChild(audio)
      }
      audio.srcObject = stream
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        teardownPeer(peerId)
      }
    }

    if (localStream) {
      for (const track of localStream.getTracks()) {
        pc.addTrack(track, localStream)
      }
    }

    if (polite) {
      try {
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        send({ t: 'voice-offer', to: peerId, sdp: offer.sdp })
      } catch {
        teardownPeer(peerId)
        return null
      }
    }

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
    const audio = document.getElementById(`voice-audio-${peerId}`)
    if (audio) {
      audio.srcObject = null
      audio.remove()
    }
  }

  async function connectAll() {
    const me = getMyId()
    if (!me) return
    const ids = (getPeerIds?.() || []).filter((id) => id && id !== me)
    for (const id of ids) {
      await ensurePeer(id, me < id)
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
        for (const [, pc] of peers) {
          const senders = pc.getSenders()
          for (const track of localStream.getTracks()) {
            if (!senders.some((s) => s.track?.id === track.id)) {
              pc.addTrack(track, localStream)
            }
          }
        }
      } else {
        setTrackEnabled(false)
        micOn = false
        send({ t: 'voice', on: false })
      }
    } catch (err) {
      console.warn('voice mic failed', err)
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
      const pc = await ensurePeer(from, false)
      if (!pc || !msg.sdp) return
      try {
        await pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp })
        if (localStream) {
          for (const track of localStream.getTracks()) {
            if (!pc.getSenders().some((s) => s.track?.id === track.id)) {
              pc.addTrack(track, localStream)
            }
          }
        }
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        send({ t: 'voice-answer', to: from, sdp: answer.sdp })
        await flushIce(from, pc)
      } catch (err) {
        console.warn('voice offer failed', err)
      }
      return
    }

    if (msg.t === 'voice-answer') {
      const pc = peers.get(from) || await ensurePeer(from, false)
      if (!pc || !msg.sdp) return
      try {
        await pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp })
        await flushIce(from, pc)
      } catch (err) {
        console.warn('voice answer failed', err)
      }
      return
    }

    if (msg.t === 'voice-ice') {
      const cand = msg.candidate
      if (!cand) return
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
    if (!micOn || !peerId) return
    const me = getMyId()
    if (!me || peerId === me) return
    ensurePeer(peerId, me < peerId)
  }

  function onPeerLeft(peerId) {
    teardownPeer(peerId)
  }

  function dispose() {
    disposed = true
    micOn = false
    for (const id of [...peers.keys()]) teardownPeer(id)
    stopMicTracks()
  }

  return {
    toggle,
    setMic,
    handleSignal,
    onPeerJoined,
    onPeerLeft,
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
