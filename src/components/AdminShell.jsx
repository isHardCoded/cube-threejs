import { NavLink, Link, Outlet } from 'react-router-dom'
import { ArrowLeft, ScrollText, Send, Users } from 'lucide-react'

const NAV = [
  { to: '/admin', end: true, icon: Users, label: 'Игроки' },
  { to: '/admin/quests', end: false, icon: ScrollText, label: 'Квесты' },
  { to: '/admin/posts', end: false, icon: Send, label: 'Посты бота' },
]

export default function AdminShell() {
  return (
    <div className="admin">
      <aside className="admin__side">
        <div className="admin__brand">Админка</div>
        <nav className="admin__nav" aria-label="Админка">
          {NAV.map(({ to, end, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `admin__link${isActive ? ' is-active' : ''}`}
            >
              <Icon className="icon" size={18} strokeWidth={2.4} aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <Link className="admin__back" to="/">
          <ArrowLeft className="icon" size={16} strokeWidth={2.4} aria-hidden="true" />
          <span>В меню</span>
        </Link>
      </aside>
      <main className="admin__main">
        <Outlet />
      </main>
    </div>
  )
}

export function AdminHeader({ title, actions }) {
  return (
    <header className="admin__top">
      <h1 className="admin__heading">{title}</h1>
      {actions ? <div className="admin__actions">{actions}</div> : null}
    </header>
  )
}
