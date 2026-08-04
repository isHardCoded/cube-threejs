import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BombIcon,
  BoltIcon,
  CubesIcon,
  FlagIcon,
  HomeIcon,
  MoonIcon,
  SunIcon,
} from './HudIcons.jsx'
import { useLocale } from '../i18n/LocaleContext.jsx'

const HINT_HOLD_MS = 10000
const isPhone = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 480px)').matches

function Hearts({ n, max = 3 }) {
  return (
    <div className="hud-lives" aria-label="lives">
      {Array.from({ length: max }, (_, i) => (
        <i key={i} className={`life${i < n ? '' : ' life--spent'}`} />
      ))}
    </div>
  )
}

/** Arcade HUD for Duel Run — same shell as classic Hud. */
export default function DuelRunHud({
  status, matchState, endsAt = 0, myLives = 3, oppLives = 3, myName = 'You', oppName = 'Opponent',
  battle, suddenDeath, matchOver, paused, fps = 0, ping = null,
  isDay, onToggleDay, onRematch, onMine, onOpenAssets,
  mine = '', mineReady = false, myId = '', banner = '',
}) {
  const { t } = useLocale()
  const inBattle = matchState === 'BATTLE_ACTIVE' || matchState === 'BATTLE_INTRO'
  const finished = matchState === 'MATCH_FINISHED' || !!matchOver
  const counting = matchState === 'COUNTDOWN' || matchState === 'LOADING'
  const meBattle = (battle?.players || []).find((p) => String(p.id) === String(myId)) || battle?.players?.[0]
  const oppBattle = (battle?.players || []).find((p) => String(p.id) !== String(myId)) || battle?.players?.[1]
  const iWon = matchOver && String(matchOver.winnerId) === String(myId)

  const controls = [
    [t('hud.ctrl.move'), t('hud.ctrl.moveAction')],
    [t('hud.ctrl.dash'), t('hud.ctrl.dashAction')],
    [t('hud.ctrl.jump'), t('hud.ctrl.jumpAction')],
    [t('hud.ctrl.mine'), t('hud.ctrl.mineAction')],
  ]

  const [hintOpen, setHintOpen] = useState(() => !isPhone())
  const [autoHide, setAutoHide] = useState(() => !isPhone())
  const [countLabel, setCountLabel] = useState('')

  useEffect(() => {
    if (!hintOpen || !autoHide) return
    const id = setTimeout(() => {
      setHintOpen(false)
      setAutoHide(false)
    }, HINT_HOLD_MS)
    return () => clearTimeout(id)
  }, [hintOpen, autoHide])

  useEffect(() => {
    if (!counting || !endsAt) {
      setCountLabel('')
      return undefined
    }
    const tick = () => {
      const left = Math.max(0, endsAt - Date.now())
      if (matchState === 'LOADING') {
        setCountLabel('…')
        return
      }
      // 6s countdown: 5 4 3 2 1 Start
      const sec = left / 1000
      if (sec > 5) setCountLabel('5')
      else if (sec > 4) setCountLabel('4')
      else if (sec > 3) setCountLabel('3')
      else if (sec > 2) setCountLabel('2')
      else if (sec > 1) setCountLabel('1')
      else if (sec > 0.05) setCountLabel('START!!')
      else setCountLabel('')
    }
    tick()
    const id = setInterval(tick, 50)
    return () => clearInterval(id)
  }, [counting, endsAt, matchState])

  function collapseHint() {
    setHintOpen(false)
    setAutoHide(false)
  }

  return (
    <div className="hud-root dr-hud">
      {counting && countLabel && (
        <div className="dr-countdown" aria-live="assertive">
          <div key={countLabel} className={`dr-countdown__pop${countLabel === 'START!!' ? ' is-go' : ''}`}>
            {countLabel}
          </div>
        </div>
      )}

      <div className="hud-fps" aria-hidden="true">
        {fps > 0 ? `${fps} FPS` : '— FPS'}
        {' · '}
        {ping != null ? `${ping} ms` : '— ms'}
      </div>

      <div className="hud-top">
        <div className="toast">
          <span>{myName}</span>
        </div>
        {oppName && (
          <div className="toast">
            <span>{oppName}</span>
          </div>
        )}
        {(status || paused) && !counting && (
          <div className="toast toast--status">
            <BoltIcon />
            <span>{paused ? t('duelrun.reconnecting') : status}</span>
          </div>
        )}
        {banner && (
          <div className="toast toast--banner">
            <FlagIcon />
            <span>{banner}</span>
          </div>
        )}
        {matchState === 'WAITING_FOR_PLAYERS' && (
          <div className="toast toast--status">
            <BoltIcon />
            <span>{t('duelrun.waiting')}</span>
          </div>
        )}
      </div>

      <Hearts n={myLives} max={3} />
      {oppLives != null && (
        <div className="hud-lives hud-lives--opp" aria-label="opp lives">
          {Array.from({ length: 3 }, (_, i) => (
            <i key={i} className={`life${i < oppLives ? '' : ' life--spent'}`} />
          ))}
        </div>
      )}

      {inBattle && battle && (
        <div className="toast toast--alive" style={{ position: 'absolute', top: 72, left: '50%', transform: 'translateX(-50%)' }}>
          <span>{myName}: {meBattle?.hp ?? '—'}</span>
          <span style={{ margin: '0 8px' }}>·</span>
          <span>{oppName}: {oppBattle?.hp ?? '—'}</span>
          {suddenDeath ? <span style={{ marginLeft: 8 }}>{t('duelrun.suddenDeath')}</span> : null}
        </div>
      )}

      <div className="hud-tr">
        <div className="hud-btns">
          <button
            className="arcade-btn arcade-btn--sun arcade-btn--icon"
            type="button"
            onClick={onToggleDay}
            aria-label={isDay ? t('hud.night') : t('hud.day')}
            title={isDay ? t('hud.night') : t('hud.day')}
          >
            {isDay ? <MoonIcon /> : <SunIcon />}
          </button>
          <Link
            className="arcade-btn arcade-btn--ghost arcade-btn--icon"
            to="/play/pvp/duel-run"
            aria-label={t('hud.menu')}
            title={t('hud.menu')}
          >
            <HomeIcon />
          </Link>
        </div>
      </div>

      <div className="hud-bl">
        <div className="hud-bl__row">
          {onOpenAssets && (
            <button
              className="hint__fab hint__fab--assets"
              type="button"
              onClick={onOpenAssets}
              aria-label={t('hud.assets')}
              title={t('hud.assets')}
            >
              <CubesIcon size={20} />
            </button>
          )}
          <div className={`hint${hintOpen ? ' is-open' : ' is-collapsed'}`}>
            <button
              className="hint__fab"
              type="button"
              onClick={() => setHintOpen(true)}
              aria-label={t('hud.showControls')}
              tabIndex={hintOpen ? -1 : 0}
            >
              ?
            </button>
            <div className="hint__panel" aria-hidden={!hintOpen}>
              <ul className="hint__list">
                {controls.map(([key, action]) => (
                  <li key={key}>
                    <b>{key}</b>
                    <span>{action}</span>
                  </li>
                ))}
              </ul>
              <button
                className="hint__close"
                type="button"
                onClick={collapseHint}
                aria-label={t('hud.hideControls')}
                tabIndex={hintOpen ? 0 : -1}
              >
                ×
              </button>
            </div>
          </div>
        </div>
      </div>

      {mine && (
        <div className="hud-skills" role="toolbar" aria-label={t('hud.mine')}>
          <button
            className={`arcade-btn arcade-btn--coral arcade-btn--icon ability${mineReady ? '' : ' is-cooling'}`}
            type="button"
            onClick={onMine}
            aria-label={t('hud.mine')}
            title={t('hud.mine')}
          >
            <BombIcon />
            <span className="ability__meta">{mine}</span>
          </button>
        </div>
      )}

      {finished && matchOver && (
        <div className="dr-result screen__card">
          <div className="screen__title">
            {iWon ? t('duelrun.victory') : t('duelrun.defeat')}
          </div>
          <div className="pick-actions">
            <Link className="btn btn--ghost" to="/play/pvp/duel-run">{t('duelrun.back')}</Link>
            {onRematch && (
              <button className="btn" type="button" onClick={onRematch}>{t('duelrun.rematch')}</button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
