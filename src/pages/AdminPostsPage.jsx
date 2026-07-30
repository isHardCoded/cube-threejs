import { useCallback, useEffect, useState } from 'react'
import Spinner from '../components/Spinner.jsx'
import { AdminHeader } from '../components/AdminShell.jsx'
import { AdminFileField } from '../components/AdminControls.jsx'
import { admin as adminApi } from '../api/client.js'

function fmtDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('ru-RU')
  } catch {
    return '—'
  }
}

export default function AdminPostsPage() {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [text, setText] = useState('')
  const [image, setImage] = useState(null)
  const [busy, setBusy] = useState(false)
  const [publishingId, setPublishingId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await adminApi.posts()
      setPosts(data.posts || [])
    } catch (err) {
      setError(err.message || 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function create(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await adminApi.createPost(text, image)
      setText('')
      setImage(null)
      await load()
    } catch (err) {
      setError(err.message || 'Не удалось создать')
    } finally {
      setBusy(false)
    }
  }

  async function publish(id) {
    setPublishingId(id)
    setError('')
    try {
      await adminApi.publishPost(id)
      await load()
    } catch (err) {
      setError(err.message || 'Не удалось опубликовать')
    } finally {
      setPublishingId(null)
    }
  }

  return (
    <>
      <AdminHeader title="Посты для бота" />

      <div className="admin__content">
        {error && <div className="admin-alert">{error}</div>}

        <form className="admin-panel" onSubmit={create}>
          <div className="admin-panel__title">Новый пост</div>
          <label className="admin-field">Текст
            <textarea
              className="admin-input admin-textarea"
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Текст поста…"
            />
          </label>
          <AdminFileField
            label="Картинка"
            file={image}
            onChange={setImage}
          />
          <div className="admin-panel__actions">
            <button className="admin-btn" type="submit" disabled={busy}>
              {busy ? '…' : 'Создать черновик'}
            </button>
          </div>
        </form>

        {loading ? <Spinner label="Загрузка…" /> : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Текст</th>
                  <th>Статус</th>
                  <th>Фото</th>
                  <th>OK / Fail</th>
                  <th>Дата</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {posts.map((p) => (
                  <tr key={p.id}>
                    <td className="admin-table__muted">{p.id}</td>
                    <td className="admin-table__clip">{p.text || '—'}</td>
                    <td>
                      <span className={`admin-pill${p.status === 'sent' ? ' admin-pill--ok' : ''}${p.status === 'failed' ? ' admin-pill--bad' : ''}`}>
                        {p.status === 'draft' ? 'черновик'
                          : p.status === 'sending' ? 'отправка'
                            : p.status === 'sent' ? 'отправлен'
                              : p.status === 'failed' ? 'ошибка'
                                : p.status}
                      </span>
                    </td>
                    <td>{p.hasImage ? 'да' : 'нет'}</td>
                    <td className="admin-table__muted">{p.sentOk} / {p.sentFail}</td>
                    <td className="admin-table__muted">{fmtDate(p.createdAt || p.sentAt)}</td>
                    <td>
                      {(p.status === 'draft' || p.status === 'failed') && (
                        <button
                          className="admin-btn admin-btn--sm"
                          type="button"
                          disabled={publishingId === p.id}
                          onClick={() => publish(p.id)}
                        >
                          {publishingId === p.id ? 'Отправка…' : 'Опубликовать'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {posts.length === 0 && (
                  <tr>
                    <td colSpan={7} className="admin-table__empty">Пока нет постов</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
