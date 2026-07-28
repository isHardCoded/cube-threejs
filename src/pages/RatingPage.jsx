import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import Avatar from '../components/Avatar.jsx'
import Spinner from '../components/Spinner.jsx'
import { rating } from '../api/client.js'
import { useLocale } from '../i18n/LocaleContext.jsx'

function placeClass(rank) {
  if (rank === 1) return 'rating-row--gold'
  if (rank === 2) return 'rating-row--silver'
  if (rank === 3) return 'rating-row--bronze'
  return ''
}

function RatingRow({ player, isMe, rowRef, pinned }) {
  return (
    <div
      ref={rowRef}
      className={[
        'rating-row',
        isMe ? 'is-me' : '',
        pinned ? 'is-pinned' : '',
        placeClass(player.rank),
      ].filter(Boolean).join(' ')}
    >
      <span className="rating-row__rank">{player.rank}</span>
      <Avatar user={player} size="sm" />
      <span className="rating-row__name">{player.username}</span>
      <span className="rating-row__cubes">{player.cubes}</span>
    </div>
  )
}

export default function RatingPage() {
  const { t, translateError } = useLocale()
  const [players, setPlayers] = useState(null)
  const [me, setMe] = useState(null)
  const [error, setError] = useState('')
  const [meVisible, setMeVisible] = useState(true)
  const [pinReady, setPinReady] = useState(false)
  const meRowRef = useRef(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const data = await rating.top()
        if (!alive) return
        setPlayers(data.players || [])
        setMe(data.me || null)
      } catch (err) {
        if (alive) setError(translateError(err.message))
      }
    })()
    return () => { alive = false }
  }, [translateError])

  const list = useMemo(() => {
    if (!players) return []
    if (!me) return players
    if (players.some((p) => String(p.id) === String(me.id))) return players
    // outside the top page: keep them at the end so the pin has a scroll target
    return [...players, me]
  }, [players, me])

  useEffect(() => {
    const el = meRowRef.current
    if (!el || !me) {
      setMeVisible(true)
      return
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        setMeVisible(entry.isIntersecting)
        // enable transitions only after the first real visibility check
        setPinReady(true)
      },
      { root: el.closest('.rating-list__scroll'), threshold: 0.55 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [me, list])

  const showPin = Boolean(me && !meVisible)

  return (
    <div className="screen">
      <div className="screen__title">{t('rating.title')}</div>

      <div className="screen__box">
        {error && <div className="screen__error">{error}</div>}

        {!players && !error && <Spinner label={t('common.loading')} />}

        {players && players.length === 0 && !me && (
          <div className="rating-empty">{t('rating.empty')}</div>
        )}

        {players && (players.length > 0 || me) && (
          <div className="rating-list screen__card">
            <div className="rating-head">
              <span className="rating-head__rank" aria-hidden="true" />
              <span className="rating-head__player">{t('rating.colPlayer')}</span>
              <span className="rating-head__cubes">{t('rating.colCubes')}</span>
            </div>

            <div className="rating-list__scroll" aria-label={t('rating.top')}>
              {list.map((p) => {
                const isMe = me && String(p.id) === String(me.id)
                return (
                  <RatingRow
                    key={p.id}
                    player={p}
                    isMe={isMe}
                    rowRef={isMe ? meRowRef : undefined}
                  />
                )
              })}
            </div>

            {me && (
              <div
                className={[
                  'rating-list__pin',
                  showPin ? 'is-open' : '',
                  pinReady ? 'is-ready' : '',
                ].filter(Boolean).join(' ')}
                aria-hidden={!showPin}
              >
                <div className="rating-list__pin-inner">
                  <RatingRow player={me} isMe pinned />
                </div>
              </div>
            )}
          </div>
        )}

        <Link
          className="btn btn--ghost btn--with-icon"
          to="/"
        >
          <ArrowLeft className="icon" size={22} strokeWidth={2.4} aria-hidden="true" />
          <span>{t('rating.back')}</span>
        </Link>
      </div>
    </div>
  )
}
