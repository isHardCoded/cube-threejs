import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, Search, X } from 'lucide-react'
import { DEFAULT_MAP, MAPS } from '../config/maps.js'
import { matchmaking, online as onlineApi } from '../api/client.js'
import { useLocale } from '../i18n/LocaleContext.jsx'
import Spinner from '../components/Spinner.jsx'

const POLL_MS = 900
const ONLINE_POLL_MS = 3000

// The server forgets a searcher who stops polling, so a run of failed polls means
// our slot is gone: stop pretending to search rather than spin forever.
const MAX_POLL_FAILURES = 6

// Lobby sizes the server accepts (RoomSizes in server/arena.go). Every room fills
// up to its size but starts as soon as two cubes are in.
const ROOM_SIZES = [2, 4, 8, 10]

function sizeLabel(size) {
  if (size === 2) return 'pvp.size.duel'
  return size < 5 ? 'pvp.size.few' : 'pvp.size.many'
}

// Why the game screen sent us back here.
const RETURN_MESSAGES = {
  opponent_left: 'pvp.opponentLeft',
  opponent_missing: 'pvp.opponentMissing',
  lobby_closed: 'pvp.opponentLeft',
  match_gone: 'pvp.matchGone',
}

/** PvP: pick a pool of maps, then a room size, then search for a lobby. */
export default function PvpMapPage() {
  const { t, translateError } = useLocale()
  const navigate = useNavigate()
  const { state } = useLocation()
  const [step, setStep] = useState('maps') // maps -> size
  const [selected, setSelected] = useState(() => new Set([DEFAULT_MAP]))
  const [size, setSize] = useState(ROOM_SIZES[0])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(() => RETURN_MESSAGES[state?.reason] || '')
  const [onlineCount, setOnlineCount] = useState(0)
  const pollRef = useRef(null)
  // one search attempt; going stale disowns every request still in flight for it
  const runRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await onlineApi.list()
        if (!cancelled) setOnlineCount((res.players || []).length)
      } catch {
        // keep the last count; a blip should not blank the card
      }
    }
    load()
    const id = setInterval(load, ONLINE_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  function toggle(id) {
    if (searching) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        if (next.size > 1) next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  // endRun stops the current attempt. Only a run we abandon releases the server
  // seat: a run that found a lobby must keep it, or we give up the room we are
  // walking into and leave the others waiting on an empty chair.
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
    navigate(`/game?match=${encodeURIComponent(matchId)}&map=${mapId}`)
  }

  function failSearch(message) {
    endRun({ release: true })
    setSearching(false)
    setError(message)
  }

  async function startSearch() {
    if (searching) return
    const maps = [...selected]
    if (!maps.length) return
    setError('')
    setNotice('')
    setSearching(true)

    const run = { stale: false, maps, size, failures: 0 }
    runRef.current = run

    // Re-queueing is idempotent and doubles as the repair for a seat the server
    // dropped (a stray cancel from another tab, or a lobby that fell through).
    async function claimSeat() {
      const res = await matchmaking.queue(run.maps, run.size)
      if (run.stale) {
        // our own cancel overtook this request: hand the seat straight back, or
        // we linger in the queue as a ghost nobody is polling for
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
        // a blip is normal; a streak means we are not really in the queue
        if (++run.failures >= MAX_POLL_FAILURES) failSearch(translateError(err.message))
      }
    }, POLL_MS)
  }

  useEffect(() => () => endRun({ release: true }), [])

  const onMaps = step === 'maps'

  return (
    <div className="screen">
      <div className="screen__title">{t('modes.pvp.name')}</div>

      <div className={`screen__box pvp-box${searching ? ' is-searching' : ''}`}>
        <div className="pvp-maps" aria-hidden={searching}>
          <div className="pvp-maps__inner">
            <div className="online-card" aria-live="polite">
              <span className="online-card__dot" aria-hidden="true" />
              <span className="online-card__count">{onlineCount}</span>
              <span className="online-card__label">{t('pvp.online.label')}</span>
            </div>

            <div className="pvp-hint">{t(onMaps ? 'pvp.hint' : 'pvp.hintSize')}</div>

            {onMaps ? (
              <div className="maps maps--pick">
                {MAPS.map((m, i) => (
                  <button
                    key={m.id}
                    type="button"
                    disabled={!m.ready || searching}
                    onClick={() => m.ready && toggle(m.id)}
                    style={{ animationDelay: `${0.04 + i * 0.06}s` }}
                    className={[
                      'map', `map--${m.id}`,
                      selected.has(m.id) ? 'is-active' : '',
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
                    disabled={searching}
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
          </div>
        </div>

        {error && <div className="screen__error">{error}</div>}
        {!error && !searching && notice && <div className="screen__error">{t(notice)}</div>}

        <div className={`pvp-search-slot${searching ? ' is-open' : ''}`} aria-hidden={!searching}>
          <div className="pvp-search-slot__inner">
            <div className="pvp-search screen__card">
              <Spinner label={t('pvp.searching')} />
              <div className="pvp-search__meta">
                {t('pvp.searchingRoom', { room: size })}
              </div>
              <button className="btn btn--ghost btn--with-icon" type="button" onClick={stopSearch}>
                <X className="icon" size={20} strokeWidth={2.4} aria-hidden="true" />
                <span>{t('pvp.cancel')}</span>
              </button>
            </div>
          </div>
        </div>

        <div className={`pick-actions pvp-actions${searching ? ' is-hidden' : ''}`}>
          {onMaps ? (
            <Link
              className="btn btn--ghost btn--icon"
              to="/play"
              aria-label={t('map.back')}
              title={t('map.back')}
              tabIndex={searching ? -1 : 0}
            >
              <ArrowLeft className="icon" size={22} strokeWidth={2.4} aria-hidden="true" />
            </Link>
          ) : (
            <button
              className="btn btn--ghost btn--icon"
              type="button"
              onClick={() => setStep('maps')}
              aria-label={t('map.back')}
              title={t('map.back')}
              disabled={searching}
            >
              <ArrowLeft className="icon" size={22} strokeWidth={2.4} aria-hidden="true" />
            </button>
          )}

          {onMaps ? (
            <button
              className="btn btn--with-icon"
              type="button"
              disabled={selected.size === 0}
              onClick={() => { setNotice(''); setStep('size') }}
            >
              <span>{t('pvp.continue')}</span>
            </button>
          ) : (
            <button
              className="btn btn--with-icon"
              type="button"
              disabled={searching}
              onClick={startSearch}
            >
              <Search className="icon" size={22} strokeWidth={2.4} aria-hidden="true" />
              <span>{t('pvp.find')}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
