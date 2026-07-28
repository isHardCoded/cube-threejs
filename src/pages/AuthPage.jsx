import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import Logo from '../components/Logo.jsx'
import Spinner from '../components/Spinner.jsx'
import { useAuth } from '../auth/context.js'

const MAX_NICK = 14

export default function AuthPage() {
  const { user, loading, login, register } = useAuth()
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (loading) {
    return (
      <div className="screen">
        <Logo />
        <Spinner />
      </div>
    )
  }
  if (user) return <Navigate to="/" replace />

  async function submit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (mode === 'login') await login(username, password)
      else await register(username, password)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  function switchMode(next) {
    setMode(next)
    setError('')
  }

  return (
    <div className="screen">
      <Logo />

      <div className="screen__box">
        <div className="screen__card">
          <div className="tabs">
            <button
              type="button"
              className={`tab${mode === 'login' ? ' is-active' : ''}`}
              onClick={() => switchMode('login')}
            >
              Вход
            </button>
            <button
              type="button"
              className={`tab${mode === 'register' ? ' is-active' : ''}`}
              onClick={() => switchMode('register')}
            >
              Регистрация
            </button>
          </div>

          <form className="screen__box" onSubmit={submit}>
            <input
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              maxLength={MAX_NICK}
              autoComplete="username"
              spellCheck={false}
              placeholder="Никнейм"
              autoFocus
            />
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder="Пароль"
            />
            {error && <div className="screen__error">{error}</div>}
            <button className="btn" type="submit" disabled={busy}>
              {busy ? <Spinner /> : mode === 'login' ? 'Войти' : 'Создать аккаунт'}
            </button>
          </form>
        </div>

        <div className="soon-note">
          {mode === 'login'
            ? 'Нет аккаунта? Достаточно ника и пароля.'
            : 'Ник от 3 до 14 символов, пароль от 6.'}
        </div>
      </div>
    </div>
  )
}
