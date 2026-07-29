import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Ban, Check, Search, UserMinus, UserPlus, X,
} from 'lucide-react'
import Avatar from '../components/Avatar.jsx'
import Spinner from '../components/Spinner.jsx'
import { friends as friendsApi } from '../api/client.js'
import { useLocale } from '../i18n/LocaleContext.jsx'

function FriendRow({ user, onOpen, actions }) {
  return (
    <div className="friend-row">
      <button type="button" className="friend-row__main" onClick={() => onOpen(user)}>
        <Avatar user={user} size="sm" />
        <span className="friend-row__name">{user.username}</span>
        <span className="friend-row__cubes">{user.cubes}</span>
      </button>
      {actions && <div className="friend-row__actions">{actions}</div>}
    </div>
  )
}

function PanelEmpty({ children }) {
  return <div className="friends-empty">{children}</div>
}

export default function FriendsPage() {
  const { t, translateError } = useLocale()
  const navigate = useNavigate()
  const [tab, setTab] = useState('friends') // friends | requests | blocked
  const [friends, setFriends] = useState([])
  const [incoming, setIncoming] = useState([])
  const [outgoing, setOutgoing] = useState([])
  const [blocked, setBlocked] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)

  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState(null)

  const load = useCallback(async () => {
    setError('')
    try {
      const [list, blockedRes] = await Promise.all([
        friendsApi.list(),
        friendsApi.blocked(),
      ])
      setFriends(list.friends || [])
      setIncoming(list.incoming || [])
      setOutgoing(list.outgoing || [])
      setBlocked(blockedRes.users || [])
    } catch (err) {
      setError(translateError(err.message))
    } finally {
      setLoading(false)
    }
  }, [translateError])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults(null)
      setSearching(false)
      return
    }
    let alive = true
    setSearching(true)
    const tmr = setTimeout(async () => {
      try {
        const res = await friendsApi.search(q)
        if (alive) setResults(res.users || [])
      } catch (err) {
        if (alive) setError(translateError(err.message))
      } finally {
        if (alive) setSearching(false)
      }
    }, 280)
    return () => {
      alive = false
      clearTimeout(tmr)
    }
  }, [query, translateError])

  async function act(id, fn) {
    setBusyId(id)
    setError('')
    try {
      await fn()
      await load()
      if (query.trim().length >= 2) {
        const res = await friendsApi.search(query.trim())
        setResults(res.users || [])
      }
    } catch (err) {
      setError(translateError(err.message))
    } finally {
      setBusyId(null)
    }
  }

  function openProfile(user) {
    navigate(`/u/${user.id}`)
  }

  const searchingMode = query.trim().length >= 2
  const pendingCount = incoming.length

  return (
    <div className="screen">
      <div className="screen__title">{t('friends.title')}</div>

      <div className="screen__box screen__box--wide friends-page">
        {error && <div className="screen__error">{error}</div>}

        <div className="screen__card friends-shell">
          <div className="friends-shell__top">
            <label className="friends-search__label" htmlFor="friend-q">
              <Search className="icon" size={18} strokeWidth={2.4} aria-hidden="true" />
              <span>{t('friends.search')}</span>
            </label>
            <input
              id="friend-q"
              className="input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('friends.searchPlaceholder')}
              autoComplete="off"
              spellCheck={false}
            />

            {searchingMode ? (
              <div className="friends-tabs friends-tabs--search" aria-live="polite">
                <div className="friends-tab is-active">{t('friends.search')}</div>
              </div>
            ) : (
              <div className="friends-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  className={`friends-tab${tab === 'friends' ? ' is-active' : ''}`}
                  aria-selected={tab === 'friends'}
                  onClick={() => setTab('friends')}
                >
                  {t('friends.tabFriends')}
                  <span className="friends-tab__count">{friends.length}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  className={`friends-tab${tab === 'requests' ? ' is-active' : ''}`}
                  aria-selected={tab === 'requests'}
                  onClick={() => setTab('requests')}
                >
                  {t('friends.tabRequests')}
                  {pendingCount > 0
                    ? <span className="friends-tab__badge">{pendingCount}</span>
                    : <span className="friends-tab__count">{incoming.length + outgoing.length}</span>}
                </button>
                <button
                  type="button"
                  role="tab"
                  className={`friends-tab${tab === 'blocked' ? ' is-active' : ''}`}
                  aria-selected={tab === 'blocked'}
                  onClick={() => setTab('blocked')}
                >
                  {t('friends.tabBlocked')}
                  <span className="friends-tab__count">{blocked.length}</span>
                </button>
              </div>
            )}
          </div>

          {/* Fixed-height stage: panels share one grid cell so the Back button never jumps. */}
          <div className="friends-stage" aria-busy={loading || searching}>
            {loading || searching ? (
              <div className="friends-stage__status">
                <Spinner label={t('common.loading')} />
              </div>
            ) : null}

            {searchingMode && results && (
              <div className="friends-panel is-active">
                {results.length === 0 ? (
                  <PanelEmpty>{t('friends.searchEmpty')}</PanelEmpty>
                ) : results.map((u) => (
                  <FriendRow
                    key={u.id}
                    user={u}
                    onOpen={openProfile}
                    actions={(
                      <>
                        {u.relation === 'none' && (
                          <button
                            type="button"
                            className="btn btn--tiny"
                            disabled={busyId === u.id}
                            onClick={() => act(u.id, () => friendsApi.request(u.id))}
                            title={t('friends.add')}
                            aria-label={t('friends.add')}
                          >
                            <UserPlus size={16} strokeWidth={2.4} aria-hidden="true" />
                          </button>
                        )}
                        {u.relation === 'incoming' && (
                          <>
                            <button
                              type="button"
                              className="btn btn--tiny"
                              disabled={busyId === u.id}
                              onClick={() => act(u.id, () => friendsApi.accept(u.id))}
                              title={t('friends.accept')}
                            >
                              <Check size={16} strokeWidth={2.4} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              className="btn btn--tiny btn--ghost"
                              disabled={busyId === u.id}
                              onClick={() => act(u.id, () => friendsApi.decline(u.id))}
                              title={t('friends.decline')}
                            >
                              <X size={16} strokeWidth={2.4} aria-hidden="true" />
                            </button>
                          </>
                        )}
                        {u.relation === 'outgoing' && (
                          <button
                            type="button"
                            className="btn btn--tiny btn--ghost"
                            disabled={busyId === u.id}
                            onClick={() => act(u.id, () => friendsApi.cancel(u.id))}
                          >
                            {t('friends.cancel')}
                          </button>
                        )}
                        {u.relation === 'friends' && (
                          <span className="friend-tag">{t('friends.statusFriends')}</span>
                        )}
                      </>
                    )}
                  />
                ))}
              </div>
            )}

            {!searchingMode && !loading && (
              <>
                <div
                  className={`friends-panel${tab === 'friends' ? ' is-active' : ''}`}
                  role="tabpanel"
                  hidden={tab !== 'friends'}
                >
                  {friends.length === 0 ? (
                    <PanelEmpty>{t('friends.emptyFriends')}</PanelEmpty>
                  ) : friends.map((u) => (
                    <FriendRow
                      key={u.id}
                      user={u}
                      onOpen={openProfile}
                      actions={(
                        <>
                          <button
                            type="button"
                            className="btn btn--tiny btn--ghost"
                            disabled={busyId === u.id}
                            onClick={() => act(u.id, () => friendsApi.remove(u.id))}
                            title={t('friends.remove')}
                          >
                            <UserMinus size={16} strokeWidth={2.4} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="btn btn--tiny btn--ghost"
                            disabled={busyId === u.id}
                            onClick={() => act(u.id, () => friendsApi.block(u.id))}
                            title={t('friends.block')}
                          >
                            <Ban size={16} strokeWidth={2.4} aria-hidden="true" />
                          </button>
                        </>
                      )}
                    />
                  ))}
                </div>

                <div
                  className={`friends-panel${tab === 'requests' ? ' is-active' : ''}`}
                  role="tabpanel"
                  hidden={tab !== 'requests'}
                >
                  <div className="friends-subtitle">{t('friends.incoming')}</div>
                  {incoming.length === 0 ? (
                    <PanelEmpty>{t('friends.emptyIncoming')}</PanelEmpty>
                  ) : incoming.map((u) => (
                    <FriendRow
                      key={u.id}
                      user={u}
                      onOpen={openProfile}
                      actions={(
                        <>
                          <button
                            type="button"
                            className="btn btn--tiny"
                            disabled={busyId === u.id}
                            onClick={() => act(u.id, () => friendsApi.accept(u.id))}
                            title={t('friends.accept')}
                          >
                            <Check size={16} strokeWidth={2.4} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="btn btn--tiny btn--ghost"
                            disabled={busyId === u.id}
                            onClick={() => act(u.id, () => friendsApi.decline(u.id))}
                            title={t('friends.decline')}
                          >
                            <X size={16} strokeWidth={2.4} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="btn btn--tiny btn--ghost"
                            disabled={busyId === u.id}
                            onClick={() => act(u.id, () => friendsApi.block(u.id))}
                            title={t('friends.block')}
                          >
                            <Ban size={16} strokeWidth={2.4} aria-hidden="true" />
                          </button>
                        </>
                      )}
                    />
                  ))}

                  <div className="friends-subtitle">{t('friends.outgoing')}</div>
                  {outgoing.length === 0 ? (
                    <PanelEmpty>{t('friends.emptyOutgoing')}</PanelEmpty>
                  ) : outgoing.map((u) => (
                    <FriendRow
                      key={u.id}
                      user={u}
                      onOpen={openProfile}
                      actions={(
                        <button
                          type="button"
                          className="btn btn--tiny btn--ghost"
                          disabled={busyId === u.id}
                          onClick={() => act(u.id, () => friendsApi.cancel(u.id))}
                        >
                          {t('friends.cancel')}
                        </button>
                      )}
                    />
                  ))}
                </div>

                <div
                  className={`friends-panel${tab === 'blocked' ? ' is-active' : ''}`}
                  role="tabpanel"
                  hidden={tab !== 'blocked'}
                >
                  {blocked.length === 0 ? (
                    <PanelEmpty>{t('friends.emptyBlocked')}</PanelEmpty>
                  ) : blocked.map((u) => (
                    <FriendRow
                      key={u.id}
                      user={u}
                      onOpen={openProfile}
                      actions={(
                        <button
                          type="button"
                          className="btn btn--tiny btn--ghost"
                          disabled={busyId === u.id}
                          onClick={() => act(u.id, () => friendsApi.unblock(u.id))}
                        >
                          {t('friends.unblock')}
                        </button>
                      )}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <Link className="btn btn--ghost btn--with-icon" to="/">
          <ArrowLeft className="icon" size={22} strokeWidth={2.4} aria-hidden="true" />
          <span>{t('friends.back')}</span>
        </Link>
      </div>
    </div>
  )
}
