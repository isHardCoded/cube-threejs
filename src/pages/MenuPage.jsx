import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Gamepad2, ScrollText, Settings, Shirt, Trophy, Users, Shield } from 'lucide-react'
import LogoutIcon from '../components/LogoutIcon.jsx'
import SettingsModal from '../components/SettingsModal.jsx'
import Avatar from '../components/Avatar.jsx'
import { badges as badgesApi } from '../api/client.js'
import { useAuth } from '../auth/context.js'
import { useLocale } from '../i18n/LocaleContext.jsx'

function MenuBadge({ count }) {
  if (!count) return null
  const label = count > 99 ? '99+' : String(count)
  return <span className="menu-badge" aria-label={label}>{label}</span>
}

function rise(i) {
  return { animationDelay: `${0.04 + i * 0.07}s` }
}

export default function MenuPage() {
  const { user, logout } = useAuth()
  const { t } = useLocale()
  const navigate = useNavigate()
  const showLogout = !user.viaTelegram
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [friendRequests, setFriendRequests] = useState(0)
  const [questsClaimable, setQuestsClaimable] = useState(0)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const data = await badgesApi.get()
        if (!alive) return
        setFriendRequests(data.friendRequests || 0)
        setQuestsClaimable(data.questsClaimable || 0)
      } catch {
        // menu stays usable without badges
      }
    })()
    return () => { alive = false }
  }, [])

  return (
    <div className="screen">
      <div className="screen__box">
        <div className="menu-row menu-rise" style={rise(0)}>
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

        <button
          className="btn btn--with-icon menu-rise"
          type="button"
          style={rise(1)}
          onClick={() => navigate('/play')}
        >
          <Gamepad2 className="icon" size={22} strokeWidth={2.4} aria-hidden="true" />
          <span>{t('menu.play')}</span>
        </button>

        <div className="menu-pair menu-rise" style={rise(2)}>
          <button className="btn btn--alt btn--with-icon" type="button" onClick={() => navigate('/rating')}>
            <Trophy className="icon" size={22} strokeWidth={2.4} aria-hidden="true" />
            <span>{t('menu.rating')}</span>
          </button>
          <button className="btn btn--ghost btn--with-icon menu-btn--badge" type="button" onClick={() => navigate('/friends')}>
            <Users className="icon" size={22} strokeWidth={2.4} aria-hidden="true" />
            <span>{t('menu.friends')}</span>
            <MenuBadge count={friendRequests} />
          </button>
        </div>

        <button
          className="btn btn--ghost btn--with-icon menu-btn--badge menu-rise"
          type="button"
          style={rise(3)}
          onClick={() => navigate('/quests')}
        >
          <ScrollText className="icon" size={22} strokeWidth={2.4} aria-hidden="true" />
          <span>{t('menu.quests')}</span>
          <MenuBadge count={questsClaimable} />
        </button>

        {user?.isAdmin && (
          <button
            className="btn btn--ghost btn--with-icon menu-rise"
            type="button"
            style={rise(4)}
            onClick={() => navigate('/admin')}
          >
            <Shield className="icon" size={22} strokeWidth={2.4} aria-hidden="true" />
            <span>{t('menu.admin')}</span>
          </button>
        )}
      </div>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
