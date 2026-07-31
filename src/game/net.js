import { t } from '../i18n/t.js'

const PING_EVERY_MS = 2000

// WebSocket link to the game server with exponential-backoff reconnect.
export function createNet({ url, onMessage, onOpen, onClose, onStatus, onAuthFailure, onPing }) {
  let ws = null
  let reconnectDelay = 500
  let retryTimer = null
  let pingTimer = null
  let disposed = false
  // a rejected token closes the socket before it ever opens
  let failedOpens = 0

  function stopPing() {
    clearInterval(pingTimer)
    pingTimer = null
  }

  function sendPing() {
    if (ws?.readyState === WebSocket.OPEN) {
      send({ t: 'ping', ts: performance.now() })
    }
  }

  function startPing() {
    stopPing()
    sendPing()
    pingTimer = setInterval(sendPing, PING_EVERY_MS)
  }

  function connect() {
    if (disposed) return
    onStatus?.(t('game.connecting'))
    ws = new WebSocket(url())
    let opened = false

    ws.onopen = () => {
      opened = true
      failedOpens = 0
      reconnectDelay = 500
      onStatus?.('')
      startPing()
      onOpen?.()
    }

    ws.onmessage = (ev) => {
      let msg
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      if (msg.t === 'pong' && typeof msg.ts === 'number') {
        onPing?.(Math.max(0, Math.round(performance.now() - msg.ts)))
        return
      }
      onMessage(msg)
    }

    ws.onclose = () => {
      stopPing()
      if (disposed) return
      onClose?.()
      if (!opened && ++failedOpens >= 3) {
        onStatus?.('')
        onAuthFailure?.()
        return
      }
      onStatus?.(t('game.reconnecting'))
      retryTimer = setTimeout(connect, reconnectDelay)
      reconnectDelay = Math.min(reconnectDelay * 2, 8000)
    }
  }

  function send(obj) {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj))
  }

  function dispose() {
    disposed = true
    clearTimeout(retryTimer)
    stopPing()
    if (ws) {
      ws.onclose = null
      ws.close()
    }
    ws = null
  }

  return { connect, send, dispose }
}
