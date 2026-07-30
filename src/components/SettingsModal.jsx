import { useEffect, useRef, useState } from 'react'
import LangSwitch from './LangSwitch.jsx'
import { isSoundEnabled, setSoundEnabled, sfx } from '../game/sfx.js'
import {
  getQualityPreference,
  setQualityPreference,
  QUALITY_IDS,
} from '../game/gfx/quality.js'
import { useLocale } from '../i18n/LocaleContext.jsx'

export default function SettingsModal({ open, onClose }) {
  const { t } = useLocale()
  const [soundOn, setSoundOn] = useState(() => isSoundEnabled())
  const [quality, setQuality] = useState(() => getQualityPreference())
  const [gfxOpen, setGfxOpen] = useState(false)
  const gfxRef = useRef(null)

  useEffect(() => {
    if (!open) return
    setSoundOn(isSoundEnabled())
    setQuality(getQualityPreference())
    setGfxOpen(false)
    function onKey(e) {
      if (e.key !== 'Escape') return
      if (gfxOpen) {
        setGfxOpen(false)
        return
      }
      sfx.modalClose()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, gfxOpen])

  useEffect(() => {
    if (!gfxOpen) return
    function onPointer(e) {
      if (!gfxRef.current?.contains(e.target)) setGfxOpen(false)
    }
    window.addEventListener('pointerdown', onPointer)
    return () => window.removeEventListener('pointerdown', onPointer)
  }, [gfxOpen])

  if (!open) return null

  function toggleSound() {
    const next = !soundOn
    setSoundOn(next)
    setSoundEnabled(next)
  }

  function pickQuality(id) {
    const next = setQualityPreference(id)
    setQuality(next)
    setGfxOpen(false)
    sfx.click()
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-modal-title">
      <button type="button" className="modal__backdrop" aria-label={t('settings.close')} onClick={onClose} />
      <div className="modal__panel">
        <div className="modal__title" id="settings-modal-title">{t('settings.title')}</div>

        <div className="settings-row">
          <span className="settings-row__label">{t('settings.language')}</span>
          <LangSwitch variant="inline" />
        </div>

        <div className="settings-row">
          <span className="settings-row__label">{t('settings.sound')}</span>
          <button
            type="button"
            className={`settings-toggle${soundOn ? ' is-on' : ''}`}
            onClick={toggleSound}
            aria-pressed={soundOn}
            aria-label={t('settings.sound')}
          >
            <span className="settings-toggle__knob" />
            <span className="settings-toggle__text">
              {soundOn ? t('settings.soundOn') : t('settings.soundOff')}
            </span>
          </button>
        </div>

        <div className="settings-row settings-row--stack">
          <span className="settings-row__label" id="settings-graphics-label">
            {t('settings.graphics')}
          </span>
          <div className={`gfx-menu${gfxOpen ? ' is-open' : ''}`} ref={gfxRef}>
            <button
              type="button"
              className="gfx-menu__trigger"
              aria-haspopup="listbox"
              aria-expanded={gfxOpen}
              aria-labelledby="settings-graphics-label"
              onClick={() => setGfxOpen((v) => !v)}
            >
              <span>{t(`settings.graphics.${quality}`)}</span>
              <span className="gfx-menu__chev" aria-hidden="true" />
            </button>
            {gfxOpen && (
              <ul className="gfx-menu__list" role="listbox" aria-labelledby="settings-graphics-label">
                {QUALITY_IDS.map((id) => (
                  <li key={id} role="option" aria-selected={quality === id}>
                    <button
                      type="button"
                      className={`gfx-menu__option${quality === id ? ' is-active' : ''}`}
                      onClick={() => pickQuality(id)}
                    >
                      <span className="gfx-menu__option-label">{t(`settings.graphics.${id}`)}</span>
                      {quality === id && <span className="gfx-menu__check" aria-hidden="true" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="settings-hint">{t('settings.graphicsHint')}</p>
        </div>

        <div className="modal__actions">
          <button className="btn btn--ghost" type="button" data-sfx="close" onClick={onClose}>
            {t('settings.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
