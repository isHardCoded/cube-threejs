import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, X } from 'lucide-react'
import { matchmaking } from '../api/client.js'
import { useLocale } from '../i18n/LocaleContext.jsx'
import Spinner from '../components/Spinner.jsx'

const POLL_MS = 900
const MAX_POLL_FAILURES = 6

/** Duel Run quick queue (strictly 2 players). */
export default function DuelRunQuickPage() {
  const { t, translateError } = useLocale()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [searching, setSearching] = useState(false)
  const pollRef = useRef(null)
  const runRef = useRef(null)

  function endRun({ release }) {
    clearInterval(pollRef.current)
    pollRef.current = null
    if (!runRef.current) return
    runRef.current.stale = true
    runRef.current = null
    if (release) matchmaking.cancel().catch(() => {})
  }

  function stopSearch() {
    endRun({ release: true })
    setSearching(false)
  }

  function goMatch(matchId, mapId) {
    endRun({ release: false })
    setSearching(false)
    navigate(`/game?match=${encodeURIComponent(matchId)}&map=${mapId || 'duelrun'}`)
  }

  function failSearch(message) {
    endRun({ release: true })
    setSearching(false)
    setError(message)
  }

  async function startSearch() {
    if (runRef.current) return
    setError('')
    setSearching(true)

    const run = { stale: false, failures: 0 }
    runRef.current = run

    async function claimSeat() {
      const res = await matchmaking.duelRunQuick()
      if (run.stale) {
        matchmaking.cancel().catch(() => {})
        return true
      }
      if (res.state === 'matched') {
        goMatch(res.matchId, res.mapId)
        return true
      }
      return false
    }

    try {
      if (await claimSeat()) return
    } catch (err) {
      if (!run.stale) failSearch(translateError(err.message))
      return
    }
    if (run.stale) return

    pollRef.current = setInterval(async () => {
      try {
        const st = await matchmaking.status()
        if (run.stale) return
        run.failures = 0
        if (st.state === 'matched') goMatch(st.matchId, st.mapId)
        else if (st.state === 'idle') await claimSeat()
      } catch (err) {
        if (run.stale) return
        if (++run.failures >= MAX_POLL_FAILURES) failSearch(translateError(err.message))
      }
    }, POLL_MS)
  }

  useEffect(() => {
    startSearch()
    return () => endRun({ release: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="screen">
      <div className="screen__title">{t('duelrun.hub.quick.name')}</div>

      <div className="screen__box">
        {error ? (
          <>
            <div className="screen__error">{error}</div>
            <div className="pick-actions">
              <Link className="btn btn--ghost btn--icon" to="/play/pvp/duel-run" aria-label={t('map.back')}>
                <ArrowLeft className="icon" size={22} strokeWidth={2.4} aria-hidden="true" />
              </Link>
              <button className="btn" type="button" onClick={startSearch}>
                {t('pvp.find')}
              </button>
            </div>
          </>
        ) : (
          <div className="pvp-search screen__card">
            <Spinner label={t('pvp.searching')} />
            <div className="pvp-search__meta">{t('duelrun.quick.hint')}</div>
            <button
              className="btn btn--ghost btn--with-icon"
              type="button"
              onClick={() => {
                stopSearch()
                navigate('/play/pvp/duel-run')
              }}
              disabled={!searching}
            >
              <X className="icon" size={20} strokeWidth={2.4} aria-hidden="true" />
              <span>{t('pvp.cancel')}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
