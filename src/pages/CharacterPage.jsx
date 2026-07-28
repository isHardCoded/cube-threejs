import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import DiePreview from '../components/DiePreview.jsx'
import MinePreview from '../components/MinePreview.jsx'
import Spinner from '../components/Spinner.jsx'
import { profile } from '../api/client.js'
import { useAuth } from '../auth/context.js'
import { DEFAULT_SKIN } from '../game/dice.js'
import { DEFAULT_MINE_SKIN } from '../game/mineModels.js'
import { useLocale } from '../i18n/LocaleContext.jsx'

/** Soft resistance past the edge — feels like a trampoline, not a wall. */
function rubber(over, size) {
  const dim = Math.max(size, 1)
  const sign = Math.sign(over)
  const x = Math.abs(over)
  return sign * (1 - 1 / ((x * 0.28) / dim + 1)) * dim * 1.15
}

const DEFAULT_MINE = { id: DEFAULT_MINE_SKIN, name: 'Классика', swatch: '#4a3a3a', emoji: '💣' }

export default function CharacterPage() {
  const { user, ownedSkins, ownedMineSkins, patchUser } = useAuth()
  const { t, translateError } = useLocale()
  const [tab, setTab] = useState('cube') // cube | mine

  const [catalog, setCatalog] = useState([])
  const [mineCatalog, setMineCatalog] = useState([])
  const [picked, setPicked] = useState(user?.skinId || DEFAULT_SKIN.id)
  const [pickedMine, setPickedMine] = useState(user?.mineSkinId || DEFAULT_MINE.id)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const stripRef = useRef(null)
  const trackRef = useRef(null)
  const drag = useRef(null)
  const pull = useRef(0)
  const springRaf = useRef(0)

  useEffect(() => {
    Promise.all([profile.skins(), profile.mineSkins()])
      .then(([dice, mines]) => {
        setCatalog(dice.skins || [])
        setMineCatalog(mines.skins || [])
      })
      .catch((err) => setError(translateError(err.message)))
      .finally(() => setLoading(false))
  }, [translateError])

  useEffect(() => {
    const el = stripRef.current
    const track = trackRef.current
    if (!el || !track) return

    function applyPull(px) {
      pull.current = px
      track.style.transform = px ? `translateX(${px}px)` : ''
    }

    function maxScroll() {
      return Math.max(0, el.scrollWidth - el.clientWidth)
    }

    function stopSpring() {
      cancelAnimationFrame(springRaf.current)
      springRaf.current = 0
    }

    function springHome() {
      stopSpring()
      let v = 0
      const tick = () => {
        const stiff = 0.08
        const damp = 0.82
        v = (v + (0 - pull.current) * stiff) * damp
        const next = pull.current + v
        if (Math.abs(next) < 0.25 && Math.abs(v) < 0.25) {
          applyPull(0)
          springRaf.current = 0
          return
        }
        applyPull(next)
        springRaf.current = requestAnimationFrame(tick)
      }
      springRaf.current = requestAnimationFrame(tick)
    }

    function onPointerDown(e) {
      stopSpring()
      drag.current = {
        id: e.pointerId,
        x: e.clientX,
        scroll: el.scrollLeft,
        pull: pull.current,
        moved: false,
      }
    }

    function onPointerMove(e) {
      const d = drag.current
      if (!d || d.id !== e.pointerId) return
      const dx = e.clientX - d.x
      if (!d.moved) {
        if (Math.abs(dx) < 8) return
        d.moved = true
        el.classList.add('is-dragging')
        try { el.setPointerCapture(e.pointerId) } catch { /* ignore */ }
      }

      const max = maxScroll()
      const raw = d.scroll - dx - d.pull
      if (raw < 0) {
        el.scrollLeft = 0
        applyPull(rubber(-raw, el.clientWidth))
      } else if (raw > max) {
        el.scrollLeft = max
        applyPull(-rubber(raw - max, el.clientWidth))
      } else {
        applyPull(0)
        el.scrollLeft = raw
      }
    }

    function endDrag(e) {
      const d = drag.current
      if (!d || d.id !== e.pointerId) return
      el.classList.remove('is-dragging')
      try { el.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
      drag.current = d.moved ? { suppressClick: true } : null
      if (pull.current !== 0) springHome()
    }

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', endDrag)
    el.addEventListener('pointercancel', endDrag)
    return () => {
      stopSpring()
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', endDrag)
      el.removeEventListener('pointercancel', endDrag)
    }
  }, [loading, catalog.length, mineCatalog.length, tab])

  function pick(id) {
    if (drag.current?.suppressClick) {
      drag.current = null
      return
    }
    if (tab === 'cube') setPicked(id)
    else setPickedMine(id)
  }

  const skin = catalog.find((s) => s.id === picked) || DEFAULT_SKIN
  const mineSkin = mineCatalog.find((s) => s.id === pickedMine) || DEFAULT_MINE
  const equipped = tab === 'cube' ? user?.skinId : user?.mineSkinId
  const activeId = tab === 'cube' ? picked : pickedMine
  const owns = (id) => (tab === 'cube' ? ownedSkins : ownedMineSkins).includes(id)

  const skinName = (s, kind) => {
    const key = kind === 'mine' ? `mineSkins.${s.id}` : `skins.${s.id}`
    const label = t(key)
    return label === key ? (s.name || t('looks.skin')) : label
  }

  async function equip() {
    setSaving(true)
    setError('')
    try {
      if (tab === 'cube') {
        const res = await profile.setSkin(picked)
        patchUser({ skinId: res.user.skinId, mineSkinId: res.user.mineSkinId })
      } else {
        const res = await profile.setMineSkin(pickedMine)
        patchUser({ skinId: res.user.skinId, mineSkinId: res.user.mineSkinId })
      }
    } catch (err) {
      setError(translateError(err.message))
    } finally {
      setSaving(false)
    }
  }

  const list = tab === 'cube' ? catalog : mineCatalog

  return (
    <div className="screen">
      <div className="screen__box">
        <div className="screen__card">
          <div className="tabs">
            <button
              type="button"
              className={`tab${tab === 'cube' ? ' is-active' : ''}`}
              onClick={() => setTab('cube')}
            >
              {t('looks.tabCube')}
            </button>
            <button
              type="button"
              className={`tab${tab === 'mine' ? ' is-active' : ''}`}
              onClick={() => setTab('mine')}
            >
              {t('looks.tabMine')}
            </button>
          </div>

          {tab === 'cube' ? (
            <>
              <DiePreview skin={skin} />
              <div className="label">{skinName(skin, 'cube')}</div>
            </>
          ) : (
            <>
              <MinePreview skinId={mineSkin.id} />
              <div className="label">{skinName(mineSkin, 'mine')}</div>
            </>
          )}

          {loading ? (
            <Spinner />
          ) : (
            <div className="skins" ref={stripRef}>
              <div className="skins__track" role="list" ref={trackRef}>
                {list.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="listitem"
                    className={`skin${s.id === activeId ? ' skin--picked' : ''}`}
                    onClick={() => pick(s.id)}
                    disabled={!owns(s.id)}
                  >
                    {tab === 'cube' ? (
                      <div
                        className="skin__swatch"
                        style={{ color: s.pip, background: s.body }}
                      />
                    ) : (
                      <div
                        className="skin__swatch skin__swatch--emoji"
                        style={{ background: s.swatch }}
                      >
                        {s.emoji}
                      </div>
                    )}
                    {skinName(s, tab)}
                    {s.id === equipped && <div className="skin__tag">{t('looks.equipped')}</div>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && <div className="screen__error">{error}</div>}

          <button
            className="btn"
            type="button"
            onClick={equip}
            disabled={saving || loading || activeId === equipped || !owns(activeId)}
          >
            {saving ? <Spinner /> : activeId === equipped ? t('looks.already') : t('looks.equip')}
          </button>
        </div>

        <Link className="btn btn--ghost" to="/">{t('looks.back')}</Link>
      </div>
    </div>
  )
}
