import { Link, useLocation } from 'react-router-dom'
import { ArrowLeft, Search, Plus } from 'lucide-react'
import { useLocale } from '../i18n/LocaleContext.jsx'

const RETURN_MESSAGES = {
  opponent_left: 'pvp.opponentLeft',
  opponent_missing: 'pvp.opponentMissing',
  lobby_closed: 'pvp.opponentLeft',
  match_gone: 'pvp.matchGone',
}

/** Duel Run entry under PvP: quick search or create invite lobby (size 2). */
export default function DuelRunHubPage() {
  const { t } = useLocale()
  const { state } = useLocation()
  const notice = RETURN_MESSAGES[state?.reason] || ''

  return (
    <div className="screen">
      <div className="screen__title">{t('duelrun.title')}</div>

      <div className="screen__box">
        {notice && <div className="screen__error">{t(notice)}</div>}
        <div className="pvp-hint">{t('duelrun.hub.hint')}</div>

        <div className="modes">
          <Link
            to="/play/pvp/duel-run/quick"
            className="mode mode--pvp"
            style={{ animationDelay: '0.04s' }}
          >
            <span className="mode__icon" aria-hidden="true">
              <Search size={28} strokeWidth={2.4} />
            </span>
            <span className="mode__text">
              <span className="mode__name">{t('duelrun.hub.quick.name')}</span>
              <span className="mode__desc">{t('duelrun.hub.quick.desc')}</span>
            </span>
          </Link>

          <Link
            to="/play/pvp/duel-run/create"
            className="mode mode--pvp"
            style={{ animationDelay: '0.11s' }}
          >
            <span className="mode__icon" aria-hidden="true">
              <Plus size={28} strokeWidth={2.4} />
            </span>
            <span className="mode__text">
              <span className="mode__name">{t('duelrun.hub.create.name')}</span>
              <span className="mode__desc">{t('duelrun.hub.create.desc')}</span>
            </span>
          </Link>
        </div>

        <Link className="btn btn--ghost btn--with-icon" to="/play/pvp">
          <ArrowLeft className="icon" size={22} strokeWidth={2.4} aria-hidden="true" />
          <span>{t('modes.back')}</span>
        </Link>
      </div>
    </div>
  )
}
