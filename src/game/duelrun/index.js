import { createDuelFsm, DR_STATES } from './fsm.js'
import { createTrackView } from './track.js'
import { createDuelRunner } from './runner.js'

/**
 * Shared-track Duel Run: both cubes on jungle sector corridor;
 * battle = classic 9×9 sector arena.
 * Camera: classic isometric via env.updateCamera (not runner chase).
 */
export function createDuelRunRuntime({ env, players: pm, send, onHud }) {
  const fsm = createDuelFsm()
  const track = createTrackView(env.scene, env.theme)
  const runner = createDuelRunner({ send, fsm, track })
  let mineHudAccum = 0

  function handleMessage(msg) {
    switch (msg.t) {
      case 'welcome':
        if (msg.mode !== 'duel_run' && !msg.dr) return false
        fsm.state.myId = msg.id
        fsm.state.config = msg.config || null
        if (msg.matchState) fsm.state.matchState = msg.matchState
        if (msg.seed) fsm.state.seed = msg.seed
        if (msg.nextBattle != null) fsm.state.nextBattle = msg.nextBattle
        track.clear()
        for (const seg of msg.segments || []) track.upsert(normalizeSeg(seg))
        pushHud()
        return true
      case 'dr_snapshot':
        fsm.applyState(msg)
        fsm.state.config = msg.config || fsm.state.config
        track.clear()
        for (const seg of msg.segments || []) track.upsert(normalizeSeg(seg))
        runner.applyServerPlayers(msg.players, fsm.state.myId)
        fsm.state.players = msg.players || []
        snapPlayersToServer(msg.players)
        pushHud()
        return true
      case 'dr_state':
        fsm.applyState(msg)
        updateTrackMode()
        // Fresh RUNNING: snap cubes to corridor cells (welcome still had 0,0).
        if (msg.matchState === DR_STATES.RUNNING || msg.matchState === DR_STATES.COUNTDOWN) {
          snapPlayersToServer(fsm.state.players)
        }
        pushHud()
        return true
      case 'dr_segment':
        if (msg.segment) track.upsert(normalizeSeg(msg.segment))
        return true
      case 'dr_despawn':
        track.despawn(msg.ids, runner.local.distance)
        return true
      case 'dr_crumble':
        track.crumble(msg.cells)
        return true
      case 'dr_runner':
        fsm.applyState(msg)
        runner.applyServerPlayers(msg.players, fsm.state.myId)
        fsm.state.players = msg.players || []
        // Idle desync only — never teleport while a move/jump is queued/playing
        // (dr_runner used to race ahead of "move" and drop the cube under the track).
        for (const sp of msg.players || []) {
          const p = pm.players?.get?.(sp.id)
          if (!p || p.anim || p.queue?.length || p.deathAnim) continue
          if (sp.x == null || sp.z == null) continue
          if (p.cell.x === sp.x && p.cell.z === sp.z) continue
          if (p.id === fsm.state.myId && pm.predictions?.length) continue
          p.cell = { x: sp.x, z: sp.z }
          p.confirmedCell = { x: sp.x, z: sp.z }
          const y = (env?.theme?.arenaLift || 0) + 0.5
          p.group.position.set(sp.x, y, sp.z)
        }
        pushHud()
        return true
      case 'dr_run_hit':
        pushHud({ status: 'Clash!' })
        return true
      case 'dr_battle':
        fsm.state.battle = msg
        fsm.state.suddenDeath = !!msg.suddenDeath
        runner.applyServerPlayers(msg.players || [], fsm.state.myId)
        fsm.state.players = (fsm.state.players || []).map((p) => {
          const b = (msg.players || []).find((x) => x.id === p.id)
          return b ? { ...p, ...b, bx: b.x, bz: b.z } : p
        })
        if (!(fsm.state.players || []).length) {
          fsm.state.players = msg.players || []
        }
        pushHud()
        return true
      case 'dr_battle_hit':
      case 'dr_battle_result':
        pushHud({
          banner: msg.winnerId
            ? (msg.winnerId === fsm.state.myId ? 'Battle win' : 'Battle lose')
            : '',
        })
        return true
      case 'dr_sudden_death':
        fsm.state.suddenDeath = true
        pushHud({ status: 'Sudden Death!' })
        return true
      case 'dr_life_lost': {
        fsm.state.lifeToast = `${msg.lives} lives remaining`
        if (msg.id === fsm.state.myId && pm.predictions) pm.predictions.length = 0
        pushHud({ status: `Life lost — ${msg.lives} left`, lifeToast: fsm.state.lifeToast })
        return true
      }
      case 'dr_pickup':
        if (msg.pickupId) track.removePickup(msg.pickupId)
        pushHud({ status: msg.kind === 'shield_break' ? 'Shield break' : `Pickup: ${msg.kind}` })
        return true
      case 'dr_match_over':
        fsm.state.matchOver = msg
        fsm.state.matchState = DR_STATES.MATCH_FINISHED
        pushHud({ matchOver: msg })
        return true
      case 'dr_reconnect_pause':
        fsm.state.paused = true
        fsm.state.matchState = DR_STATES.RECONNECTING
        pushHud({ status: 'Opponent reconnecting…' })
        return true
      default:
        return false
    }
  }

  function snapPlayersToServer(list) {
    for (const sp of list || []) {
      if (sp.x == null || sp.z == null) continue
      const p = pm.players?.get?.(sp.id)
      if (!p) continue
      p.anim = null
      p.queue = []
      if (p.id === fsm.state.myId && pm.predictions) pm.predictions.length = 0
      p.cell = { x: sp.x, z: sp.z }
      p.confirmedCell = { x: sp.x, z: sp.z }
      // Track sits at arenaLift — never snap to y=0.5 or the cube drops under the mesh.
      const y = (env?.theme?.arenaLift || 0) + 0.5
      p.group.position.set(sp.x, y, sp.z)
    }
  }

  function updateTrackMode() {
    const s = fsm.state.matchState
    const z = runner.local.distance
    track._battleOriginZ = Math.round(z)
    if (s === DR_STATES.BATTLE_ACTIVE || s === DR_STATES.BATTLE_INTRO) {
      track.setBattleMode(true, z)
    } else if (s === DR_STATES.BATTLE_APPROACH || s === DR_STATES.BATTLE_RESULT || s === DR_STATES.RETURN_TO_RUN) {
      track.setBattleMode(s === DR_STATES.BATTLE_RESULT || s === DR_STATES.BATTLE_INTRO, z)
    } else {
      track.setBattleMode(false)
    }
  }

  function onKey(e) {
    // Classic input handles WASD; only keep duel keys during battle if needed.
    if (!fsm.canBattleInput()) return
    if (e.repeat) return
    // Battle still uses createInput move messages via server — no extra keys.
  }

  function bindInput() {
    // no-op: createInput is active for duel run
  }

  function unbindInput() {}

  function update(dt) {
    const t = performance.now() / 1000
    runner.update(dt)
    track.update(dt, t)

    const inBattle = fsm.canBattleInput()
      || fsm.state.matchState === DR_STATES.BATTLE_INTRO
      || fsm.state.matchState === DR_STATES.BATTLE_RESULT

    // Prefer live dice coords from classic move sync
    const meP = pm.me?.()
    if (meP && !inBattle) {
      const cx = meP.cell?.x ?? meP.confirmedCell?.x ?? runner.local.x
      const cz = meP.cell?.z ?? meP.confirmedCell?.z ?? runner.local.z
      runner.local.x = cx
      runner.local.z = cz
      runner.local.distance = cz
      runner.local.jumping = !!(meP.anim?.type === 'jump' || meP.queue?.some?.((m) => m.jump))
    }

    const myPos = inBattle ? runner.battlePos() : runner.playerWorldPos()

    if (meP?.group) {
      if (inBattle) {
        meP.group.position.lerp(myPos, 1 - Math.exp(-18 * dt))
      }
      // In run mode, classic enqueueMove already animates the cube.
    }

    for (const { id, pos } of runner.otherWorldPositions(inBattle)) {
      const op = pm.players?.get?.(id)
      if (op?.group) {
        if (inBattle) {
          op.group.position.lerp(pos, 1 - Math.exp(-14 * dt))
        }
        op.group.visible = true
      }
    }

    // Refresh mine cooldown label ~4 Hz (avoid React spam)
    mineHudAccum += dt
    if (mineHudAccum >= 0.25) {
      mineHudAccum = 0
      pushHud()
    }
  }

  function pushHud(extra = {}) {
    const st = fsm.state
    const me = (st.players || []).find((p) => p.id === st.myId)
    const opp = (st.players || []).find((p) => p.id !== st.myId)
    const cooling = Math.max(0, (pm.local?.mineReadyAt || 0) - performance.now())
    const mineReady = cooling === 0 && !!pm.canPlay?.()
    const mine = cooling > 0 ? `${(cooling / 1000).toFixed(1)}s` : 'E'
    onHud?.({
      duelRun: true,
      myId: st.myId,
      matchState: st.matchState,
      endsAt: st.endsAt || 0,
      myLives: me?.lives ?? 3,
      oppLives: opp ? (opp.lives ?? 3) : null,
      myName: me?.name || 'You',
      oppName: opp?.name || '',
      battle: st.battle,
      suddenDeath: st.suddenDeath,
      matchOver: st.matchOver,
      paused: st.paused,
      mine,
      mineReady,
      hideMine: false,
      ...extra,
    })
  }

  function dispose() {
    unbindInput()
    track.clear()
  }

  bindInput()

  return { handleMessage, update, dispose, fsm, track, pushHud }
}

function normalizeSeg(seg) {
  return {
    id: seg.id,
    kind: seg.kind,
    length: seg.length,
    startZ: seg.startZ ?? seg.startz ?? 0,
    obstacles: seg.obstacles || [],
    pickups: seg.pickups || [],
    safe: !!seg.safe,
  }
}
