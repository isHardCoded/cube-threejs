import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, LogIn } from 'lucide-react'
import { api, matchmaking } from '../api/client.js'
import { useLocale } from '../i18n/LocaleContext.jsx'
import Spinner from '../components/Spinner.jsx'

const INFO_MS = 2500

/** Persistent free-fight lobby: join / leave anytime — no matchmaking search. */
export default function PvpFreePage() {
  const { t, translateError } = useLocale()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState(null)

  const refresh = useCallback(async () => {
    try {
      const res = await api('/api/match/free')
      setInfo(res.lobby || null)
    } catch {
      // keep last known snapshot
    }
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, INFO_MS)
    return () => clearInterval(id)
  }, [refresh])

  async function join() {
    if (busy) return
    setError('')
    setBusy(true)
    try {
      const res = await matchmaking.free()
      if (res.state === 'matched' && res.matchId) {
        navigate(`/game?match=${encodeURIComponent(res.matchId)}&map=${res.mapId || 'freefight'}`)
        return
      }
      setError(t('pvp.free.joinFail'))
    } catch (err) {
      setError(translateError(err.message))
    } finally {
      setBusy(false)
    }
  }

  const players = info?.players ?? null
  const capacity = info?.capacity ?? null
  const full = info && !info.joinable

  return (
    <div className="screen">
      <div className="screen__title">{t('pvp.hub.free.name')}</div>

      <div className="screen__box">
        <div className="screen__card" style={{ display: 'grid', gap: '0.85rem', justifyItems: 'center' }}>
          <div className="pvp-search__meta">{t('pvp.free.hint')}</div>
          {players != null && capacity != null && (
            <div className="pvp-search__meta">
              {t('pvp.free.online', { n: players, max: capacity })}
            </div>
          )}
          {error && <div className="screen__error">{error}</div>}
          <div className="pick-actions">
            <Link className="btn btn--ghost btn--icon" to="/play/pvp" aria-label={t('map.back')}>
              <ArrowLeft className="icon" size={22} strokeWidth={2.4} aria-hidden="true" />
            </Link>
            <button
              className="btn btn--with-icon"
              type="button"
              onClick={join}
              disabled={busy || full}
            >
              {busy ? <Spinner /> : (
                <>
                  <LogIn className="icon" size={20} strokeWidth={2.4} aria-hidden="true" />
                  <span>{full ? t('pvp.free.full') : t('pvp.free.join')}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
