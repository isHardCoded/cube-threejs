import { Link } from 'react-router-dom'
import { ArrowLeft, Construction } from 'lucide-react'
import { useLocale } from '../i18n/LocaleContext.jsx'

export default function PvePage() {
  const { t } = useLocale()

  return (
    <div className="screen">
      <div className="screen__title">{t('modes.pve.name')}</div>

      <div className="screen__box">
        <div className="screen__card pve-soon">
          <Construction className="pve-soon__icon" size={40} strokeWidth={2.2} aria-hidden="true" />
          <div className="pve-soon__title">{t('pve.soonTitle')}</div>
          <div className="pve-soon__text">{t('pve.soonText')}</div>
        </div>

        <Link className="btn btn--ghost btn--with-icon" to="/play">
          <ArrowLeft className="icon" size={22} strokeWidth={2.4} aria-hidden="true" />
          <span>{t('modes.back')}</span>
        </Link>
      </div>
    </div>
  )
}
