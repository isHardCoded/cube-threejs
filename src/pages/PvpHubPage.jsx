import { Link, useLocation } from 'react-router-dom'
import { ArrowLeft, List, Search } from 'lucide-react'
import { useLocale } from '../i18n/LocaleContext.jsx'

const RETURN_MESSAGES = {
  opponent_left: 'pvp.opponentLeft',
  opponent_missing: 'pvp.opponentMissing',
  lobby_closed: 'pvp.opponentLeft',
  match_gone: 'pvp.matchGone',
}

/** PvP entry: quick search or lobby browser. */
export default function PvpHubPage() {
  const { t } = useLocale()
  const { state } = useLocation()
  const notice = RETURN_MESSAGES[state?.reason] || ''

  return (
    <div className="screen">
      <div className="screen__title">{t('modes.pvp.name')}</div>

      <div className="screen__box">
        {notice && <div className="screen__error">{t(notice)}</div>}

        <div className="modes">
          <Link
            to="/play/pvp/quick"
            className="mode mode--pvp"
            style={{ animationDelay: '0.04s' }}
          >
            <span className="mode__icon" aria-hidden="true">
              <Search size={28} strokeWidth={2.4} />
            </span>
            <span className="mode__text">
              <span className="mode__name">{t('pvp.hub.quick.name')}</span>
              <span className="mode__desc">{t('pvp.hub.quick.desc')}</span>
            </span>
          </Link>

          <Link
            to="/play/pvp/lobbies"
            className="mode mode--pvp"
            style={{ animationDelay: '0.11s' }}
          >
            <span className="mode__icon" aria-hidden="true">
              <List size={28} strokeWidth={2.4} />
            </span>
            <span className="mode__text">
              <span className="mode__name">{t('pvp.hub.list.name')}</span>
              <span className="mode__desc">{t('pvp.hub.list.desc')}</span>
            </span>
          </Link>
        </div>

        <Link className="btn btn--ghost btn--with-icon" to="/play">
          <ArrowLeft className="icon" size={22} strokeWidth={2.4} aria-hidden="true" />
          <span>{t('modes.back')}</span>
        </Link>
      </div>
    </div>
  )
}
