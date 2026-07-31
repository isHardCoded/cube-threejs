import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Hud from '../components/Hud.jsx'
import MapAssetModal from '../components/MapAssetModal.jsx'
import { startGame } from '../game/index.js'
import { preloadHats } from '../game/hats.js'
import { preloadHands } from '../game/hands.js'
import { preloadThemeAssets } from '../game/themes/index.js'
import { getToken } from '../auth/tokenStore.js'
import { useAuth } from '../auth/context.js'
import { resolveMapId } from '../config/maps.js'
import { sfx } from '../game/sfx.js'

const EMPTY_HUD = {
  status: '', timer: '', timerKind: '', timerDanger: false, alive: '', banner: '',
  mine: '', mineReady: false, fps: 0, ping: null, canStart: false,
}

export default function GamePage() {
  const canvasRef = useRef(null)
  const gameRef = useRef(null)
  const [hud, setHud] = useState(EMPTY_HUD)
  const [isDay, setIsDay] = useState(false)
  const [assetsOpen, setAssetsOpen] = useState(false)
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
      await Promise.all([preloadThemeAssets(mapId), preloadHats(), preloadHands()])
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
            const backToPve = mode === 'arena' && reason !== 'another_session'
            navigate(
              backToSearch ? '/play/pvp' : backToPve ? '/play/pve' : '/',
              { replace: true, state: { reason } },
            )
            return
          }
          // Socket never opened (404 match, unknown mode, server restart…). Keep
          // the session — only a real 401-style reject should force re-login, and
          // solo modes must never look like a stolen token.
          if (matchId) {
            navigate('/play/pvp', { replace: true, state: { reason: 'match_gone' } })
            return
          }
          if (mode === 'arena') {
            navigate('/play/pve', { replace: true, state: { reason: 'connect_failed' } })
            return
          }
          if (mode === 'training') {
            navigate('/play/training', { replace: true, state: { reason: 'connect_failed' } })
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
    const game = gameRef.current
    if (!game) return
    const next = !game.isDay()
    game.setDayMode(next)
    setIsDay(next)
  }

  function openAssets() {
    sfx.click()
    setAssetsOpen(true)
  }

  return (
    <>
      <canvas className="webgl" ref={canvasRef} />
      <Hud
        {...hud}
        isDay={isDay}
        onToggleDay={toggleDay}
        onMine={() => gameRef.current?.placeMine()}
        onStartMatch={() => gameRef.current?.startMatch()}
        onOpenAssets={openAssets}
      />
      <MapAssetModal
        open={assetsOpen}
        mapId={mapId}
        onClose={() => setAssetsOpen(false)}
      />
    </>
  )
}
