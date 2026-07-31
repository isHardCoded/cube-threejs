import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus, RefreshCw } from 'lucide-react'
import { MAPS } from '../config/maps.js'
import { matchmaking } from '../api/client.js'
import { useLocale } from '../i18n/LocaleContext.jsx'
import Spinner from '../components/Spinner.jsx'

const POLL_MS = 2500

function mapMeta(id) {
  return MAPS.find((m) => m.id === id) || { id, banner: '', ready: false }
}

function stateKey(state) {
  if (state === 'live') return 'pvp.lobby.state.live'
  if (state === 'over') return 'pvp.lobby.state.over'
  return 'pvp.lobby.state.waiting'
}

/** Browse open PvP lobbies: players, map art, joinability. */
export default function PvpLobbiesPage() {
  const { t, translateError } = useLocale()
  const navigate = useNavigate()
  const [lobbies, setLobbies] = useState(null)
  const [error, setError] = useState('')

  async function load() {
    try {
      const res = await matchmaking.lobbies()
      setLobbies(res.lobbies || [])
      setError('')
    } catch (err) {
      setError(translateError(err.message))
    }
  }

  useEffect(() => {
    load()
    const id = setInterval(load, POLL_MS)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="screen">
      <div className="screen__title">{t('pvp.hub.list.name')}</div>

      <div className="screen__box">
        <div className="pvp-hint">{t('pvp.list.hint')}</div>

        {error && <div className="screen__error">{error}</div>}

        {lobbies == null ? (
          <Spinner label={t('common.loading')} />
        ) : lobbies.length === 0 ? (
          <div className="pvp-empty screen__card">
            <div className="pvp-empty__text">{t('pvp.list.empty')}</div>
          </div>
        ) : (
          <div className="lobby-list">
            {lobbies.map((lobby, i) => {
              const map = mapMeta(lobby.mapId)
              return (
                <button
                  key={lobby.id}
                  type="button"
                  className={`lobby-card${lobby.joinable ? '' : ' is-full'}`}
                  style={{ animationDelay: `${0.04 + i * 0.05}s` }}
                  onClick={() => navigate(`/play/pvp/lobby/${encodeURIComponent(lobby.id)}`)}
                >
                  <div
                    className="lobby-card__art"
                    style={map.banner ? { backgroundImage: `url(${map.banner})` } : undefined}
                  />
                  <div className="lobby-card__body">
                    <div className="lobby-card__top">
                      <span className="lobby-card__map">{t(`maps.${lobby.mapId}.name`)}</span>
                      <span className="lobby-card__count">
                        {lobby.players}/{lobby.capacity}
                      </span>
                    </div>
                    <div className="lobby-card__meta">
                      <span>{t(stateKey(lobby.state))}</span>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}

        <div className="pick-actions">
          <Link className="btn btn--ghost btn--icon" to="/play/pvp" aria-label={t('map.back')}>
            <ArrowLeft className="icon" size={22} strokeWidth={2.4} aria-hidden="true" />
          </Link>
          <button className="btn btn--ghost btn--icon" type="button" onClick={load} aria-label={t('pvp.list.refresh')}>
            <RefreshCw className="icon" size={20} strokeWidth={2.4} aria-hidden="true" />
          </button>
          <Link className="btn btn--with-icon" to="/play/pvp/create">
            <Plus className="icon" size={20} strokeWidth={2.4} aria-hidden="true" />
            <span>{t('pvp.hub.create.name')}</span>
          </Link>
        </div>
      </div>
    </div>
  )
}
