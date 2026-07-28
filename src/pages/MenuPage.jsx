import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Gamepad2, Settings, Shirt, Trophy } from 'lucide-react'
import LogoutIcon from '../components/LogoutIcon.jsx'
import SettingsModal from '../components/SettingsModal.jsx'
import Avatar from '../components/Avatar.jsx'
import { useAuth } from '../auth/context.js'
import { useLocale } from '../i18n/LocaleContext.jsx'

export default function MenuPage() {
  const { user, logout } = useAuth()
  const { t } = useLocale()
  const navigate = useNavigate()
  const showLogout = !user.viaTelegram
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <div className="screen">
      <div className="screen__box">
        <div className="menu-row">
          <div className="screen__card">
            <div className="who">
              <div className="who__identity">
                <Avatar user={user} size="sm" onClick={() => navigate('/profile')} />
                <span className="who__name">{user.username}</span>
              </div>
              {showLogout && (
                <button
                  type="button"
                  className="who__out"
                  onClick={logout}
                  aria-label={t('menu.logout')}
                  title={t('menu.logout')}
                >
                  <LogoutIcon />
                </button>
              )}
            </div>

            <div className="cubes">
              <span className="cubes__value">{user.cubes}</span>
              <span className="cubes__label">{t('menu.cubes')}</span>
            </div>
          </div>

          <div className="menu-actions">
            <button
              className="btn btn--ghost btn--icon"
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label={t('menu.settings')}
              title={t('menu.settings')}
            >
              <Settings className="icon" size={22} strokeWidth={2.4} aria-hidden="true" />
            </button>
            <Link
              className="btn btn--ghost btn--icon"
              to="/character"
              aria-label={t('menu.looks')}
              title={t('menu.looks')}
            >
              <Shirt className="icon" size={22} strokeWidth={2.4} aria-hidden="true" />
            </Link>
          </div>
        </div>

        <button className="btn btn--with-icon" type="button" onClick={() => navigate('/play')}>
          <Gamepad2 className="icon" size={22} strokeWidth={2.4} aria-hidden="true" />
          <span>{t('menu.play')}</span>
        </button>

        <button className="btn btn--alt btn--with-icon" type="button" onClick={() => navigate('/rating')}>
          <Trophy className="icon" size={22} strokeWidth={2.4} aria-hidden="true" />
          <span>{t('menu.rating')}</span>
        </button>
      </div>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
