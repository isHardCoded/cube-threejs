import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Menu, Settings } from 'lucide-react'
import SettingsModal from '../components/SettingsModal.jsx'
import { createDiceTable } from '../game/diceTable/scene.js'
import { useLocale } from '../i18n/LocaleContext.jsx'
import '../styles/dice.css'

export default function DicePage() {
  const { t } = useLocale()
  const navigate = useNavigate()
  const canvasRef = useRef(null)
  const tableRef = useRef(null)
  const swipeRef = useRef({ x: 0, y: 0, active: false })

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [lastRoll, setLastRoll] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined

    let cancelled = false
    let table = null
    let ro = null
    let settleWatchdog = 0

    ;(async () => {
      table = await createDiceTable(canvas)
      if (cancelled) {
        table.dispose()
        return
      }
      tableRef.current = table
      table.onSettle((values) => {
        setLastRoll(values)
        setBusy(false)
      })

      settleWatchdog = window.setInterval(() => {
        const state = table.getState()
        if (state.mode === 'settled') setBusy(false)
      }, 1000)

      ro = new ResizeObserver((entries) => {
        const rect = entries[0]?.contentRect
        if (!rect || !table) return
        table.setSize(Math.max(1, Math.floor(rect.width)), Math.max(1, Math.floor(rect.height)))
      })
      ro.observe(canvas.parentElement || canvas)
    })().catch((err) => {
      console.warn('[dice] failed to create table', err)
    })

    return () => {
      cancelled = true
      window.clearInterval(settleWatchdog)
      ro?.disconnect()
      table?.dispose()
      tableRef.current = null
    }
  }, [])

  const onShake = () => {
    tableRef.current?.shake(1)
    setLastRoll(null)
  }

  const onThrow = () => {
    if (busy) return
    setBusy(true)
    setLastRoll(null)
    tableRef.current?.throwDice()
  }

  const onPointerDown = (e) => {
    swipeRef.current = { x: e.clientX, y: e.clientY, active: true }
  }

  const onPointerUp = (e) => {
    if (!swipeRef.current.active) return
    const dx = e.clientX - swipeRef.current.x
    const dy = e.clientY - swipeRef.current.y
    swipeRef.current.active = false
    const dist = Math.hypot(dx, dy)
    if (dist < 40) return
    if (Math.abs(dy) > Math.abs(dx) * 1.2 && dy > 30) onThrow()
    else onShake()
  }

  return (
    <div className="dice-pvp">
      <div
        className="dice-pvp__stage"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { swipeRef.current.active = false }}
      >
        <canvas ref={canvasRef} className="dice-pvp__canvas" />
      </div>

      <div className="dice-pvp__gui">
        <header className="dice-top dice-top--minimal">
          <div className="dice-top__left">
            <button
              type="button"
              className="dice-ico"
              onClick={() => navigate('/play/pvp')}
              aria-label={t('dice.back')}
              title={t('dice.back')}
            >
              <Menu size={20} strokeWidth={2.6} aria-hidden="true" />
            </button>
          </div>
          <div className="dice-top__right">
            <button
              type="button"
              className="dice-ico"
              onClick={() => setSettingsOpen(true)}
              aria-label={t('menu.settings')}
              title={t('menu.settings')}
            >
              <Settings size={18} strokeWidth={2.4} aria-hidden="true" />
            </button>
          </div>
        </header>

        {lastRoll && (
          <div className="dice-result" role="status">
            {lastRoll.map((v, i) => (
              <span key={`${i}-${v}`}>{v}</span>
            ))}
          </div>
        )}

        <footer className="dice-bot dice-bot--actions-only">
          <div className="dice-actions" aria-label={t('dice.actions')}>
            <button type="button" className="dice-act dice-act--shake" onClick={onShake}>
              SPIN
            </button>
            <button
              type="button"
              className="dice-act dice-act--throw"
              onClick={onThrow}
              disabled={busy}
            >
              THROW
            </button>
            <p className="dice-actions__tip">{t('dice.tip')}</p>
          </div>
        </footer>
      </div>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
