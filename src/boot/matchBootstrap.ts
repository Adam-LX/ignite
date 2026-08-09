import type { GameAudio } from "../audio/GameAudio";
import type { PhysicsTelemetry } from "../diagnostic/physicsTelemetry";
import type GameObject from "../GameObject";
import type Renderer from "../Renderer";
import type Scene from "../Scene";
import type { BallOffScreenIndicator } from "../ui/BallOffScreenIndicator";
import type { CreditsPanel } from "../ui/CreditsPanel";
import type { MatchMinimap } from "../ui/MatchMinimap";
import type { MatchScoreboardOverlay } from "../ui/MatchScoreboardOverlay";
import type { RlHud } from "../ui/RlHud";
import type GameInput from "../engine/input/GameInput";
import type { BallShadow } from "../visual/ballShadow";
import type { BallFloorIndicator } from "../visual/ballTracking/BallFloorIndicator";
import type { BallVfx } from "../visual/vfx/ballVfx";
import type { BallWallMarkVfx } from "../visual/vfx/ballWallMark";
import type { HitVfx } from "../visual/vfx/hitVfx";
import type { PowerUpActivationVfx } from "../visual/vfx/powerUpActivationVfx";
import type { GameSessionDeps } from "../game/GameSession";

/**
 * Full runtime bag used by main menu / pause / match bootstrap.
 * Extends GameSessionDeps with credits panel.
 */
export type RuntimeDeps = GameSessionDeps & {
	credits: CreditsPanel;
};

/** Assemble GameSessionDeps from already-constructed match world pieces. */
export function assembleGameSessionDeps(parts: {
	scene: Scene;
	renderer: Renderer;
	ball: GameObject;
	ballRadius: number;
	ballShadow: BallShadow;
	ballFloorIndicator: BallFloorIndicator;
	ballOffScreen: BallOffScreenIndicator;
	ballVfx: BallVfx;
	hitVfx: HitVfx;
	powerUpActivationVfx: PowerUpActivationVfx;
	ballWallMarkVfx: BallWallMarkVfx;
	minimap: MatchMinimap;
	scoreboardOverlay: MatchScoreboardOverlay;
	hud: RlHud;
	audio: GameAudio;
	humanInput: GameInput;
	physicsTelemetry: PhysicsTelemetry | null;
}): GameSessionDeps {
	return { ...parts };
}

export function toRuntimeDeps(
	sessionDeps: GameSessionDeps,
	credits: CreditsPanel,
): RuntimeDeps {
	return { ...sessionDeps, credits };
}
