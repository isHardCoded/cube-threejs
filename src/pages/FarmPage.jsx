import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowBigUp,
  ClipboardList,
  HardHat,
  Home,
  Info,
  Menu,
  Package,
  Shield,
  Store,
  Trophy,
  Users,
  Zap,
} from 'lucide-react'
import CubesMark from '../components/CubesMark.jsx'
import { useLocale } from '../i18n/LocaleContext.jsx'
import '../styles/farm.css'

const UPGRADES = [
  { id: 'miner', level: 'Lv.3', cost: 2400, Icon: HardHat },
  { id: 'conveyor', level: 'Lv.2', cost: 1800, Icon: Package },
  { id: 'booster', level: '×1.5', cost: 3000, Icon: Zap },
]

const NAV = [
  { id: 'farm', Icon: Home, badge: 0 },
  { id: 'miners', Icon: HardHat, badge: 2 },
  { id: 'upgrades', Icon: ArrowBigUp, badge: 0 },
  { id: 'friends', Icon: Users, badge: 0, to: '/friends' },
  { id: 'clan', Icon: Shield, badge: 1 },
]

function fmt(n) {
  return n.toLocaleString('ru-RU')
}

function pad(n) {
  return String(n).padStart(2, '0')
}

function formatTimer(sec) {
  return `${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec % 3600) / 60))}:${pad(sec % 60)}`
}

export default function FarmPage() {
  const { t } = useLocale()
  const navigate = useNavigate()
  const [bonusLeft, setBonusLeft] = useState(14387)
  const [pulse, setPulse] = useState(false)
  const [tab, setTab] = useState('farm')

  const balance = 45280
  const income = 1240
  const progress = 7420
  const progressMax = 10000
  const reward = 2500
  const pct = useMemo(
    () => Math.min(100, Math.round((progress / progressMax) * 100)),
    [progress, progressMax],
  )

  useEffect(() => {
    const id = window.setInterval(() => {
      setBonusLeft((v) => (v > 0 ? v - 1 : 0))
    }, 1000)
    return () => window.clearInterval(id)
  }, [])

  return (
    <div className="farm">
      <header className="farm-hd">
        <div className="farm-brand">
          <div className="farm-brand__title">{t('farm.logo')}</div>
          <div className="farm-brand__sub">{t('farm.logoSub')}</div>
        </div>

        <div className="farm-hd__mid">
          <div className="farm-pill farm-pill--bal">
            <CubesMark size={26} />
            <strong>{fmt(balance)} CUBS</strong>
          </div>
          <div className="farm-pill farm-pill--inc">
            <div className="farm-pill__row">
              <strong>+{fmt(income)} / {t('farm.hour')}</strong>
              <span title={t('farm.offlineIncome')}>
                <Info size={13} strokeWidth={2.6} aria-hidden="true" />
              </span>
            </div>
            <em>{t('farm.offlineIncome')}</em>
          </div>
        </div>

        <div className="farm-hd__tools">
          <button type="button" className="farm-tool" onClick={() => navigate('/rating')}>
            <Trophy size={18} strokeWidth={2.4} aria-hidden="true" />
            <span>{t('farm.rating')}</span>
          </button>
          <button type="button" className="farm-tool" onClick={() => navigate('/quests')}>
            <ClipboardList size={18} strokeWidth={2.4} aria-hidden="true" />
            <span>{t('farm.tasks')}</span>
            <i className="farm-dot">3</i>
          </button>
          <button type="button" className="farm-tool" disabled>
            <Store size={18} strokeWidth={2.4} aria-hidden="true" />
            <span>{t('farm.shop')}</span>
          </button>
          <button
            type="button"
            className="farm-tool farm-tool--menu"
            onClick={() => navigate('/')}
            aria-label={t('farm.menu')}
            title={t('farm.back')}
          >
            <Menu size={20} strokeWidth={2.6} aria-hidden="true" />
          </button>
        </div>

        <aside className="farm-bonus">
          <span className="farm-bonus__cap">{t('farm.bonus')}</span>
          <span className="farm-bonus__face" aria-hidden="true"><CubesMark size={34} /></span>
          <span className="farm-bonus__time">{formatTimer(bonusLeft)}</span>
        </aside>
      </header>

      <aside className="farm-rail">
        {UPGRADES.map(({ id, level, cost, Icon }) => (
          <article key={id} className={`farm-mod farm-mod--${id}`}>
            <div className="farm-mod__ico" aria-hidden="true">
              <Icon size={24} strokeWidth={2.2} />
            </div>
            <div className="farm-mod__body">
              <div className="farm-mod__name">
                {t(`farm.${id}.name`)}
                <span>{level}</span>
              </div>
              <div className="farm-mod__meta">{t(`farm.${id}.stat`)}</div>
              <button type="button" className="farm-mod__go">
                <span>{t('farm.upgrade')}</span>
                <span className="farm-mod__price">
                  <CubesMark size={14} />
                  {fmt(cost)}
                </span>
              </button>
            </div>
          </article>
        ))}

        <div className="farm-tip">
          <span className="farm-tip__face" aria-hidden="true"><CubesMark size={32} /></span>
          <p>
            <b>{t('farm.hintLabel')}</b>
            {' '}
            {t('farm.hint')}
          </p>
        </div>
      </aside>

      <div className="farm-stage" aria-hidden="true">
        <img src="/assets/ui/farm/scene.png" alt="" draggable={false} />
      </div>

      <div className="farm-cta">
        <button
          type="button"
          className={`farm-grab${pulse ? ' is-on' : ''}`}
          onClick={() => {
            setPulse(true)
            window.setTimeout(() => setPulse(false), 420)
          }}
        >
          <span>{t('farm.collect')}</span>
          <CubesMark size={22} />
        </button>

        <div className="farm-xp">
          <div className="farm-xp__top">
            <span>{t('farm.level', { from: 7, to: 8 })}</span>
            <span className="farm-xp__prize">
              <i aria-hidden="true" />
              {t('farm.reward')}
              {' '}
              <b>{fmt(reward)}</b>
            </span>
          </div>
          <div
            className="farm-xp__bar"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={progressMax}
          >
            <i style={{ width: `${pct}%` }} />
            <span>{fmt(progress)} / {fmt(progressMax)}</span>
          </div>
          <p>{t('farm.progressNote')}</p>
        </div>
      </div>

      <nav className="farm-tabs" aria-label={t('farm.nav')}>
        {NAV.map(({ id, Icon, badge, to }) => (
          <button
            key={id}
            type="button"
            className={`farm-tabs__btn${tab === id ? ' is-on' : ''}`}
            onClick={() => {
              if (to) navigate(to)
              else setTab(id)
            }}
          >
            <span className="farm-tabs__ico">
              <Icon size={20} strokeWidth={2.4} aria-hidden="true" />
              {badge > 0 ? <i className="farm-dot">{badge}</i> : null}
            </span>
            <span>{t(`farm.nav.${id}`)}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
