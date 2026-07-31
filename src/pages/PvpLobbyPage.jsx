import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Clock, Crown, LogIn, Users } from 'lucide-react'
import { MAPS } from '../config/maps.js'
import { matchmaking } from '../api/client.js'
import { useLocale } from '../i18n/LocaleContext.jsx'
import Avatar from '../components/Avatar.jsx'
import Spinner from '../components/Spinner.jsx'

const POLL_MS = 2000

function mapMeta(id) {
  return MAPS.find((m) => m.id === id) || { id, banner: '' }
}

function stateKey(state) {
  if (state === 'live') return 'pvp.lobby.state.live'
  if (state === 'over') return 'pvp.lobby.state.over'
  return 'pvp.lobby.state.waiting'
}

/** Lobby detail: map hero, pills, roster, join. */
export default function PvpLobbyPage() {
  const { id } = useParams()
  const { t, translateError } = useLocale()
  const navigate = useNavigate()
  const [lobby, setLobby] = useState(null)
  const [error, setError] = useState('')
  const [joining, setJoining] = useState(false)

  async function load() {
    try {
      const res = await matchmaking.lobby(id)
      setLobby(res)
      setError('')
    } catch (err) {
      setLobby(null)
      setError(translateError(err.message))
    }
  }

  useEffect(() => {
    load()
    const timer = setInterval(load, POLL_MS)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function join() {
    if (joining || !lobby?.joinable) return
    setJoining(true)
    setError('')
    try {
      const res = await matchmaking.joinLobby(id)
      if (res.state === 'matched') {
        navigate(`/game?match=${encodeURIComponent(res.matchId)}&map=${res.mapId}`)
        return
      }
      setError(t('pvp.matchGone'))
    } catch (err) {
      setError(translateError(err.message))
    } finally {
      setJoining(false)
    }
  }

  const map = lobby ? mapMeta(lobby.mapId) : null

  return (
    <div className="screen">
      <div className="screen__title">{t('pvp.lobby.title')}</div>

      <div className="screen__box">
        {lobby == null && !error ? (
          <Spinner label={t('common.loading')} />
        ) : error && !lobby ? (
          <div className="screen__card">
            <div className="screen__error">{error}</div>
            <Link className="btn btn--ghost btn--with-icon" to="/play/pvp/lobbies">
              <ArrowLeft className="icon" size={22} strokeWidth={2.4} aria-hidden="true" />
              <span>{t('modes.back')}</span>
            </Link>
          </div>
        ) : (
          <div className="screen__card lobby-panel">
            <div className="lobby-detail">
              <div
                className="lobby-detail__art"
                style={map?.banner ? { backgroundImage: `url(${map.banner})` } : undefined}
              />
              <div className="lobby-detail__map">{t(`maps.${lobby.mapId}.name`)}</div>
              <div className="lobby-pills">
                <span className="lobby-pill">
                  <Users size={14} strokeWidth={2.4} aria-hidden="true" />
                  {t('pvp.lobby.players', { players: lobby.players, room: lobby.capacity })}
                </span>
                <span className="lobby-pill">
                  <Clock size={14} strokeWidth={2.4} aria-hidden="true" />
                  {t(stateKey(lobby.state))}
                </span>
                {lobby.hostName && (
                  <span className="lobby-pill">
                    <Crown size={14} strokeWidth={2.4} aria-hidden="true" />
                    {lobby.hostName}
                  </span>
                )}
              </div>
              {lobby.state === 'live' && (
                <div className="lobby-detail__note">{t('pvp.lobby.midJoin')}</div>
              )}
            </div>

            <div className="lobby-roster">
              <div className="lobby-roster__head">
                <span className="lobby-roster__title">
                  <Users size={16} strokeWidth={2.4} aria-hidden="true" />
                  {t('pvp.lobby.roster')}
                </span>
                <span className="lobby-roster__count">
                  {lobby.players} / {lobby.capacity}
                </span>
              </div>
              <ul className="lobby-roster__list">
                {(lobby.members || []).map((m) => (
                  <li key={m.id} className="lobby-roster__item">
                    <div className="lobby-roster__who">
                      <Avatar user={{ username: m.username, avatarUrl: m.avatarUrl }} size="sm" />
                      <span className="lobby-roster__name">{m.username}</span>
                    </div>
                    {m.isHost && (
                      <span className="lobby-roster__crown" title={m.username} aria-hidden="true">
                        <Crown size={14} strokeWidth={2.4} />
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            {error && <div className="screen__error">{error}</div>}

            <div className="pick-actions lobby-actions">
              <Link
                className="btn btn--ghost btn--icon"
                to="/play/pvp/lobbies"
                aria-label={t('modes.back')}
                title={t('modes.back')}
              >
                <ArrowLeft className="icon" size={22} strokeWidth={2.4} aria-hidden="true" />
              </Link>
              <button
                className="btn btn--with-icon lobby-actions__join"
                type="button"
                disabled={!lobby.joinable || joining}
                onClick={join}
              >
                <LogIn className="icon" size={22} strokeWidth={2.4} aria-hidden="true" />
                <span>
                  {lobby.joinable ? t('pvp.lobby.join') : t('pvp.lobby.full')}
                </span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
