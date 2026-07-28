import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Hud from '../components/Hud.jsx'
import { startGame } from '../game/index.js'
import { getToken } from '../auth/tokenStore.js'
import { useAuth } from '../auth/context.js'
import { resolveMapId } from '../config/maps.js'

const EMPTY_HUD = {
  status: '', timer: '', timerKind: '', timerDanger: false, alive: '', banner: '',
  mine: '', mineReady: false,
}

export default function GamePage() {
  const canvasRef = useRef(null)
  const gameRef = useRef(null)
  const [hud, setHud] = useState(EMPTY_HUD)
  const [isDay, setIsDay] = useState(false)
  const { logout, patchUser } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const mapId = resolveMapId(params.get('map'))

  useEffect(() => {
    const game = startGame({
      canvas: canvasRef.current,
      token: getToken(),
      mapId,
      onHud: (patch) => setHud((prev) => ({ ...prev, ...patch })),
      // a win is paid out server-side; keep the menu balance in sync
      onCubes: (cubes) => patchUser({ cubes }),
      onAuthLost: (reason) => {
        if (reason === 'kicked') navigate('/', { replace: true })
        else {
          logout()
          navigate('/auth', { replace: true })
        }
      },
    })
    gameRef.current = game
    setIsDay(game.isDay())

    return () => {
      game.stop()
      gameRef.current = null
    }
    // the game owns its own lifecycle: mount once, tear down on unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function toggleDay() {
    const next = !gameRef.current.isDay()
    gameRef.current.setDayMode(next)
    setIsDay(next)
  }

  return (
    <>
      <canvas className="webgl" ref={canvasRef} />
      <Hud
        {...hud}
        isDay={isDay}
        onToggleDay={toggleDay}
        onMine={() => gameRef.current?.placeMine()}
      />
    </>
  )
}
