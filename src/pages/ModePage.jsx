import { Link } from 'react-router-dom'
import { ArrowLeft, Dumbbell, Swords, Bot } from 'lucide-react'
import { useLocale } from '../i18n/LocaleContext.jsx'

const MODES = [
  {
    id: 'pvp',
    to: '/play/pvp',
    icon: Swords,
    tone: 'pvp',
  },
  {
    id: 'pve',
    to: '/play/pve',
    icon: Bot,
    tone: 'pve',
  },
  {
    id: 'training',
    to: '/play/training',
    icon: Dumbbell,
    tone: 'training',
  },
]

export default function ModePage() {
  const { t } = useLocale()

  return (
    <div className="screen">
      <div className="screen__title">{t('modes.title')}</div>

      <div className="screen__box">
        <div className="modes">
          {MODES.map((m, i) => {
            const Icon = m.icon
            return (
              <Link
                key={m.id}
                to={m.to}
                className={`mode mode--${m.tone}`}
                style={{ animationDelay: `${0.04 + i * 0.07}s` }}
              >
                <span className="mode__icon" aria-hidden="true">
                  <Icon size={28} strokeWidth={2.4} />
                </span>
                <span className="mode__text">
                  <span className="mode__name">{t(`modes.${m.id}.name`)}</span>
                  <span className="mode__desc">{t(`modes.${m.id}.desc`)}</span>
                </span>
              </Link>
            )
          })}
        </div>

        <Link className="btn btn--ghost btn--with-icon" to="/">
          <ArrowLeft className="icon" size={22} strokeWidth={2.4} aria-hidden="true" />
          <span>{t('modes.back')}</span>
        </Link>
      </div>
    </div>
  )
}
