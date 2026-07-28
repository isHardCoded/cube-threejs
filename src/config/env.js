// TODO(deploy): drop the hardcoded VPS host once Vercel env vars are set.
const PROD_HOST = '104-171-132-140.sslip.io'

// In dev the server runs on :8090 next to Vite. Reusing the page's hostname
// means opening the dev server from a phone on the LAN still finds the backend.
const devHost = `${location.hostname}:8090`

export const API_BASE = import.meta.env.VITE_API_URL
  || (import.meta.env.DEV ? `http://${devHost}` : `https://${PROD_HOST}`)

export const WS_BASE = import.meta.env.VITE_WS_URL
  || (import.meta.env.DEV ? `ws://${devHost}/ws` : `wss://${PROD_HOST}/ws`)
