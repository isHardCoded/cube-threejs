import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Search, X } from 'lucide-react'
import { DEFAULT_MAP, MAPS } from '../config/maps.js'
import { matchmaking } from '../api/client.js'
import { useLocale } from '../i18n/LocaleContext.jsx'
import Spinner from '../components/Spinner.jsx'

/** PvP: multi-select maps, then search until another player overlaps. */
export default function PvpMapPage() {
  const { t, translateError } = useLocale()
  const navigate = useNavigate()
  const [selected, setSelected] = useState(() => new Set([DEFAULT_MAP]))
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const pollRef = useRef(null)

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

  async function stopSearch() {
    clearInterval(pollRef.current)
    pollRef.current = null
    setSearching(false)
    try {
      await matchmaking.cancel()
    } catch {
      // ignore
    }
  }

  function goMatch(matchId, mapId) {
    clearInterval(pollRef.current)
    pollRef.current = null
    setSearching(false)
    navigate(`/game?match=${encodeURIComponent(matchId)}&map=${mapId}`)
  }

  async function startSearch() {
    setError('')
    const maps = [...selected]
    if (!maps.length) return
    setSearching(true)
    try {
      const res = await matchmaking.queue(maps)
      if (res.state === 'matched') {
        goMatch(res.matchId, res.mapId)
        return
      }
      pollRef.current = setInterval(async () => {
        try {
          const st = await matchmaking.status()
          if (st.state === 'matched') goMatch(st.matchId, st.mapId)
        } catch {
          // keep polling; transient network blips
        }
      }, 900)
    } catch (err) {
      setSearching(false)
      setError(translateError(err.message))
    }
  }

  useEffect(() => () => {
    clearInterval(pollRef.current)
    matchmaking.cancel().catch(() => {})
  }, [])

  return (
    <div className="screen">
      <div className="screen__title">{t('modes.pvp.name')}</div>

      <div className={`screen__box pvp-box${searching ? ' is-searching' : ''}`}>
        <div className="pvp-maps" aria-hidden={searching}>
          <div className="pvp-maps__inner">
            <div className="pvp-hint">{t('pvp.hint')}</div>

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
          </div>
        </div>

        {error && <div className="screen__error">{error}</div>}

        <div className={`pvp-search-slot${searching ? ' is-open' : ''}`} aria-hidden={!searching}>
          <div className="pvp-search-slot__inner">
            <div className="pvp-search screen__card">
              <Spinner label={t('pvp.searching')} />
              <button className="btn btn--ghost btn--with-icon" type="button" onClick={stopSearch}>
                <X className="icon" size={20} strokeWidth={2.4} aria-hidden="true" />
                <span>{t('pvp.cancel')}</span>
              </button>
            </div>
          </div>
        </div>

        <div className={`pick-actions pvp-actions${searching ? ' is-hidden' : ''}`}>
          <Link
            className="btn btn--ghost btn--icon"
            to="/play"
            aria-label={t('map.back')}
            title={t('map.back')}
            tabIndex={searching ? -1 : 0}
          >
            <ArrowLeft className="icon" size={22} strokeWidth={2.4} aria-hidden="true" />
          </Link>
          <button
            className="btn btn--with-icon"
            type="button"
            disabled={selected.size === 0 || searching}
            onClick={startSearch}
          >
            <Search className="icon" size={22} strokeWidth={2.4} aria-hidden="true" />
            <span>{t('pvp.find')}</span>
          </button>
        </div>
      </div>
    </div>
  )
}

