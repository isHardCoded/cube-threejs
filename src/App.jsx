import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import AuthPage from './pages/AuthPage.jsx'
import MenuPage from './pages/MenuPage.jsx'
import MapPage from './pages/MapPage.jsx'
import Logo from './components/Logo.jsx'
import PageFade from './components/PageFade.jsx'
import Spinner from './components/Spinner.jsx'
import { useAuth } from './auth/context.js'

// Three.js is only needed by the 3D screens: keep it out of the menu bundle.
const GamePage = lazy(() => import('./pages/GamePage.jsx'))
const CharacterPage = lazy(() => import('./pages/CharacterPage.jsx'))

function Splash() {
  return (
    <div className="screen">
      <Logo />
      <Spinner />
    </div>
  )
}

function RequireAuth({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <Splash />
  return user ? children : <Navigate to="/auth" replace />
}

export default function App() {
  return (
    <Suspense fallback={<Splash />}>
      <PageFade>
        {(location) => (
          <Routes location={location}>
            <Route path="/auth" element={<AuthPage />} />
            <Route path="/" element={<RequireAuth><MenuPage /></RequireAuth>} />
            <Route path="/play" element={<RequireAuth><MapPage /></RequireAuth>} />
            <Route path="/character" element={<RequireAuth><CharacterPage /></RequireAuth>} />
            <Route path="/game" element={<RequireAuth><GamePage /></RequireAuth>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        )}
      </PageFade>
    </Suspense>
  )
}
