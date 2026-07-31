import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus } from 'lucide-react'
import { DEFAULT_MAP, MAPS } from '../config/maps.js'
import { matchmaking } from '../api/client.js'
import { useLocale } from '../i18n/LocaleContext.jsx'

const ROOM_SIZES = [2, 4, 8, 10]

function sizeLabel(size) {
  if (size === 2) return 'pvp.size.duel'
  return size < 5 ? 'pvp.size.few' : 'pvp.size.many'
}

/** Create a hosted lobby: pick one map and a room size, then enter as host. */
export default function PvpCreatePage() {
  const { t, translateError } = useLocale()
  const navigate = useNavigate()
  const [step, setStep] = useState('map') // map -> size
  const [mapId, setMapId] = useState(DEFAULT_MAP)
  const [size, setSize] = useState(ROOM_SIZES[2])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function create() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const res = await matchmaking.createLobby(mapId, size)
      if (res.state === 'matched') {
        navigate(`/game?match=${encodeURIComponent(res.matchId)}&map=${res.mapId}`)
        return
      }
      setError(t('pvp.matchGone'))
    } catch (err) {
      setError(translateError(err.message))
    } finally {
      setBusy(false)
    }
  }

  const onMap = step === 'map'

  return (
    <div className="screen">
      <div className="screen__title">{t('pvp.hub.create.name')}</div>

      <div className="screen__box">
        <div className="pvp-hint">{t(onMap ? 'pvp.create.hintMap' : 'pvp.create.hintSize')}</div>

        {onMap ? (
          <div className="maps maps--pick">
            {MAPS.map((m, i) => (
              <button
                key={m.id}
                type="button"
                disabled={!m.ready || busy}
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
        ) : (
          <div className="sizes">
            {ROOM_SIZES.map((n, i) => (
              <button
                key={n}
                type="button"
                disabled={busy}
                onClick={() => setSize(n)}
                style={{ animationDelay: `${0.04 + i * 0.06}s` }}
                className={`size${size === n ? ' is-active' : ''}`}
              >
                <span className="size__num">{n}</span>
                <span className="size__label">{t(sizeLabel(n))}</span>
              </button>
            ))}
          </div>
        )}

        {error && <div className="screen__error">{error}</div>}

        <div className="pick-actions">
          {onMap ? (
            <Link className="btn btn--ghost btn--icon" to="/play/pvp/lobbies" aria-label={t('map.back')}>
              <ArrowLeft className="icon" size={22} strokeWidth={2.4} aria-hidden="true" />
            </Link>
          ) : (
            <button
              className="btn btn--ghost btn--icon"
              type="button"
              onClick={() => setStep('map')}
              aria-label={t('map.back')}
              disabled={busy}
            >
              <ArrowLeft className="icon" size={22} strokeWidth={2.4} aria-hidden="true" />
            </button>
          )}

          {onMap ? (
            <button
              className="btn"
              type="button"
              disabled={!mapId}
              onClick={() => setStep('size')}
            >
              {t('pvp.continue')}
            </button>
          ) : (
            <button
              className="btn btn--with-icon"
              type="button"
              disabled={busy}
              onClick={create}
            >
              <Plus className="icon" size={20} strokeWidth={2.4} aria-hidden="true" />
              <span>{t('pvp.create.action')}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
