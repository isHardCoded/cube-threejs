import { useCallback, useEffect, useState } from 'react'
import Spinner from '../components/Spinner.jsx'
import { AdminHeader } from '../components/AdminShell.jsx'
import { AdminCheckbox, AdminSelect } from '../components/AdminControls.jsx'
import { admin as adminApi } from '../api/client.js'

const emptyForm = {
  id: '', period: 'daily', metric: 'play', target: 1, reward: 1,
  titleRu: '', titleEn: '', enabled: true, sortOrder: 0,
}

export default function AdminQuestsPage() {
  const [quests, setQuests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [editing, setEditing] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await adminApi.quests()
      setQuests(data.quests || [])
    } catch (err) {
      setError(err.message || 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function startEdit(q) {
    setEditing(q.id)
    setForm({
      id: q.id,
      period: q.period,
      metric: q.metric,
      target: q.target,
      reward: q.reward,
      titleRu: q.titleRu || '',
      titleEn: q.titleEn || '',
      enabled: !!q.enabled,
      sortOrder: q.sortOrder ?? 0,
    })
  }

  function startCreate() {
    setEditing(null)
    setForm(emptyForm)
  }

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const body = {
        id: form.id.trim(),
        period: form.period,
        metric: form.metric,
        target: Number(form.target),
        reward: Number(form.reward),
        titleRu: form.titleRu,
        titleEn: form.titleEn,
        enabled: !!form.enabled,
        sortOrder: Number(form.sortOrder) || 0,
      }
      if (editing) await adminApi.patchQuest(editing, body)
      else await adminApi.createQuest(body)
      setForm(emptyForm)
      setEditing(null)
      await load()
    } catch (err) {
      setError(err.message || 'Не удалось сохранить')
    } finally {
      setBusy(false)
    }
  }

  async function remove(id) {
    if (!window.confirm('Удалить квест?')) return
    setBusy(true)
    try {
      await adminApi.deleteQuest(id)
      if (editing === id) startCreate()
      await load()
    } catch (err) {
      setError(err.message || 'Не удалось удалить')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <AdminHeader
        title="Квесты"
        actions={(
          <button className="admin-btn admin-btn--ghost" type="button" onClick={startCreate}>
            Новый квест
          </button>
        )}
      />

      <div className="admin__content">
        {error && <div className="admin-alert">{error}</div>}

        {loading ? <Spinner label="Загрузка…" /> : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Название</th>
                  <th>Период</th>
                  <th>Метрика</th>
                  <th>Цель</th>
                  <th>Награда</th>
                  <th>Статус</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {quests.map((q) => (
                  <tr
                    key={q.id}
                    className={editing === q.id ? 'is-selected' : ''}
                    onClick={() => startEdit(q)}
                  >
                    <td className="admin-table__muted">{q.id}</td>
                    <td className="admin-table__strong">{q.titleRu || q.id}</td>
                    <td>{q.period === 'weekly' ? 'неделя' : 'день'}</td>
                    <td>{q.metric}</td>
                    <td>{q.target}</td>
                    <td>{q.reward}</td>
                    <td>
                      {q.enabled
                        ? <span className="admin-pill admin-pill--ok">вкл</span>
                        : <span className="admin-pill">выкл</span>}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="admin-btn admin-btn--ghost admin-btn--sm"
                        onClick={(e) => { e.stopPropagation(); remove(q.id) }}
                      >
                        Удалить
                      </button>
                    </td>
                  </tr>
                ))}
                {quests.length === 0 && (
                  <tr>
                    <td colSpan={8} className="admin-table__empty">Ничего не найдено</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <form className="admin-panel" onSubmit={submit}>
          <div className="admin-panel__title">
            {editing ? 'Редактирование квеста' : 'Новый квест'}
          </div>
          <div className="admin-grid">
            {!editing && (
              <label className="admin-field">ID
                <input className="admin-input" required value={form.id}
                  onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))} />
              </label>
            )}
            <label className="admin-field">Название (RU)
              <input className="admin-input" value={form.titleRu}
                onChange={(e) => setForm((f) => ({ ...f, titleRu: e.target.value }))} />
            </label>
            <label className="admin-field">Название (EN)
              <input className="admin-input" value={form.titleEn}
                onChange={(e) => setForm((f) => ({ ...f, titleEn: e.target.value }))} />
            </label>
            <AdminSelect
              label="Период"
              value={form.period}
              onChange={(v) => setForm((f) => ({ ...f, period: v }))}
              options={[
                { value: 'daily', label: 'Ежедневный' },
                { value: 'weekly', label: 'Еженедельный' },
              ]}
            />
            <AdminSelect
              label="Метрика"
              value={form.metric}
              onChange={(v) => setForm((f) => ({ ...f, metric: v }))}
              options={[
                { value: 'play', label: 'Матчи' },
                { value: 'kills', label: 'Киллы' },
                { value: 'win', label: 'Победы' },
              ]}
            />
            <label className="admin-field">Цель
              <input className="admin-input" type="number" min={1} value={form.target}
                onChange={(e) => setForm((f) => ({ ...f, target: e.target.value }))} />
            </label>
            <label className="admin-field">Награда
              <input className="admin-input" type="number" min={0} value={form.reward}
                onChange={(e) => setForm((f) => ({ ...f, reward: e.target.value }))} />
            </label>
            <label className="admin-field">Порядок
              <input className="admin-input" type="number" value={form.sortOrder}
                onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))} />
            </label>
            <div className="admin-field">
              <span className="admin-field__cap">Статус</span>
              <AdminCheckbox
                checked={form.enabled}
                onChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
                label="Включён"
              />
            </div>
          </div>
          <div className="admin-panel__actions">
            <button className="admin-btn" type="submit" disabled={busy}>
              {busy ? '…' : 'Сохранить'}
            </button>
            {editing && (
              <button className="admin-btn admin-btn--ghost" type="button" onClick={startCreate}>
                Создать новый
              </button>
            )}
          </div>
        </form>
      </div>
    </>
  )
}
