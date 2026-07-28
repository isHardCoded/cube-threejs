import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BoltIcon,
  BombIcon,
  ClockIcon,
  FlagIcon,
  HomeIcon,
  LayersIcon,
  MoonIcon,
  SunIcon,
  UsersIcon,
  WarnIcon,
} from './HudIcons.jsx'
import { useLocale } from '../i18n/LocaleContext.jsx'

const HINT_HOLD_MS = 10000
const isPhone = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 480px)').matches

function TimerIcon({ kind }) {
  if (kind === 'danger') return <WarnIcon />
  if (kind === 'calm') return <LayersIcon />
  if (kind === 'wait') return <UsersIcon />
  if (kind === 'next') return <ClockIcon />
  return <ClockIcon />
}

// Overlay above the canvas. Everything here is driven by onHud patches
// coming out of the game loop, so React only re-renders when text changes.
export default function Hud({
  status, timer, timerKind, timerDanger, alive, banner, isDay, onToggleDay,
  mine, mineReady, onMine, lives, maxLives = 5,
}) {
  const { t } = useLocale()
  const controls = [
    [t('hud.ctrl.move'), t('hud.ctrl.moveAction')],
    [t('hud.ctrl.dash'), t('hud.ctrl.dashAction')],
    [t('hud.ctrl.jump'), t('hud.ctrl.jumpAction')],
    [t('hud.ctrl.mine'), t('hud.ctrl.mineAction')],
  ]

  // Phones start collapsed so the mine button isn't crushed by the cheatsheet.
  // Desktop still opens once for HINT_HOLD_MS.
  const [hintOpen, setHintOpen] = useState(() => !isPhone())
  const [autoHide, setAutoHide] = useState(() => !isPhone())

  useEffect(() => {
    if (!hintOpen || !autoHide) return
    const id = setTimeout(() => {
      setHintOpen(false)
      setAutoHide(false)
    }, HINT_HOLD_MS)
    return () => clearTimeout(id)
  }, [hintOpen, autoHide])

  function collapseHint() {
    setHintOpen(false)
    setAutoHide(false)
  }

  return (
    <div className="hud-root">
      <div className="hud-top">
        {timer && (
          <div className={`toast${timerDanger ? ' toast--danger' : ''}`}>
            <TimerIcon kind={timerKind} />
            <span>{timer}</span>
          </div>
        )}
        {alive && (
          <div className="toast toast--alive">
            <UsersIcon />
            <span>{alive}</span>
          </div>
        )}
        {status && (
          <div className="toast toast--status">
            <BoltIcon />
            <span>{status}</span>
          </div>
        )}
        {banner && (
          <div className="toast toast--banner">
            <FlagIcon />
            <span>{banner}</span>
          </div>
        )}
      </div>

      {lives != null && (
        <div className="hud-lives">
          <span className="lives__label">{t('hud.lives')}</span>
          {Array.from({ length: maxLives }, (_, i) => (
            <i key={i} className={`life${i < lives ? '' : ' life--spent'}`} />
          ))}
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
            to="/"
            aria-label={t('hud.menu')}
            title={t('hud.menu')}
          >
            <HomeIcon />
          </Link>
        </div>
      </div>

      <div className="hud-bl">
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

      {mine && (
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
      )}
    </div>
  )
}
