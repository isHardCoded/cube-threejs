import { useCallback, useEffect, useState } from 'react'
import Spinner from '../components/Spinner.jsx'
import { AdminHeader } from '../components/AdminShell.jsx'
import AdminUserSheet from '../components/AdminUserSheet.jsx'
import { admin as adminApi } from '../api/client.js'

function fmtDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('ru-RU')
  } catch {
    return '—'
  }
}

export default function AdminPage() {
  const [q, setQ] = useState('')
  const [users, setUsers] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState(null)

  const load = useCallback(async (query = q) => {
    setLoading(true)
    setError('')
    try {
      const data = await adminApi.users(query, 100, 0)
      setUsers(data.users || [])
      setTotal(data.total || 0)
    } catch (err) {
      setError(err.message || 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [q])

  useEffect(() => {
    load('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function onSearch(e) {
    e.preventDefault()
    load(q)
  }

  return (
    <>
      <AdminHeader
        title="Игроки"
        actions={(
          <form className="admin-toolbar" onSubmit={onSearch}>
            <input
              className="admin-input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск по нику"
              aria-label="Поиск по нику"
            />
            <button className="admin-btn" type="submit">Найти</button>
          </form>
        )}
      />

      <div className="admin__content">
        {error && <div className="admin-alert">{error}</div>}
        <div className="admin-meta">Игроков: {total}</div>

        {loading ? (
          <Spinner label="Загрузка…" />
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Ник</th>
                  <th>Кубсы</th>
                  <th>Роль</th>
                  <th>TG</th>
                  <th>Статус</th>
                  <th>Создан</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr
                    key={u.id}
                    className={u.bannedAt ? 'is-banned' : ''}
                    onClick={() => setSelectedId(u.id)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setSelectedId(u.id)
                      }
                    }}
                  >
                    <td className="admin-table__muted">{u.id}</td>
                    <td className="admin-table__strong">{u.username}</td>
                    <td>{u.cubes}</td>
                    <td>{u.isAdmin ? 'админ' : 'игрок'}</td>
                    <td>{u.viaTelegram ? 'да' : 'нет'}</td>
                    <td>
                      {u.bannedAt
                        ? <span className="admin-pill admin-pill--bad">бан</span>
                        : <span className="admin-pill admin-pill--ok">активен</span>}
                    </td>
                    <td className="admin-table__muted">{fmtDate(u.createdAt)}</td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={7} className="admin-table__empty">Ничего не найдено</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AdminUserSheet
        userId={selectedId}
        onClose={() => setSelectedId(null)}
        onChanged={() => load(q)}
      />
    </>
  )
}
