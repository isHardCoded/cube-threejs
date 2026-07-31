import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Ban, Check, UserMinus, UserPlus, X } from 'lucide-react'
import Avatar from '../components/Avatar.jsx'
import CubesMark from '../components/CubesMark.jsx'
import Spinner from '../components/Spinner.jsx'
import { friends as friendsApi } from '../api/client.js'
import { useAuth } from '../auth/context.js'
import { formatRegisteredAt } from '../auth/avatar.js'
import { useLocale } from '../i18n/LocaleContext.jsx'

export default function UserProfilePage() {
  const { id } = useParams()
  const { user: me } = useAuth()
  const { t, locale, translateError } = useLocale()
  const navigate = useNavigate()
  const [card, setCard] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const userId = Number(id)

  const load = useCallback(async () => {
    if (!Number.isFinite(userId) || userId <= 0) {
      setError(t('err.badRequest'))
      setLoading(false)
      return
    }
    setError('')
    try {
      const res = await friendsApi.user(userId)
      setCard(res.user)
    } catch (err) {
      setError(translateError(err.message))
      setCard(null)
    } finally {
      setLoading(false)
    }
  }, [userId, t, translateError])

  useEffect(() => { load() }, [load])

  if (me && String(me.id) === String(id)) {
    return <Navigate to="/profile" replace />
  }

  async function act(fn) {
    setBusy(true)
    setError('')
    try {
      await fn()
      await load()
    } catch (err) {
      setError(translateError(err.message))
    } finally {
      setBusy(false)
    }
  }

  const rel = card?.relation

  return (
    <div className="screen">
      <div className="screen__title">{t('friends.profileTitle')}</div>

      <div className="screen__box">
        {error && <div className="screen__error">{error}</div>}
        {loading && <Spinner label={t('common.loading')} />}

        {card && (
          <div className="screen__card profile-card">
            <Avatar user={card} size="lg" />
            <div className="profile-card__name">{card.username}</div>
            <div className="profile-card__meta profile-card__meta--cubes">
              <CubesMark size={24} />
              <span>{card.cubes}</span>
            </div>
            {card.createdAt && (
              <div className="profile-card__meta">
                <span className="profile-card__label">{t('profile.registered')}</span>
                <span>{formatRegisteredAt(card.createdAt, locale)}</span>
              </div>
            )}

            <div className="friend-profile-actions">
              {rel === 'none' && (
                <button
                  type="button"
                  className="btn btn--with-icon"
                  disabled={busy}
                  onClick={() => act(() => friendsApi.request(card.id))}
                >
                  <UserPlus className="icon" size={20} strokeWidth={2.4} aria-hidden="true" />
                  <span>{t('friends.add')}</span>
                </button>
              )}
              {rel === 'incoming' && (
                <>
                  <button
                    type="button"
                    className="btn btn--with-icon"
                    disabled={busy}
                    onClick={() => act(() => friendsApi.accept(card.id))}
                  >
                    <Check className="icon" size={20} strokeWidth={2.4} aria-hidden="true" />
                    <span>{t('friends.accept')}</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--with-icon"
                    disabled={busy}
                    onClick={() => act(() => friendsApi.decline(card.id))}
                  >
                    <X className="icon" size={20} strokeWidth={2.4} aria-hidden="true" />
                    <span>{t('friends.decline')}</span>
                  </button>
                </>
              )}
              {rel === 'outgoing' && (
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={busy}
                  onClick={() => act(() => friendsApi.cancel(card.id))}
                >
                  {t('friends.cancel')}
                </button>
              )}
              {rel === 'friends' && (
                <button
                  type="button"
                  className="btn btn--ghost btn--with-icon"
                  disabled={busy}
                  onClick={() => act(() => friendsApi.remove(card.id))}
                >
                  <UserMinus className="icon" size={20} strokeWidth={2.4} aria-hidden="true" />
                  <span>{t('friends.remove')}</span>
                </button>
              )}
              {rel === 'blocked' && (
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={busy}
                  onClick={() => act(() => friendsApi.unblock(card.id))}
                >
                  {t('friends.unblock')}
                </button>
              )}
              {rel !== 'blocked' && rel !== 'self' && (
                <button
                  type="button"
                  className="btn btn--ghost btn--with-icon"
                  disabled={busy}
                  onClick={() => act(async () => {
                    await friendsApi.block(card.id)
                    navigate('/friends')
                  })}
                >
                  <Ban className="icon" size={20} strokeWidth={2.4} aria-hidden="true" />
                  <span>{t('friends.block')}</span>
                </button>
              )}
            </div>
          </div>
        )}

        <Link className="btn btn--ghost btn--with-icon" to="/friends">
          <ArrowLeft className="icon" size={22} strokeWidth={2.4} aria-hidden="true" />
          <span>{t('friends.back')}</span>
        </Link>
      </div>
    </div>
  )
}
