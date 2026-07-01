import type RAPIER from "@dimforge/rapier3d-compat";
import type GameObject from "../../GameObject";
import type { GoalTouchContext } from "../../game/BallTouchTracker";
import type { CarEntity } from "../../game/CarEntity";
import type { GameModeId, ScoringTeam } from "../../game/modes";
import type { IgnitionManager } from "../../modes/IgnitionManager";
import { isArenaCollider } from "../../util/rlContacts";
import { BallSurfaceTracker } from "./ballSurfaceTracker";
import {
	MatchMomentHighlight,
	type MatchMomentSpec,
	pickAssistMoment,
	pickDemoMoment,
	pickGoalMoment,
	pickHumanHitMoment,
} from "./matchMoments";

const DOUBLE_TAP_WINDOW = 0.85;

export class MatchMomentsController {
	readonly highlight = new MatchMomentHighlight();
	private readonly surface = new BallSurfaceTracker();
	private humanGoalStreak = 0;
	private humanDemoTimes: number[] = [];
	private lastHumanDemoTime = -999;
	private lastHumanAirTouchTime = -999;
	private pendingDemoScoreWindow = false;
	private matchTimeSec = 0;

	reset(): void {
		this.surface.reset();
		this.humanGoalStreak = 0;
		this.humanDemoTimes = [];
		this.lastHumanDemoTime = -999;
		this.lastHumanAirTouchTime = -999;
		this.pendingDemoScoreWindow = false;
		this.matchTimeSec = 0;
	}

	setMatchTime(sec: number): void {
		this.matchTimeSec = sec;
	}

	sampleSurfaces(world: RAPIER.World, ball: GameObject, nowSec: number): void {
		this.surface.sample(world, ball, nowSec, isArenaCollider);
	}

	onHumanBallHit(input: {
		impact: number;
		ballY: number;
		inAir: boolean;
		flipping: boolean;
		onWall: boolean;
	}): void {
		const moment = pickHumanHitMoment({
			...input,
			matchTimeSec: this.matchTimeSec,
		});
		if (moment) {
			this.highlight.trigger(moment);
		}

		if (input.inAir && input.ballY >= 1.2) {
			const gap = this.matchTimeSec - this.lastHumanAirTouchTime;
			if (gap > 0 && gap <= DOUBLE_TAP_WINDOW) {
				this.doubleTapPrimed = true;
			}
			this.lastHumanAirTouchTime = this.matchTimeSec;
		}
	}

	private doubleTapPrimed = false;

	consumeDoubleTapReady(): boolean {
		const ready = this.doubleTapPrimed;
		this.doubleTapPrimed = false;
		return ready;
	}

	onHumanDemo(impact: number, speedMps: number): void {
		this.humanDemoTimes.push(this.matchTimeSec);
		this.humanDemoTimes = this.humanDemoTimes.filter(
			(t) => this.matchTimeSec - t < 5,
		);
		this.lastHumanDemoTime = this.matchTimeSec;
		this.pendingDemoScoreWindow = true;

		const moment = pickDemoMoment(
			{
				impact,
				humanAttacker: true,
				humanSpeedMps: speedMps,
				matchTimeSec: this.matchTimeSec,
			},
			this.humanDemoTimes.length,
			false,
		);
		if (moment) {
			this.highlight.trigger(moment);
		}
	}

	onGoal(params: {
		scoringTeam: ScoringTeam;
		touch: GoalTouchContext;
		cars: CarEntity[];
		humanCar: CarEntity;
		mode: GameModeId;
		isOvertime: boolean;
		isGoldenGoal: boolean;
		isKickoffWindow: boolean;
		timeRemainingSec: number;
		matchEndsAfterGoal: boolean;
		ignition: IgnitionManager;
	}): void {
		const { humanCar, touch, cars } = params;
		const scorer = touch.scorerSlot
			? cars.find((c) => c.slotIndex === touch.scorerSlot)
			: null;
		const humanScored = scorer?.isHuman ?? false;
		const scoredSoonAfterDemo =
			this.pendingDemoScoreWindow &&
			humanScored &&
			this.matchTimeSec - this.lastHumanDemoTime < 4;

		if (scoredSoonAfterDemo) {
			const demoScore = pickDemoMoment(
				{
					impact: 12,
					humanAttacker: true,
					humanSpeedMps: 0,
					matchTimeSec: this.matchTimeSec,
				},
				this.humanDemoTimes.length,
				true,
			);
			if (demoScore && this.highlight.trigger(demoScore)) {
				this.pendingDemoScoreWindow = false;
				this.updateHumanGoalStreak(humanScored);
				return;
			}
		}
		this.pendingDemoScoreWindow = false;

		if (humanScored) {
			this.humanGoalStreak++;
		} else {
			this.humanGoalStreak = 0;
		}

		const hadPowerUp =
			params.ignition.isEnabled() &&
			params.ignition.hasPowerUpEngaged(humanCar.slotIndex);

		const goalMoment = pickGoalMoment({
			scoringTeam: params.scoringTeam,
			touch,
			cars,
			humanCar,
			mode: params.mode,
			isOvertime: params.isOvertime,
			isGoldenGoal: params.isGoldenGoal,
			isKickoffWindow: params.isKickoffWindow,
			matchTimeSec: this.matchTimeSec,
			timeRemainingSec: params.timeRemainingSec,
			matchEndsAfterGoal: params.matchEndsAfterGoal,
			humanGoalStreak: this.humanGoalStreak,
			hadPowerUp,
			recentWall: this.surface.recentWall(this.matchTimeSec),
			recentCeiling: this.surface.recentCeiling(this.matchTimeSec),
			doubleTapReady: this.consumeDoubleTapReady(),
		});

		if (goalMoment) {
			this.highlight.trigger(goalMoment);
			return;
		}

		if (touch.assistSlot !== null) {
			const assistCar = cars.find((c) => c.slotIndex === touch.assistSlot);
			const assistMoment = pickAssistMoment(assistCar, touch.prevTouch);
			if (assistMoment) {
				this.highlight.trigger(assistMoment);
			}
		}
	}

	private updateHumanGoalStreak(humanScored: boolean): void {
		if (humanScored) this.humanGoalStreak++;
		else this.humanGoalStreak = 0;
	}

	triggerIfHigher(specIn: MatchMomentSpec): void {
		if (!this.highlight.isActive()) {
			this.highlight.trigger(specIn);
		}
	}
}
