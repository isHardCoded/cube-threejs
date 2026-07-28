import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import DiePreview from '../components/DiePreview.jsx'
import Spinner from '../components/Spinner.jsx'
import { profile } from '../api/client.js'
import { useAuth } from '../auth/context.js'
import { DEFAULT_SKIN } from '../game/dice.js'

export default function CharacterPage() {
  const { user, ownedSkins, patchUser } = useAuth()
  const [catalog, setCatalog] = useState([])
  const [picked, setPicked] = useState(user?.skinId || DEFAULT_SKIN.id)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    profile.skins()
      .then((res) => setCatalog(res.skins || []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const skin = catalog.find((s) => s.id === picked) || DEFAULT_SKIN
  const equipped = user?.skinId
  const owns = (id) => ownedSkins.includes(id)

  async function equip() {
    setSaving(true)
    setError('')
    try {
      const res = await profile.setSkin(picked)
      patchUser({ skinId: res.user.skinId })
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="screen">
      <div className="screen__title">Персонаж</div>

      <div className="screen__box">
        <div className="screen__card">
          <DiePreview skin={skin} />
          <div className="label">{skin.name || 'Скин'}</div>

          {loading ? (
            <Spinner />
          ) : (
            <div className="skins">
              {catalog.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`skin${s.id === picked ? ' skin--picked' : ''}`}
                  onClick={() => setPicked(s.id)}
                  disabled={!owns(s.id)}
                >
                  <div
                    className="skin__swatch"
                    style={{ color: s.pip, background: s.body }}
                  />
                  {s.name}
                  {s.id === equipped && <div className="skin__tag">надет</div>}
                </button>
              ))}
            </div>
          )}

          {error && <div className="screen__error">{error}</div>}

          <button
            className="btn"
            type="button"
            onClick={equip}
            disabled={saving || loading || picked === equipped || !owns(picked)}
          >
            {saving ? <Spinner /> : picked === equipped ? 'Уже надет' : 'Надеть'}
          </button>
        </div>

        <Link className="btn btn--ghost" to="/">Назад</Link>
      </div>
    </div>
  )
}
