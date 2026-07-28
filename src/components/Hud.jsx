import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Logo from './Logo.jsx'
import { HomeIcon, MoonIcon, SunIcon } from './HudIcons.jsx'

const CONTROLS = [
  ['WASD / свайп', 'ход'],
  ['Двойное нажатие', 'рывок'],
  ['Пробел', 'прыжок'],
  ['E', 'мина'],
]

const HINT_HOLD_MS = 10000
const isPhone = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 480px)').matches

// Overlay above the canvas. Everything here is driven by onHud patches
// coming out of the game loop, so React only re-renders when text changes.
export default function Hud({
  status, timer, timerDanger, alive, banner, isDay, onToggleDay,
  mine, mineReady, onMine, lives, maxLives = 5,
}) {
  // Phones start collapsed so the mine button isn't crushed by the cheatsheet.
  // Desktop still opens once for HINT_HOLD_MS.
  const [hintOpen, setHintOpen] = useState(() => !isPhone())
  const [autoHide, setAutoHide] = useState(() => !isPhone())

  useEffect(() => {
    if (!hintOpen || !autoHide) return
    const t = setTimeout(() => {
      setHintOpen(false)
      setAutoHide(false)
    }, HINT_HOLD_MS)
    return () => clearTimeout(t)
  }, [hintOpen, autoHide])

  function collapseHint() {
    setHintOpen(false)
    setAutoHide(false)
  }

  return (
    <div className="hud-root">
      <div className="hud hud--title"><Logo small /></div>

      <div className="hud-top">
        {alive && <div className="badge badge--alive">{alive}</div>}
        {timer && (
          <div className={`badge badge--timer${timerDanger ? ' is-danger' : ''}`}>
            {timer}
          </div>
        )}
        {status && <div className="badge badge--status">{status}</div>}
      </div>

      <div className="hud-btns">
        <button
          className="arcade-btn arcade-btn--sun arcade-btn--icon"
          type="button"
          onClick={onToggleDay}
          aria-label={isDay ? 'Ночь' : 'День'}
          title={isDay ? 'Ночь' : 'День'}
        >
          {isDay ? <MoonIcon /> : <SunIcon />}
        </button>
        <Link
          className="arcade-btn arcade-btn--ghost arcade-btn--icon"
          to="/"
          aria-label="Меню"
          title="Меню"
        >
          <HomeIcon />
        </Link>
      </div>

      <div className="hud-bl">
        {lives != null && (
          <div className="hud-lives">
            <span className="lives__label">ЖИЗНИ</span>
            {Array.from({ length: maxLives }, (_, i) => (
              <i key={i} className={`life${i < lives ? '' : ' life--spent'}`} />
            ))}
          </div>
        )}

        <div className={`hint${hintOpen ? ' is-open' : ' is-collapsed'}`}>
          <button
            className="hint__fab"
            type="button"
            onClick={() => setHintOpen(true)}
            aria-label="Показать управление"
            tabIndex={hintOpen ? -1 : 0}
          >
            ?
          </button>

          <div className="hint__panel" aria-hidden={!hintOpen}>
            <button
              className="hint__close"
              type="button"
              onClick={collapseHint}
              aria-label="Скрыть управление"
              tabIndex={hintOpen ? 0 : -1}
            >
              ×
            </button>
            <ul className="hint__list">
              {CONTROLS.map(([key, action]) => (
                <li key={key}>
                  <b>{key}</b>
                  <span>{action}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {banner && <div className="hud hud--banner">{banner}</div>}

      {mine && (
        <button
          className={`arcade-btn arcade-btn--coral ability${mineReady ? '' : ' is-cooling'}`}
          type="button"
          onClick={onMine}
        >
          {mine}
        </button>
      )}
    </div>
  )
}
