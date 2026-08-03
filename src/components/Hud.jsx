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
  CubesIcon,
  UsersIcon,
  WarnIcon,
} from './HudIcons.jsx'
import { useLocale } from '../i18n/LocaleContext.jsx'

const HINT_HOLD_MS = 10000
const DEATH_FADE_MS = 520
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
  mine, mineReady, onMine, onOpenAssets, lives, maxLives = 5, fps = 0, ping = null,
  canStart = false, onStartMatch, deathOverlay = null, freeCombat = false, onEmote,
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
  const [respawnSec, setRespawnSec] = useState(0)
  const [emoteOpen, setEmoteOpen] = useState(false)
  /** Keep overlay mounted while fading out. */
  const [deathUi, setDeathUi] = useState(null) // { endsAt, phase: 'in'|'out'|'enter' }

  useEffect(() => {
    if (!hintOpen || !autoHide) return
    const id = setTimeout(() => {
      setHintOpen(false)
      setAutoHide(false)
    }, HINT_HOLD_MS)
    return () => clearTimeout(id)
  }, [hintOpen, autoHide])

  useEffect(() => {
    if (deathOverlay?.endsAt) {
      setDeathUi({ endsAt: deathOverlay.endsAt, phase: 'enter' })
      let raf2 = 0
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => {
          setDeathUi((prev) => (
            prev && prev.phase === 'enter' ? { ...prev, phase: 'in' } : prev
          ))
        })
      })
      return () => {
        cancelAnimationFrame(raf1)
        cancelAnimationFrame(raf2)
      }
    }
    let id = 0
    setDeathUi((prev) => {
      if (!prev || prev.phase === 'out') return prev
      id = window.setTimeout(() => setDeathUi(null), DEATH_FADE_MS)
      return { ...prev, phase: 'out' }
    })
    return () => clearTimeout(id)
  }, [deathOverlay])

  useEffect(() => {
    if (!deathUi || deathUi.phase === 'out') {
      setRespawnSec(0)
      return
    }
    const tick = () => {
      setRespawnSec(Math.max(0, Math.ceil((deathUi.endsAt - performance.now()) / 1000)))
    }
    tick()
    const id = setInterval(tick, 100)
    return () => clearInterval(id)
  }, [deathUi])

  // WebGL canvases often ignore backdrop-filter — blur/B&W on the canvas itself.
  useEffect(() => {
    const canvas = document.querySelector('canvas.webgl')
    if (!canvas) return undefined
    const live = !!deathUi && (deathUi.phase === 'enter' || deathUi.phase === 'in')

    canvas.classList.add('webgl--dead-ready')
    if (live) {
      let raf2 = 0
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => canvas.classList.add('webgl--dead'))
      })
      return () => {
        cancelAnimationFrame(raf1)
        cancelAnimationFrame(raf2)
      }
    }

    canvas.classList.remove('webgl--dead')
    const clearReady = window.setTimeout(() => {
      canvas.classList.remove('webgl--dead-ready')
    }, DEATH_FADE_MS)
    return () => {
      clearTimeout(clearReady)
      canvas.classList.remove('webgl--dead', 'webgl--dead-ready')
    }
  }, [deathUi])

  function collapseHint() {
    setHintOpen(false)
    setAutoHide(false)
  }

  function pickEmote(emote) {
    onEmote?.(emote)
    setEmoteOpen(false)
  }

  const deathLive = !!deathUi && deathUi.phase !== 'out'
  const secShown = Math.max(1, respawnSec || 1)
  const emotes = [
    { id: 'happy', label: t('hud.emoteHappy'), face: '😊' },
    { id: 'sad', label: t('hud.emoteSad'), face: '😢' },
    { id: 'angry', label: t('hud.emoteAngry'), face: '😠' },
  ]

  return (
    <div className="hud-root">
      {deathUi && (
        <div
          className={`death-overlay death-overlay--${deathUi.phase}`}
          aria-live="polite"
          aria-hidden={!deathLive}
        >
          <div className="death-card">
            <span className="death-card__tag">{t('game.deathOops')}</span>
            <div className="death-card__title">{t('game.youDied')}</div>
            <div className="death-card__timer" aria-label={t('game.respawnIn', { sec: secShown })}>
              <span className="death-card__sec">{secShown}</span>
              <span className="death-card__hint">{t('game.respawnHint')}</span>
            </div>
          </div>
        </div>
      )}
      <div className="hud-fps" aria-hidden="true">
        {fps > 0 ? `${fps} FPS` : '— FPS'}
        {' · '}
        {ping != null ? `${ping} ms` : '— ms'}
      </div>
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

      {freeCombat && onEmote && (
        <div className={`emote${emoteOpen ? ' is-open' : ''}`}>
          <button
            className="emote-fab"
            type="button"
            onClick={() => setEmoteOpen((v) => !v)}
            aria-label={t('hud.emote')}
            title={t('hud.emote')}
            aria-expanded={emoteOpen}
          >
            😊
          </button>
          <div className="emote__menu" role="menu" aria-hidden={!emoteOpen}>
            {emotes.map((e) => (
              <button
                key={e.id}
                type="button"
                className="emote__pick"
                role="menuitem"
                onClick={() => pickEmote(e.id)}
                title={e.label}
                aria-label={e.label}
              >
                <span className="emote__face" aria-hidden="true">{e.face}</span>
                <span className="emote__label">{e.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {canStart && onStartMatch && (
        <button
          className="arcade-btn arcade-btn--start"
          type="button"
          onClick={onStartMatch}
        >
          {t('game.hostStart')}
        </button>
      )}

      {/* Skill bar — bomb first; more abilities will share this row. */}
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
    </div>
  )
}
