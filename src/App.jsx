import { Suspense, lazy } from 'react'
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import AuthPage from './pages/AuthPage.jsx'
import MenuPage from './pages/MenuPage.jsx'
import ModePage from './pages/ModePage.jsx'
import TrainingMapPage from './pages/TrainingMapPage.jsx'
import PvpHubPage from './pages/PvpHubPage.jsx'
import PvpQuickPage from './pages/PvpQuickPage.jsx'
import PvpFreePage from './pages/PvpFreePage.jsx'
import PvpLobbiesPage from './pages/PvpLobbiesPage.jsx'
import PvpLobbyPage from './pages/PvpLobbyPage.jsx'
import PvpCreatePage from './pages/PvpCreatePage.jsx'
import DuelRunHubPage from './pages/DuelRunHubPage.jsx'
import DuelRunQuickPage from './pages/DuelRunQuickPage.jsx'
import DuelRunCreatePage from './pages/DuelRunCreatePage.jsx'
import PvePage from './pages/PvePage.jsx'
import ProfilePage from './pages/ProfilePage.jsx'
import RatingPage from './pages/RatingPage.jsx'
import FriendsPage from './pages/FriendsPage.jsx'
import QuestsPage from './pages/QuestsPage.jsx'
import FarmPage from './pages/FarmPage.jsx'
import DicePage from './pages/DicePage.jsx'
import AdminShell from './components/AdminShell.jsx'
import AdminPage from './pages/AdminPage.jsx'
import AdminQuestsPage from './pages/AdminQuestsPage.jsx'
import AdminPostsPage from './pages/AdminPostsPage.jsx'
import UserProfilePage from './pages/UserProfilePage.jsx'
import PageFade from './components/PageFade.jsx'
import Spinner from './components/Spinner.jsx'
import { useAuth } from './auth/context.js'
import { useLocale } from './i18n/LocaleContext.jsx'

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

function RequireAdmin({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <Splash />
  if (!user) return <Navigate to="/auth" replace />
  if (!user.isAdmin) return <Navigate to="/" replace />
  return children
}

function MenuShell() {
  return <Outlet />
}

function GameRoutes() {
  return (
    <PageFade>
      {(location) => (
        <Routes location={location}>
          <Route element={<MenuShell />}>
            <Route path="/auth" element={<AuthPage />} />
            <Route path="/" element={<RequireAuth><MenuPage /></RequireAuth>} />
            <Route path="/play" element={<RequireAuth><ModePage /></RequireAuth>} />
            <Route path="/play/training" element={<RequireAuth><TrainingMapPage /></RequireAuth>} />
            <Route path="/play/pvp" element={<RequireAuth><PvpHubPage /></RequireAuth>} />
            <Route path="/play/pvp/quick" element={<RequireAuth><PvpQuickPage /></RequireAuth>} />
            <Route path="/play/pvp/free" element={<RequireAuth><PvpFreePage /></RequireAuth>} />
            <Route path="/play/pvp/lobbies" element={<RequireAuth><PvpLobbiesPage /></RequireAuth>} />
            <Route path="/play/pvp/lobby/:id" element={<RequireAuth><PvpLobbyPage /></RequireAuth>} />
            <Route path="/play/pvp/create" element={<RequireAuth><PvpCreatePage /></RequireAuth>} />
            <Route path="/play/pvp/duel-run" element={<RequireAuth><DuelRunHubPage /></RequireAuth>} />
            <Route path="/play/pvp/duel-run/quick" element={<RequireAuth><DuelRunQuickPage /></RequireAuth>} />
            <Route path="/play/pvp/duel-run/create" element={<RequireAuth><DuelRunCreatePage /></RequireAuth>} />
            <Route path="/play/pvp/dice" element={<RequireAuth><DicePage /></RequireAuth>} />
            <Route path="/play/pve" element={<RequireAuth><PvePage /></RequireAuth>} />
            <Route path="/character" element={<RequireAuth><CharacterPage /></RequireAuth>} />
            <Route path="/profile" element={<RequireAuth><ProfilePage /></RequireAuth>} />
            <Route path="/u/:id" element={<RequireAuth><UserProfilePage /></RequireAuth>} />
            <Route path="/rating" element={<RequireAuth><RatingPage /></RequireAuth>} />
            <Route path="/friends" element={<RequireAuth><FriendsPage /></RequireAuth>} />
            <Route path="/quests" element={<RequireAuth><QuestsPage /></RequireAuth>} />
            <Route path="/farm" element={<RequireAuth><FarmPage /></RequireAuth>} />
          </Route>
          <Route path="/game" element={<RequireAuth><GamePage /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      )}
    </PageFade>
  )
}

export default function App() {
  return (
    <Suspense fallback={<Splash />}>
      <Routes>
        <Route
          path="/admin"
          element={(
            <RequireAuth>
              <RequireAdmin>
                <AdminShell />
              </RequireAdmin>
            </RequireAuth>
          )}
        >
          <Route index element={<AdminPage />} />
          <Route path="quests" element={<AdminQuestsPage />} />
          <Route path="posts" element={<AdminPostsPage />} />
        </Route>
        <Route path="*" element={<GameRoutes />} />
      </Routes>
    </Suspense>
  )
}
