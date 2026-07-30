import { useEffect, useState } from 'react'
import { admin as adminApi } from '../api/client.js'
import { AdminCheckbox } from './AdminControls.jsx'
import Spinner from './Spinner.jsx'

export default function AdminUserSheet({ userId, onClose, onChanged }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [user, setUser] = useState(null)
  const [stats, setStats] = useState(null)
  const [form, setForm] = useState({
    username: '', cubes: 0, skinId: '', hatId: '', classId: '', isAdmin: false,
  })
  const [banReason, setBanReason] = useState('')

  useEffect(() => {
    if (!userId) {
      setOpen(false)
      setUser(null)
      return
    }
    setOpen(true)
    let alive = true
    ;(async () => {
      setLoading(true)
      setError('')
      try {
        const data = await adminApi.user(userId)
        if (!alive) return
        setUser(data.user)
        setStats(data.stats)
        setForm({
          username: data.user.username || '',
          cubes: data.user.cubes ?? 0,
          skinId: data.user.skinId || '',
          hatId: data.user.hatId || '',
          classId: data.user.classId || '',
          isAdmin: !!data.user.isAdmin,
        })
      } catch (err) {
        if (alive) setError(err.message || 'Ошибка')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [userId])

  useEffect(() => {
    if (!open) return
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!userId) return null

  async function save() {
    setSaving(true)
    setError('')
    try {
      const data = await adminApi.patchUser(userId, {
        username: form.username,
        cubes: Number(form.cubes),
        skinId: form.skinId,
        hatId: form.hatId,
        classId: form.classId,
        isAdmin: form.isAdmin,
      })
      setUser(data.user)
      onChanged?.()
    } catch (err) {
      setError(err.message || 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  async function ban() {
    setSaving(true)
    setError('')
    try {
      const data = await adminApi.banUser(userId, banReason)
      setUser(data.user)
      onChanged?.()
    } catch (err) {
      setError(err.message || 'Не удалось забанить')
    } finally {
      setSaving(false)
    }
  }

  async function unban() {
    setSaving(true)
    setError('')
    try {
      const data = await adminApi.unbanUser(userId)
      setUser(data.user)
      onChanged?.()
    } catch (err) {
      setError(err.message || 'Не удалось разбанить')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`sheet${open ? ' is-open' : ''}`} role="dialog" aria-modal="true">
      <button type="button" className="sheet__backdrop" aria-label="Закрыть" onClick={onClose} />
      <div className="sheet__panel">
        <div className="sheet__head">
          <div>
            <div className="sheet__title">{user?.username || 'Игрок'}</div>
            <div className="sheet__sub">#{userId}</div>
          </div>
          <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={onClose}>×</button>
        </div>

        {loading ? (
          <Spinner label="Загрузка…" />
        ) : (
          <>
            {error && <div className="admin-alert">{error}</div>}
            {user && (
              <div className="sheet__body">
                <div className="sheet__stat-grid">
                  <div><span>Победы</span><b>{stats?.wins ?? 0}</b></div>
                  <div><span>Киллы</span><b>{stats?.kills ?? 0}</b></div>
                  <div><span>Смерти</span><b>{stats?.deaths ?? 0}</b></div>
                  <div><span>Урон</span><b>{stats?.damage ?? 0}</b></div>
                  <div><span>Сессии</span><b>{stats?.sessions ?? 0}</b></div>
                  <div><span>TG</span><b>{user.viaTelegram ? 'да' : 'нет'}</b></div>
                </div>

                <div className="admin-grid">
                  <label className="admin-field">Ник
                    <input className="admin-input" value={form.username}
                      onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} />
                  </label>
                  <label className="admin-field">Кубсы
                    <input className="admin-input" type="number" value={form.cubes}
                      onChange={(e) => setForm((f) => ({ ...f, cubes: e.target.value }))} />
                  </label>
                  <label className="admin-field">Скин
                    <input className="admin-input" value={form.skinId}
                      onChange={(e) => setForm((f) => ({ ...f, skinId: e.target.value }))} />
                  </label>
                  <label className="admin-field">Шляпа
                    <input className="admin-input" value={form.hatId}
                      onChange={(e) => setForm((f) => ({ ...f, hatId: e.target.value }))} />
                  </label>
                  <label className="admin-field">Класс
                    <input className="admin-input" value={form.classId}
                      onChange={(e) => setForm((f) => ({ ...f, classId: e.target.value }))} />
                  </label>
                  <div className="admin-field">
                    <span className="admin-field__cap">Права</span>
                    <AdminCheckbox
                      checked={form.isAdmin}
                      onChange={(v) => setForm((f) => ({ ...f, isAdmin: v }))}
                      label="Админ"
                    />
                  </div>
                </div>

                <button className="admin-btn" type="button" disabled={saving} onClick={save}>
                  {saving ? '…' : 'Сохранить'}
                </button>

                <div className="sheet__ban">
                  {user.bannedAt ? (
                    <>
                      <div className="admin-alert">
                        Забанен с {new Date(user.bannedAt).toLocaleString('ru-RU')}
                        {user.banReason ? ` — ${user.banReason}` : ''}
                      </div>
                      <button className="admin-btn admin-btn--ghost" type="button" disabled={saving} onClick={unban}>
                        Разбанить
                      </button>
                    </>
                  ) : (
                    <>
                      <input
                        className="admin-input"
                        value={banReason}
                        onChange={(e) => setBanReason(e.target.value)}
                        placeholder="Причина бана"
                      />
                      <button className="admin-btn admin-btn--danger" type="button" disabled={saving} onClick={ban}>
                        Забанить
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
