import { useLocale } from '../i18n/LocaleContext.jsx'

export default function LangSwitch({ variant = 'floating' }) {
  const { locale, setLocale } = useLocale()
  const className = variant === 'inline' ? 'lang-switch lang-switch--inline' : 'lang-switch'

  return (
    <div className={className} role="group" aria-label={variant === 'inline' ? undefined : 'Language'}>
      <button
        type="button"
        className={`lang-switch__btn${locale === 'ru' ? ' is-active' : ''}`}
        onClick={() => setLocale('ru')}
        aria-pressed={locale === 'ru'}
        title="Русский"
      >
        RU
      </button>
      <button
        type="button"
        className={`lang-switch__btn${locale === 'en' ? ' is-active' : ''}`}
        onClick={() => setLocale('en')}
        aria-pressed={locale === 'en'}
        title="English"
      >
        EN
      </button>
    </div>
  )
}
