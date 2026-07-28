import { useState } from 'react'
import { Link } from 'react-router-dom'
import Avatar from '../components/Avatar.jsx'
import AvatarModal from '../components/AvatarModal.jsx'
import { profile } from '../api/client.js'
import { useAuth } from '../auth/context.js'
import { formatRegisteredAt } from '../auth/avatar.js'
import { useLocale } from '../i18n/LocaleContext.jsx'

export default function ProfilePage() {
  const { user, patchUser } = useAuth()
  const { t, locale, translateError } = useLocale()
  const [modalOpen, setModalOpen] = useState(false)

  async function upload(file) {
    try {
      const res = await profile.setAvatar(file)
      patchUser(res.user)
    } catch (err) {
      throw new Error(translateError(err.message))
    }
  }

  return (
    <div className="screen">
      <div className="screen__title">{t('profile.title')}</div>

      <div className="screen__box">
        <div className="screen__card profile-card">
          <Avatar user={user} size="lg" onClick={() => setModalOpen(true)} />
          <div className="profile-card__name">{user.username}</div>
          <div className="profile-card__meta">
            <span className="profile-card__label">{t('profile.registered')}</span>
            <span>{formatRegisteredAt(user.createdAt, locale)}</span>
          </div>

          <div className="profile-card__soon">
            {t('profile.soon')}
          </div>
        </div>

        <Link className="btn btn--ghost" to="/">{t('profile.back')}</Link>
      </div>

      <AvatarModal
        user={user}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onUpload={upload}
      />
    </div>
  )
}
