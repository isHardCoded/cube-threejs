import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Gamepad2 } from 'lucide-react'
import { DEFAULT_MAP, MAPS } from '../config/maps.js'
import { useLocale } from '../i18n/LocaleContext.jsx'

/** Solo training: pick one map and enter a private room. */
export default function TrainingMapPage() {
  const [mapId, setMapId] = useState(DEFAULT_MAP)
  const navigate = useNavigate()
  const { t } = useLocale()
  const ready = MAPS.some((m) => m.id === mapId && m.ready)

  return (
    <div className="screen">
      <div className="screen__title">{t('modes.training.name')}</div>

      <div className="screen__box">
        <div className="maps maps--pick">
          {MAPS.map((m, i) => (
            <button
              key={m.id}
              type="button"
              disabled={!m.ready}
              onClick={() => m.ready && setMapId(m.id)}
              style={{ animationDelay: `${0.04 + i * 0.06}s` }}
              className={[
                'map', `map--${m.id}`,
                mapId === m.id ? 'is-active' : '',
                m.ready ? '' : 'is-locked',
              ].join(' ')}
            >
              <div
                className="map__art"
                style={m.banner ? { backgroundImage: `url(${m.banner})` } : undefined}
              />
              <div className="map__meta">
                <span className="map__name">{t(`maps.${m.id}.name`)}</span>
                <span className="map__desc">
                  {m.ready ? t(`maps.${m.id}.desc`) : t('map.soon')}
                </span>
              </div>
            </button>
          ))}
        </div>

        <div className="pick-actions">
          <Link
            className="btn btn--ghost btn--icon"
            to="/play"
            aria-label={t('map.back')}
            title={t('map.back')}
          >
            <ArrowLeft className="icon" size={22} strokeWidth={2.4} aria-hidden="true" />
          </Link>
          <button
            className="btn btn--with-icon"
            type="button"
            disabled={!ready}
            onClick={() => navigate(`/game?map=${mapId}&mode=training`)}
          >
            <Gamepad2 className="icon" size={22} strokeWidth={2.4} aria-hidden="true" />
            <span>{t('map.start')}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
