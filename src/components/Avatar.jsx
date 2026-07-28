import { resolveAvatarUrl } from '../auth/avatar.js'
import { useLocale } from '../i18n/LocaleContext.jsx'

export default function Avatar({ user, size = 'sm', onClick, className = '' }) {
  const { t } = useLocale()
  const src = resolveAvatarUrl(user?.avatarUrl)
  const label = user?.username || '?'
  const initial = [...label][0]?.toUpperCase() || '?'

  const Tag = onClick ? 'button' : 'span'
  const props = onClick
    ? { type: 'button', onClick, 'aria-label': t('profile.open') }
    : { role: 'img', 'aria-label': label }

  return (
    <Tag
      {...props}
      className={`avatar avatar--${size}${onClick ? ' avatar--clickable' : ''}${className ? ` ${className}` : ''}`}
    >
      {src ? (
        <img className="avatar__img" src={src} alt="" draggable={false} />
      ) : (
        <span className="avatar__fallback" aria-hidden="true">{initial}</span>
      )}
    </Tag>
  )
}
