import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus } from 'lucide-react'
import { matchmaking } from '../api/client.js'
import { useLocale } from '../i18n/LocaleContext.jsx'

/** Create a hosted Duel Run lobby (size 2) and enter as host. */
export default function DuelRunCreatePage() {
  const { t, translateError } = useLocale()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [lobbyId, setLobbyId] = useState('')

  async function create() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const res = await matchmaking.duelRunCreateLobby()
      if (res.state === 'matched') {
        setLobbyId(res.matchId)
        navigate(`/game?match=${encodeURIComponent(res.matchId)}&map=${res.mapId || 'duelrun'}`)
        return
      }
      setError(t('pvp.matchGone'))
    } catch (err) {
      setError(translateError(err.message))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="screen">
      <div className="screen__title">{t('duelrun.hub.create.name')}</div>

      <div className="screen__box">
        <div className="pvp-hint">{t('duelrun.create.hint')}</div>
        {lobbyId && <div className="pvp-search__meta">ID: {lobbyId}</div>}
        {error && <div className="screen__error">{error}</div>}

        <div className="pick-actions">
          <Link className="btn btn--ghost btn--icon" to="/play/pvp/duel-run" aria-label={t('map.back')}>
            <ArrowLeft className="icon" size={22} strokeWidth={2.4} aria-hidden="true" />
          </Link>
          <button className="btn btn--with-icon" type="button" disabled={busy} onClick={create}>
            <Plus className="icon" size={20} strokeWidth={2.4} aria-hidden="true" />
            <span>{t('duelrun.create.action')}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
