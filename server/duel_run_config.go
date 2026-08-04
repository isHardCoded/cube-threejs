package main

import (
	"os"
	"strings"
	"time"
)

// Tunables from the Duel Run TZ. Sent to clients in welcome — do not hardcode on client.
const (
	DuelRunMapID = "duelrun"
	ModeDuelRun  = "duel_run"

	DRDefaultLives = 3
	DRLaneCount    = 3

	DRBaseSpeed              = 8.0  // m/s
	DRMaxSpeed               = 22.0 // m/s
	DRSpeedIncreasePerMeter  = 0.004
	DRSpeedIncreasePerSeg    = 0.15
	DRSpeedBumpAfterBattle   = 0.35

	DRFirstBattleDistance  = 250.0
	DRNextBattleDistMin    = 250.0
	DRNextBattleDistMax    = 450.0

	DRBattleDuration       = 12 * time.Second
	DRSuddenDeathDuration  = 5 * time.Second
	DRBattleHealth         = 100
	DRLightAttackDamage    = 15
	DRLightAttackCD        = 700 * time.Millisecond
	DRHeavyAttackDamage    = 30
	DRHeavyAttackCD        = 2500 * time.Millisecond
	DRDashHitDamage        = 10
	DRDashKnockback        = 2.2
	DRReturnInvuln         = 2 * time.Second
	DRReconnectTimeout     = 20 * time.Second
	DRCountdownDuration    = 6 * time.Second // 5…1 + Start
	DRBattleIntroDuration  = 3 * time.Second
	DRBattleResultFreeze   = 2 * time.Second
	DRLoadingDuration      = 800 * time.Millisecond
	DRLaneSwitchTime       = 180 * time.Millisecond
	DRJumpDuration         = 450 * time.Millisecond
	DRDashDuration         = 220 * time.Millisecond
	DRSlideDuration        = 400 * time.Millisecond
	DRGroundSlamDuration   = 350 * time.Millisecond
	DRLaneWidth            = 1.0  // one sector cell per lane
	DRArenaHalf            = 4    // classic 9×9 battle grid (cells)
	DRPreSpawnSegments     = 6
	DRDespawnBehind        = 55.0 // keep mesh behind the trailing cube
	DRLoserBattleShield    = 1 * time.Second
	DRRunBumpCooldown       = 700 * time.Millisecond
	DRWaveInterval          = 340 * time.Millisecond // another 1.5× slower chase
	DRWaveStartDelay        = 765 * time.Millisecond
	DRWaveRespawnLead       = 16 // cells ahead of wave — room after fall anim
	DRFallAnimDuration      = 1100 * time.Millisecond

	DRTickHz = 10 // matches hub ticker (100ms)
)

// DRConfigPayload is mirrored to the client on welcome.
func DRConfigPayload() map[string]any {
	return map[string]any{
		"lives":                  DRDefaultLives,
		"lanes":                  DRLaneCount,
		"baseSpeed":              DRBaseSpeed,
		"maxSpeed":               DRMaxSpeed,
		"speedIncreasePerMeter":  DRSpeedIncreasePerMeter,
		"speedIncreasePerSeg":    DRSpeedIncreasePerSeg,
		"speedBumpAfterBattle":   DRSpeedBumpAfterBattle,
		"firstBattleDistance":    DRFirstBattleDistance,
		"nextBattleDistanceMin":  DRNextBattleDistMin,
		"nextBattleDistanceMax":  DRNextBattleDistMax,
		"battleDurationMs":       DRBattleDuration.Milliseconds(),
		"suddenDeathMs":          DRSuddenDeathDuration.Milliseconds(),
		"battleHealth":           DRBattleHealth,
		"lightAttackDamage":      DRLightAttackDamage,
		"lightAttackCdMs":        DRLightAttackCD.Milliseconds(),
		"heavyAttackDamage":      DRHeavyAttackDamage,
		"heavyAttackCdMs":        DRHeavyAttackCD.Milliseconds(),
		"dashHitDamage":          DRDashHitDamage,
		"dashKnockback":          DRDashKnockback,
		"returnInvulnMs":         DRReturnInvuln.Milliseconds(),
		"reconnectTimeoutMs":     DRReconnectTimeout.Milliseconds(),
		"countdownMs":            DRCountdownDuration.Milliseconds(),
		"battleIntroMs":          DRBattleIntroDuration.Milliseconds(),
		"laneWidth":              DRLaneWidth,
		"arenaHalf":              DRArenaHalf,
		"sharedTrack":            true,
		"cellSize":               1,
		"soloDev":                duelRunSoloDev(),
	}
}

// duelRunSoloDev: 1-player start for local testing (no second account).
// On: DUEL_RUN_SOLO=1/true, or local JWT_SECRET (contains "local" / "dev-secret").
func duelRunSoloDev() bool {
	if v := strings.TrimSpace(os.Getenv("DUEL_RUN_SOLO")); v == "1" || strings.EqualFold(v, "true") {
		return true
	}
	if v := strings.TrimSpace(os.Getenv("DUEL_RUN_SOLO")); v == "0" || strings.EqualFold(v, "false") {
		return false
	}
	sec := strings.ToLower(os.Getenv("JWT_SECRET"))
	return strings.Contains(sec, "local") || strings.Contains(sec, "dev-secret")
}

func drPlayersNeeded() int {
	if duelRunSoloDev() {
		return 1
	}
	return 2
}

// Difficulty tier by distance (meters).
func drDifficultyTier(dist float64) (name string, density float64, moveSpeed float64, safeGap float64) {
	switch {
	case dist < 500:
		return "easy", 0.35, 1.0, 12
	case dist < 1200:
		return "medium", 0.55, 1.25, 9
	case dist < 2000:
		return "hard", 0.75, 1.55, 7
	default:
		return "expert", 0.95, 1.9, 5
	}
}
