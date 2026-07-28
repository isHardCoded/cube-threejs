import { useEffect, useId, useRef, useState } from 'react'
import { resolveAvatarUrl } from '../auth/avatar.js'
import { useLocale } from '../i18n/LocaleContext.jsx'
import Spinner from './Spinner.jsx'

const ACCEPT = 'image/jpeg,image/png,image/webp'

export default function AvatarModal({ user, open, onClose, onUpload }) {
  const { t } = useLocale()
  const inputRef = useRef(null)
  const listId = useId()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [preview, setPreview] = useState(null)
  const [file, setFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) {
      setPickerOpen(false)
      setPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
      setFile(null)
      setError('')
      setSaving(false)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  function pickFile(f) {
    if (!f) return
    if (!ACCEPT.split(',').includes(f.type)) {
      setError(t('avatar.needType'))
      return
    }
    if (f.size > 2 * 1024 * 1024) {
      setError(t('avatar.tooBig'))
      return
    }
    setError('')
    setFile(f)
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return URL.createObjectURL(f)
    })
    setPickerOpen(false)
  }

  async function save() {
    if (!file) {
      setError(t('avatar.pickFirst'))
      return
    }
    setSaving(true)
    setError('')
    try {
      await onUpload(file)
      onClose()
    } catch (err) {
      setError(err.message || t('avatar.saveFail'))
    } finally {
      setSaving(false)
    }
  }

  const shown = preview || resolveAvatarUrl(user?.avatarUrl)
  const initial = [...(user?.username || '?')][0]?.toUpperCase() || '?'

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="avatar-modal-title">
      <button type="button" className="modal__backdrop" aria-label={t('avatar.close')} onClick={onClose} />
      <div className="modal__panel">
        <div className="modal__title" id="avatar-modal-title">{t('avatar.title')}</div>

        <div className="avatar avatar--xl avatar--preview">
          {shown ? (
            <img className="avatar__img" src={shown} alt="" draggable={false} />
          ) : (
            <span className="avatar__fallback" aria-hidden="true">{initial}</span>
          )}
        </div>

        <div className={`file-dd${pickerOpen ? ' file-dd--open' : ''}`}>
          <button
            type="button"
            className="file-dd__trigger"
            aria-haspopup="listbox"
            aria-expanded={pickerOpen}
            aria-controls={listId}
            onClick={() => setPickerOpen((v) => !v)}
          >
            <span>{file ? file.name : t('avatar.pick')}</span>
            <span className="file-dd__chev" aria-hidden="true" />
          </button>

          {pickerOpen && (
            <ul className="file-dd__menu" id={listId} role="listbox">
              <li role="option">
                <button
                  type="button"
                  className="file-dd__option"
                  onClick={() => inputRef.current?.click()}
                >
                  {t('avatar.fromGallery')}
                </button>
              </li>
              <li role="option">
                <label className="file-dd__drop">
                  <input
                    type="file"
                    accept={ACCEPT}
                    className="file-dd__native"
                    onChange={(e) => pickFile(e.target.files?.[0])}
                  />
                  {t('avatar.drop')}
                </label>
              </li>
            </ul>
          )}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="file-dd__native"
          onChange={(e) => pickFile(e.target.files?.[0])}
        />

        {error && <div className="screen__error">{error}</div>}

        <div className="modal__actions">
          <button className="btn" type="button" onClick={save} disabled={saving || !file}>
            {saving ? <Spinner /> : t('avatar.save')}
          </button>
          <button className="btn btn--ghost" type="button" onClick={onClose} disabled={saving}>
            {t('avatar.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
