import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Crosshair } from 'lucide-react'
import { useLocale } from '../i18n/LocaleContext.jsx'

/** PvE hub: pick a wave mode and jump into a private room. */
export default function PvePage() {
  const { t } = useLocale()
  const navigate = useNavigate()

  return (
    <div className="screen">
      <div className="screen__title">{t('modes.pve.name')}</div>

      <div className="screen__box">
        <div className="modes">
          <button
            type="button"
            className="mode mode--pve"
            onClick={() => navigate('/game?map=arena&mode=arena')}
          >
            <span className="mode__icon" aria-hidden="true">
              <Crosshair size={28} strokeWidth={2.4} />
            </span>
            <span className="mode__text">
              <span className="mode__name">{t('pve.arena.name')}</span>
              <span className="mode__desc">{t('pve.arena.desc')}</span>
            </span>
          </button>
        </div>

        <Link className="btn btn--ghost btn--with-icon" to="/play">
          <ArrowLeft className="icon" size={22} strokeWidth={2.4} aria-hidden="true" />
          <span>{t('modes.back')}</span>
        </Link>
      </div>
    </div>
  )
}
