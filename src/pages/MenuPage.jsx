import { Link, useNavigate } from 'react-router-dom'
import LogoutIcon from '../components/LogoutIcon.jsx'
import Avatar from '../components/Avatar.jsx'
import { useAuth } from '../auth/context.js'
import { useLocale } from '../i18n/LocaleContext.jsx'

export default function MenuPage() {
  const { user, logout } = useAuth()
  const { t } = useLocale()
  const navigate = useNavigate()
  const showLogout = !user.viaTelegram

  return (
    <div className="screen">
      <div className="screen__box">
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

        <button className="btn" type="button" onClick={() => navigate('/play')}>
          {t('menu.play')}
        </button>
        <Link className="btn btn--ghost" to="/character">{t('menu.looks')}</Link>
      </div>
    </div>
  )
}
