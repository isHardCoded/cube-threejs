import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Hud from '../components/Hud.jsx'
import MapAssetModal from '../components/MapAssetModal.jsx'
import { startGame } from '../game/index.js'
import { preloadThemeAssets } from '../game/themes/index.js'
import { getToken } from '../auth/tokenStore.js'
import { useAuth } from '../auth/context.js'
import { resolveMapId } from '../config/maps.js'
import { sfx } from '../game/sfx.js'

const EMPTY_HUD = {
  status: '', timer: '', timerKind: '', timerDanger: false, alive: '', banner: '',
  mine: '', mineReady: false,
}

export default function GamePage() {
  const canvasRef = useRef(null)
  const gameRef = useRef(null)
  const [hud, setHud] = useState(EMPTY_HUD)
  const [isDay, setIsDay] = useState(false)
  const [assetsOpen, setAssetsOpen] = useState(false)
  const [cameraYaw, setCameraYaw] = useState(0)
  const [cameraElev, setCameraElev] = useState(42)
  const { logout, patchUser } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const mapId = resolveMapId(params.get('map'))
  const mode = params.get('mode') || ''
  const matchId = params.get('match') || ''

  useEffect(() => {
    let stopped = false
    let game = null

    ;(async () => {
      await preloadThemeAssets(mapId)
      if (stopped || !canvasRef.current) return

      game = startGame({
        canvas: canvasRef.current,
        token: getToken(),
        mapId,
        mode,
        matchId,
        onHud: (patch) => setHud((prev) => ({ ...prev, ...patch })),
        // a win is paid out server-side; keep the menu balance in sync
        onCubes: (cubes) => patchUser({ cubes }),
        onAuthLost: (kind, reason) => {
          if (kind === 'kicked') {
            // a match that ended without us is not a reason to leave PvP: drop
            // the player back on the search screen so they can queue again
            const backToSearch = !!matchId && reason !== 'another_session'
            navigate(backToSearch ? '/play/pvp' : '/', { replace: true, state: { reason } })
            return
          }
          // a match room that is gone answers the socket with 404, which is not an
          // auth problem: keep the session and let them search for another one
          if (matchId) {
            navigate('/play/pvp', { replace: true, state: { reason: 'match_gone' } })
            return
          }
          logout()
          navigate('/auth', { replace: true })
        },
      })
      if (stopped) {
        game.stop()
        return
      }
      gameRef.current = game
      setIsDay(game.isDay())
    })()

    return () => {
      stopped = true
      game?.stop()
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

  function openAssets() {
    sfx.click()
    setAssetsOpen(true)
  }

  function onCameraYaw(deg) {
    setCameraYaw(deg)
    gameRef.current?.setCameraYaw?.(deg)
  }

  function onCameraElev(deg) {
    setCameraElev(deg)
    gameRef.current?.setCameraElev?.(deg)
  }

  return (
    <>
      <canvas className="webgl" ref={canvasRef} />
      <Hud
        {...hud}
        isDay={isDay}
        onToggleDay={toggleDay}
        onMine={() => gameRef.current?.placeMine()}
        onOpenAssets={openAssets}
        cameraYaw={cameraYaw}
        onCameraYaw={onCameraYaw}
        cameraElev={cameraElev}
        onCameraElev={onCameraElev}
      />
      <MapAssetModal
        open={assetsOpen}
        mapId={mapId}
        onClose={() => setAssetsOpen(false)}
      />
    </>
  )
}
