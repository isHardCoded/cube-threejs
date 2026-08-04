/** Match states mirrored from the server. */
export const DR_STATES = {
  WAITING_FOR_PLAYERS: 'WAITING_FOR_PLAYERS',
  LOADING: 'LOADING',
  COUNTDOWN: 'COUNTDOWN',
  RUNNING: 'RUNNING',
  BATTLE_APPROACH: 'BATTLE_APPROACH',
  BATTLE_INTRO: 'BATTLE_INTRO',
  BATTLE_ACTIVE: 'BATTLE_ACTIVE',
  BATTLE_RESULT: 'BATTLE_RESULT',
  RETURN_TO_RUN: 'RETURN_TO_RUN',
  PLAYER_ELIMINATED: 'PLAYER_ELIMINATED',
  MATCH_FINISHED: 'MATCH_FINISHED',
  RECONNECTING: 'RECONNECTING',
}

export function createDuelFsm() {
  const state = {
    matchState: DR_STATES.WAITING_FOR_PLAYERS,
    endsAt: 0,
    battleIdx: 0,
    nextBattle: 250,
    seed: 0,
    paused: false,
    tier: 'easy',
    config: null,
    myId: '',
    players: [],
    segments: new Map(),
    battle: null,
    lifeToast: '',
    matchOver: null,
    suddenDeath: false,
  }

  function applyState(msg) {
    if (msg.matchState) state.matchState = msg.matchState
    if (msg.endsAt) state.endsAt = msg.endsAt
    if (msg.battleIdx != null) state.battleIdx = msg.battleIdx
    if (msg.nextBattle != null) state.nextBattle = msg.nextBattle
    if (msg.seed) state.seed = msg.seed
    if (msg.paused != null) state.paused = msg.paused
    if (msg.tier) state.tier = msg.tier
  }

  function canRunnerInput() {
    if (state.paused) return false
    const s = state.matchState
    return s === DR_STATES.RUNNING || s === DR_STATES.RETURN_TO_RUN || s === DR_STATES.BATTLE_APPROACH
  }

  function canBattleInput() {
    if (state.paused) return false
    return state.matchState === DR_STATES.BATTLE_ACTIVE
  }

  return { state, applyState, canRunnerInput, canBattleInput }
}
