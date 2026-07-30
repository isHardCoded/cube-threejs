import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Gift } from 'lucide-react'
import Spinner from '../components/Spinner.jsx'
import { quests as questsApi } from '../api/client.js'
import { useAuth } from '../auth/context.js'
import { useLocale } from '../i18n/LocaleContext.jsx'

function QuestCard({ quest, claiming, onClaim, t, delay }) {
  const pct = quest.target > 0
    ? Math.min(100, Math.round((quest.progress / quest.target) * 100))
    : 0
  const title = t(`quests.${quest.id}`)

  return (
    <div
      className={[
        'quest-card',
        quest.claimable ? 'is-claimable' : '',
        quest.claimed ? 'is-claimed' : '',
      ].filter(Boolean).join(' ')}
      style={{ animationDelay: `${delay}s` }}
    >
      <div className="quest-card__top">
        <div className="quest-card__title">{title}</div>
        <div className="quest-card__reward" title={t('quests.reward')}>
          +{quest.reward}
          <span className="quest-card__reward-unit">{t('menu.cubes')}</span>
        </div>
      </div>

      <div className="quest-card__meta">
        <span>{quest.progress}/{quest.target}</span>
        <span>{pct}%</span>
      </div>

      <div
        className="quest-bar"
        role="progressbar"
        aria-valuenow={quest.progress}
        aria-valuemin={0}
        aria-valuemax={quest.target}
        aria-label={title}
      >
        <div className="quest-bar__fill" style={{ width: `${pct}%` }} />
      </div>

      {quest.claimed ? (
        <div className="quest-card__done">{t('quests.claimed')}</div>
      ) : quest.claimable ? (
        <button
          type="button"
          className="btn btn--tiny quest-card__claim"
          disabled={claiming}
          onClick={() => onClaim(quest.id)}
        >
          <Gift className="icon" size={16} strokeWidth={2.4} aria-hidden="true" />
          <span>{claiming ? t('quests.claiming') : t('quests.claim')}</span>
        </button>
      ) : null}
    </div>
  )
}

export default function QuestsPage() {
  const { t, translateError } = useLocale()
  const { patchUser } = useAuth()
  const [daily, setDaily] = useState(null)
  const [weekly, setWeekly] = useState(null)
  const [tab, setTab] = useState('daily')
  const [error, setError] = useState('')
  const [claimingId, setClaimingId] = useState('')

  const load = useCallback(async () => {
    const data = await questsApi.list()
    setDaily(data.daily || [])
    setWeekly(data.weekly || [])
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        await load()
      } catch (err) {
        if (alive) setError(translateError(err.message))
      }
    })()
    return () => { alive = false }
  }, [load, translateError])

  async function onClaim(id) {
    setClaimingId(id)
    setError('')
    try {
      const res = await questsApi.claim(id)
      if (typeof res.cubes === 'number') patchUser({ cubes: res.cubes })
      await load()
    } catch (err) {
      setError(translateError(err.message))
    } finally {
      setClaimingId('')
    }
  }

  const loading = !daily && !weekly && !error
  const items = tab === 'daily' ? daily : weekly

  return (
    <div className="screen">
      <div className="screen__title">{t('quests.title')}</div>

      <div className="screen__box screen__box--wide">
        {error && <div className="screen__error">{error}</div>}
        {loading && <Spinner label={t('common.loading')} />}

        {daily && (
          <div className="quests screen__card">
            <div className="quests__tabs" role="tablist">
              <button
                type="button"
                role="tab"
                className={`friends-tab${tab === 'daily' ? ' is-active' : ''}`}
                aria-selected={tab === 'daily'}
                onClick={() => setTab('daily')}
              >
                {t('quests.daily')}
              </button>
              <button
                type="button"
                role="tab"
                className={`friends-tab${tab === 'weekly' ? ' is-active' : ''}`}
                aria-selected={tab === 'weekly'}
                onClick={() => setTab('weekly')}
              >
                {t('quests.weekly')}
              </button>
            </div>

            <div className="quests__scroll" role="tabpanel">
              <div className="quest-list" key={tab}>
                {(items || []).map((q, i) => (
                  <QuestCard
                    key={q.id}
                    quest={q}
                    claiming={claimingId === q.id}
                    onClaim={onClaim}
                    t={t}
                    delay={0.04 + i * 0.06}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        <Link className="btn btn--ghost btn--with-icon" to="/">
          <ArrowLeft className="icon" size={22} strokeWidth={2.4} aria-hidden="true" />
          <span>{t('quests.back')}</span>
        </Link>
      </div>
    </div>
  )
}
