import { useEffect, useState } from 'react'
import LangSwitch from './LangSwitch.jsx'
import { isSoundEnabled, setSoundEnabled, sfx } from '../game/sfx.js'
import { useLocale } from '../i18n/LocaleContext.jsx'

export default function SettingsModal({ open, onClose }) {
  const { t } = useLocale()
  const [soundOn, setSoundOn] = useState(() => isSoundEnabled())

  useEffect(() => {
    if (!open) return
    setSoundOn(isSoundEnabled())
    function onKey(e) {
      if (e.key === 'Escape') {
        sfx.modalClose()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  function toggleSound() {
    const next = !soundOn
    setSoundOn(next)
    setSoundEnabled(next)
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

        <div className="modal__actions">
          <button className="btn btn--ghost" type="button" data-sfx="close" onClick={onClose}>
            {t('settings.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
