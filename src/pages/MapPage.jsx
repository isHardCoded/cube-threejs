import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { DEFAULT_MAP, MAPS } from '../config/maps.js'
import { useLocale } from '../i18n/LocaleContext.jsx'

// Dedicated map pick: the home screen stays a hub, this page is only "which
// world" + one green Start that actually enters the match.
export default function MapPage() {
  const [mapId, setMapId] = useState(DEFAULT_MAP)
  const navigate = useNavigate()
  const { t } = useLocale()
  const ready = MAPS.some((m) => m.id === mapId && m.ready)

  return (
    <div className="screen">
      <div className="screen__box screen__box--wide">
        <div className="maps maps--pick">
          {MAPS.map((m) => (
            <button
              key={m.id}
              type="button"
              disabled={!m.ready}
              onClick={() => m.ready && setMapId(m.id)}
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
                <span className="map__soon">{m.ready ? t(`maps.${m.id}.desc`) : t('map.soon')}</span>
              </div>
            </button>
          ))}
        </div>

        <button
          className="btn"
          type="button"
          disabled={!ready}
          onClick={() => navigate(`/game?map=${mapId}`)}
        >
          {t('map.start')}
        </button>
        <Link className="btn btn--ghost" to="/">{t('map.back')}</Link>
      </div>
    </div>
  )
}
