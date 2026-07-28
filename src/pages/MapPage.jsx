import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Logo from '../components/Logo.jsx'
import { DEFAULT_MAP, MAPS } from '../config/maps.js'

// Dedicated map pick: the home screen stays a hub, this page is only "which
// world" + one green Start that actually enters the match.
export default function MapPage() {
  const [mapId, setMapId] = useState(DEFAULT_MAP)
  const navigate = useNavigate()
  const ready = MAPS.some((m) => m.id === mapId && m.ready)

  return (
    <div className="screen">
      <Logo />

      <div className="screen__box screen__box--wide">
        <div className="screen__title">Выбери карту</div>

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
                <span className="map__name">{m.name}</span>
                <span className="map__soon">{m.ready ? m.desc : 'скоро'}</span>
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
          Начать
        </button>
        <Link className="btn btn--ghost" to="/">Назад</Link>
      </div>
    </div>
  )
}
