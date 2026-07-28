import { Suspense, lazy } from 'react'
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import AuthPage from './pages/AuthPage.jsx'
import MenuPage from './pages/MenuPage.jsx'
import MapPage from './pages/MapPage.jsx'
import ProfilePage from './pages/ProfilePage.jsx'
import PageFade from './components/PageFade.jsx'
import LangSwitch from './components/LangSwitch.jsx'
import Spinner from './components/Spinner.jsx'
import { useAuth } from './auth/context.js'
import { useLocale } from './i18n/LocaleContext.jsx'

// Three.js is only needed by the 3D screens: keep it out of the menu bundle.
const GamePage = lazy(() => import('./pages/GamePage.jsx'))
const CharacterPage = lazy(() => import('./pages/CharacterPage.jsx'))

function Splash() {
  const { t } = useLocale()
  return (
    <div className="screen">
      <Spinner label={t('common.loading')} />
    </div>
  )
}

function RequireAuth({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <Splash />
  return user ? children : <Navigate to="/auth" replace />
}

/** Menu chrome (language switch) — never shown on the in-match screen. */
function MenuShell() {
  return (
    <>
      <LangSwitch />
      <Outlet />
    </>
  )
}

export default function App() {
  return (
    <Suspense fallback={<Splash />}>
      <PageFade>
        {(location) => (
          <Routes location={location}>
            <Route element={<MenuShell />}>
              <Route path="/auth" element={<AuthPage />} />
              <Route path="/" element={<RequireAuth><MenuPage /></RequireAuth>} />
              <Route path="/play" element={<RequireAuth><MapPage /></RequireAuth>} />
              <Route path="/character" element={<RequireAuth><CharacterPage /></RequireAuth>} />
              <Route path="/profile" element={<RequireAuth><ProfilePage /></RequireAuth>} />
            </Route>
            <Route path="/game" element={<RequireAuth><GamePage /></RequireAuth>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        )}
      </PageFade>
    </Suspense>
  )
}
