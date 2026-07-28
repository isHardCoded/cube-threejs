import { useLocale } from '../i18n/LocaleContext.jsx'

export default function LangSwitch() {
  const { locale, setLocale } = useLocale()

  return (
    <div className="lang-switch" role="group" aria-label="Language">
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
