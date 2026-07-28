import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { AuthProvider } from './auth/AuthContext.jsx'
import { LocaleProvider } from './i18n/LocaleContext.jsx'
import { initTelegram } from './game/telegram.js'
import './styles.css'

// Expand the Mini App shell before React paints, so the first menu already
// fills the Telegram viewport instead of sitting in a tiny card.
initTelegram()

// No StrictMode on purpose: it double-mounts effects, which would spin up
// a second WebGL context and a second websocket on every navigation.
createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <LocaleProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </LocaleProvider>
  </BrowserRouter>
)
