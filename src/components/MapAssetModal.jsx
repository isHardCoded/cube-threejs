import { useEffect, useMemo, useState } from 'react'
import MapAssetPreview from './MapAssetPreview.jsx'
import { mapAssetCatalog } from '../game/mapAssetCatalog.js'
import { sfx } from '../game/sfx.js'
import { useLocale } from '../i18n/LocaleContext.jsx'

export default function MapAssetModal({ open, onClose, mapId }) {
  const { t } = useLocale()
  const items = useMemo(() => (open ? mapAssetCatalog(mapId) : []), [open, mapId])
  const [activeId, setActiveId] = useState(null)

  useEffect(() => {
    if (!open) return
    setActiveId(items[0]?.id || null)
    function onKey(e) {
      if (e.key === 'Escape') {
        sfx.modalClose()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, items])

  if (!open) return null

  const active = items.find((it) => it.id === activeId) || items[0] || null
  const labelOf = (it) => {
    if (!it) return ''
    const translated = t(it.labelKey)
    return translated === it.labelKey ? it.fallback : translated
  }

  return (
    <div className="modal asset-modal" role="dialog" aria-modal="true" aria-labelledby="asset-modal-title">
      <button
        type="button"
        className="modal__backdrop"
        aria-label={t('assets.close')}
        onClick={() => { sfx.modalClose(); onClose() }}
      />
      <div className="modal__panel asset-modal__panel">
        <div className="modal__title" id="asset-modal-title">{t('assets.title')}</div>

        <div className="asset-modal__body">
          <aside className="asset-modal__list" aria-label={t('assets.list')}>
            {items.length === 0 && (
              <div className="asset-modal__empty">{t('assets.empty')}</div>
            )}
            {items.map((it) => (
              <button
                key={it.id}
                type="button"
                className={`asset-modal__item${active?.id === it.id ? ' is-active' : ''}`}
                onClick={() => setActiveId(it.id)}
              >
                {labelOf(it)}
              </button>
            ))}
          </aside>

          <section className="asset-modal__viewer">
            <div className="asset-modal__viewer-label">
              {active ? labelOf(active) : t('assets.empty')}
            </div>
            <MapAssetPreview
              build={active?.build || null}
              title={t('assets.orbitHint')}
            />
            <div className="asset-modal__hint">{t('assets.orbitHint')}</div>
          </section>
        </div>

        <div className="modal__actions">
          <button
            className="btn btn--ghost"
            type="button"
            onClick={() => { sfx.modalClose(); onClose() }}
          >
            {t('assets.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
