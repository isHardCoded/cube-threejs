import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Hud from '../components/Hud.jsx'
import DuelRunHud from '../components/DuelRunHud.jsx'
import MapAssetModal from '../components/MapAssetModal.jsx'
import { startGame } from '../game/index.js'
import { preloadHats } from '../game/hats.js'
import { preloadHands } from '../game/hands.js'
import { preloadThemeAssets } from '../game/themes/index.js'
import { getToken } from '../auth/tokenStore.js'
import { useAuth } from '../auth/context.js'
import { DEFAULT_SKIN } from '../game/dice.js'
import { resolveMapId, DUEL_RUN_MAP_ID, FREEROAM_MAP_ID } from '../config/maps.js'
import { matchmaking } from '../api/client.js'
import { sfx } from '../game/sfx.js'

const EMPTY_HUD = {
  status: '', timer: '', timerKind: '', timerDanger: false, alive: '', banner: '',
  mine: '', mineReady: false, fps: 0, ping: null, canStart: false, duelRun: false,
  deathOverlay: null, freeCombat: false,
}

export default function GamePage() {
  const canvasRef = useRef(null)
  const gameRef = useRef(null)
  const [hud, setHud] = useState(EMPTY_HUD)
  const [isDay, setIsDay] = useState(false)
  const [assetsOpen, setAssetsOpen] = useState(false)
  const { logout, patchUser, user } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const mode = params.get('mode') || ''
  const mapId = mode === 'freeroam' ? FREEROAM_MAP_ID : resolveMapId(params.get('map'))
  const matchId = params.get('match') || ''
  const isDuelRun = mapId === DUEL_RUN_MAP_ID || mode === 'duel_run'

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
        skin: DEFAULT_SKIN,
        hatId: user?.hatId || 'none',
        onHud: (patch) => setHud((prev) => ({ ...prev, ...patch })),
        onCubes: (cubes) => patchUser({ cubes }),
        onAuthLost: (kind, reason) => {
          if (kind === 'kicked') {
            const backToDuel = isDuelRun && reason !== 'another_session'
            const backToSearch = !!matchId && reason !== 'another_session' && !isDuelRun
            const backToPve = mode === 'arena' && reason !== 'another_session'
            navigate(
              backToDuel ? '/play/pvp/duel-run'
                : backToSearch ? '/play/pvp'
                  : backToPve ? '/play/pve' : '/',
              { replace: true, state: { reason } },
            )
            return
          }
          if (matchId && isDuelRun) {
            navigate('/play/pvp/duel-run', { replace: true, state: { reason: 'match_gone' } })
            return
          }
          if (matchId) {
            navigate('/play/pvp', { replace: true, state: { reason: 'match_gone' } })
            return
          }
          if (mode === 'arena') {
            navigate('/play/pve', { replace: true, state: { reason: 'connect_failed' } })
            return
          }
          if (mode === 'training' || mode === 'freeroam') {
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

  async function rematch() {
    try {
      const res = await matchmaking.duelRunQuick()
      if (res.state === 'matched') {
        navigate(`/game?match=${encodeURIComponent(res.matchId)}&map=${res.mapId || 'duelrun'}`, { replace: true })
        window.location.reload()
      } else {
        navigate('/play/pvp/duel-run/quick', { replace: true })
      }
    } catch {
      navigate('/play/pvp/duel-run/quick', { replace: true })
    }
  }

  return (
    <>
      <canvas className="webgl" ref={canvasRef} />
      {hud.duelRun || isDuelRun ? (
        <DuelRunHud
          {...hud}
          myId={hud.myId || String(user?.id || '')}
          isDay={isDay}
          onToggleDay={toggleDay}
          onRematch={rematch}
          onMine={() => gameRef.current?.placeMine()}
          onOpenAssets={openAssets}
        />
      ) : (
        <Hud
          {...hud}
          isDay={isDay}
          onToggleDay={toggleDay}
          onMine={() => gameRef.current?.placeMine()}
          onStartMatch={() => gameRef.current?.startMatch()}
          onOpenAssets={openAssets}
          onEmote={(emote) => gameRef.current?.sendEmote?.(emote)}
        />
      )}
      <MapAssetModal
        open={assetsOpen}
        mapId={mapId}
        onClose={() => setAssetsOpen(false)}
      />
    </>
  )
}
