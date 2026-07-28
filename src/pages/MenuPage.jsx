import { Link, useNavigate } from 'react-router-dom'
import Logo from '../components/Logo.jsx'
import LogoutIcon from '../components/LogoutIcon.jsx'
import { useAuth } from '../auth/context.js'

export default function MenuPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="screen">
      <Logo />

      <div className="screen__box">
        <div className="screen__card">
          <div className="who">
            <span className="who__name">{user.username}</span>
            <button
              type="button"
              className="who__out"
              onClick={logout}
              aria-label="Выйти"
              title="Выйти"
            >
              <LogoutIcon />
            </button>
          </div>

          <div className="cubes">
            <span className="cubes__value">{user.cubes}</span>
            <span className="cubes__label">кубсов</span>
          </div>
        </div>

        <button className="btn" type="button" onClick={() => navigate('/play')}>
          Играть
        </button>
        <Link className="btn btn--ghost" to="/character">Персонаж</Link>
      </div>
    </div>
  )
}
