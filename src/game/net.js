import { t } from '../i18n/t.js'

// WebSocket link to the game server with exponential-backoff reconnect.
export function createNet({ url, onMessage, onOpen, onClose, onStatus, onAuthFailure }) {
  let ws = null
  let reconnectDelay = 500
  let retryTimer = null
  let disposed = false
  // a rejected token closes the socket before it ever opens
  let failedOpens = 0

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
      onOpen?.()
    }

    ws.onmessage = (ev) => {
      let msg
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      onMessage(msg)
    }

    ws.onclose = () => {
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
    if (ws) {
      ws.onclose = null
      ws.close()
      ws = null
    }
  }

  return { connect, send, dispose }
}
