import { t } from "../i18n";
import type { PowerUpHudState } from "../modes/IgnitionManager";
import type { MatchPhase } from "../modes/MatchController";
import { mpsToUu } from "../util/rlPhysics";
import { powerUpIconSymbolId } from "../visual/powerUpIcons";
import {
	POWER_UP_RING_CIRCUMFERENCE,
	powerUpCenterTimer,
	powerUpRingFill,
	resolvePowerUpVisualKind,
} from "../visual/powerUpVisuals";

export type RlHudState = {
	boost: number;
	speedMps: number;
	ballCam: boolean;
	boosting: boolean;
	blueScore: number;
	orangeScore: number;
	goalTeam: "blue" | "orange" | null;
	resetCountdown: number | null;
	matchTimeSec: number;
	matchPhase: MatchPhase;
	countdownSec: number | null;
	kickoffTick: number | null;
	kickoffIgnite: boolean;
	overtimeBanner: boolean;
	isOvertime: boolean;
	isFFA: boolean;
	ffaScores: { name: string; score: number; isHuman: boolean }[];
	goalScorerName: string | null;
	winnerLabel: string | null;
	modeLabel: string;
	replayActive?: boolean;
	goalSpectacle?: boolean;
	rankedSubtitle?: string | null;
	rematchHost?: boolean;
	rematchGuestWait?: boolean;
	powerUp?: PowerUpHudState;
};

/** Supersonic ≈ 2200 uu/s (RLBot wiki). */
const SUPERSONIC_UU = 2200;

const BOOST_RING_RADIUS = 40;
const BOOST_RING_CIRCUMFERENCE = 2 * Math.PI * BOOST_RING_RADIUS;

function formatTime(sec: number): string {
	const s = Math.max(0, Math.ceil(sec));
	const m = Math.floor(s / 60);
	const r = s % 60;
	return `${m}:${String(r).padStart(2, "0")}`;
}

export class RlHud {
	private readonly boostRingFill: SVGCircleElement;
	private readonly boostNumber: HTMLElement;
	private readonly boostRing: HTMLElement;
	private readonly speedVal: HTMLElement;
	private readonly speedPanel: HTMLElement;
	private readonly scoreBlue: HTMLElement;
	private readonly scoreOrange: HTMLElement;
	private readonly matchStatus: HTMLElement;
	private readonly camIndicator: HTMLElement;
	private readonly goalBanner: HTMLElement;
	private readonly kickoffBanner: HTMLElement;
	private readonly ignitionScorePanel: HTMLElement;
	private readonly ignitionScoreNumber: HTMLElement;
	private readonly ignitionScoreLabel: HTMLElement;
	private readonly endBanner: HTMLElement;
	private readonly endSubBanner: HTMLElement;
	private readonly rematchBtn: HTMLElement;
	private readonly rematchWait: HTMLElement;
	private readonly powerUpPanel: HTMLElement;
	private readonly powerUpRing: HTMLElement;
	private readonly powerUpRingFill: SVGCircleElement;
	private readonly powerUpIcon: SVGSVGElement;
	private readonly powerUpIconUse: SVGUseElement;
	private readonly powerUpTimer: HTMLElement;
	private readonly powerUpTimerValue: HTMLElement;
	private readonly powerUpHint: HTMLElement;
	private goalFlashTimer = 0;
	private lastKickoffKey = "";

	constructor(root: HTMLElement = document.getElementById("hud")!) {
		const ringFill = root.querySelector("#boost-ring-fill");
		if (!(ringFill instanceof SVGCircleElement)) {
			throw new Error("RlHud: brak #boost-ring-fill");
		}
		this.boostRingFill = ringFill;
		this.boostNumber = this.req(root, "boost-number");
		this.boostRing = this.req(root, "boost-ring");
		this.speedVal = this.req(root, "speed-val");
		this.speedPanel = this.req(root, "speed-panel");
		this.scoreBlue = this.req(root, "score-blue");
		this.scoreOrange = this.req(root, "score-orange");
		this.matchStatus = this.req(root, "match-status");
		const camEl = document.getElementById("cam-indicator");
		if (!camEl) throw new Error("RlHud: brak #cam-indicator");
		this.camIndicator = camEl;
		this.goalBanner = this.req(root, "goal-banner");
		this.kickoffBanner = this.req(root, "kickoff-banner");
		this.ignitionScorePanel = this.req(root, "ignition-score-panel");
		this.ignitionScoreNumber = this.req(root, "ignition-score-number");
		this.ignitionScoreLabel = this.req(root, "ignition-score-label");
		this.endBanner = this.req(root, "match-end-banner");
		this.endSubBanner = this.req(root, "match-end-sub");
		this.rematchBtn = this.req(root, "match-rematch");
		this.rematchWait = this.req(root, "match-rematch-wait");
		this.powerUpPanel = this.req(root, "power-up-panel");
		const powerUpRingFillEl = root.querySelector("#power-up-ring-fill");
		if (!(powerUpRingFillEl instanceof SVGCircleElement)) {
			throw new Error("RlHud: brak #power-up-ring-fill");
		}
		this.powerUpRingFill = powerUpRingFillEl;
		this.powerUpRing = this.req(root, "power-up-ring");
		const powerUpIconEl = root.querySelector("#power-up-icon");
		const powerUpIconUseEl = root.querySelector("#power-up-icon-use");
		if (!(powerUpIconEl instanceof SVGSVGElement)) {
			throw new Error("RlHud: brak #power-up-icon");
		}
		if (!(powerUpIconUseEl instanceof SVGUseElement)) {
			throw new Error("RlHud: brak #power-up-icon-use");
		}
		this.powerUpIcon = powerUpIconEl;
		this.powerUpIconUse = powerUpIconUseEl;
		this.powerUpTimer = this.req(root, "power-up-timer");
		this.powerUpTimerValue = this.req(root, "power-up-timer-value");
		this.powerUpHint = this.req(root, "power-up-hint");

		this.boostRingFill.style.strokeDasharray = String(BOOST_RING_CIRCUMFERENCE);
		this.powerUpRingFill.style.strokeDasharray = String(
			POWER_UP_RING_CIRCUMFERENCE,
		);
	}

	update(state: RlHudState, dt: number): void {
		const boostPct = Math.round(Math.min(1, Math.max(0, state.boost)) * 100);
		this.boostRingFill.style.strokeDashoffset = String(
			BOOST_RING_CIRCUMFERENCE * (1 - boostPct / 100),
		);
		this.boostNumber.textContent = String(boostPct);
		const isLow = boostPct <= 20;
		this.boostNumber.dataset.low = isLow ? "1" : "0";
		this.boostRing.dataset.low = isLow ? "1" : "0";
		this.boostRing.classList.toggle("boosting", state.boosting && boostPct > 0);
		this.boostRing.classList.toggle("empty", boostPct <= 0);

		const speedKmh = Math.round(state.speedMps * 3.6);
		const speedUu = mpsToUu(state.speedMps);
		const isSupersonic = speedUu >= SUPERSONIC_UU;
		this.speedVal.textContent = String(speedKmh);
		this.speedPanel.classList.toggle("supersonic", isSupersonic);
		this.speedPanel.dataset.supersonic = isSupersonic ? "1" : "0";
		this.boostRing.classList.toggle("supersonic", isSupersonic);
		this.boostRing.dataset.supersonic = isSupersonic ? "1" : "0";
		this.boostNumber.dataset.supersonic = isSupersonic ? "1" : "0";

		this.scoreBlue.textContent = String(state.blueScore);
		this.scoreOrange.textContent = String(state.orangeScore);

		this.camIndicator.textContent = state.ballCam
			? t("hud.ballCam")
			: t("hud.freeCam");
		this.camIndicator.classList.toggle("active", state.ballCam);
		this.camIndicator.classList.toggle("free-cam", !state.ballCam);

		const timeLabel = formatTime(state.matchTimeSec);
		if (state.matchPhase === "finished") {
			this.matchStatus.textContent = t("hud.matchEnd");
		} else if (
			state.matchPhase === "countdown" ||
			state.kickoffTick !== null ||
			state.kickoffIgnite ||
			state.overtimeBanner
		) {
			this.matchStatus.textContent = "—";
		} else if (state.isOvertime && state.matchPhase === "playing") {
			this.matchStatus.textContent = "OT";
		} else {
			this.matchStatus.textContent = timeLabel;
		}

		if (state.isFFA) {
			this.ignitionScorePanel.classList.remove("hidden");
			this.ignitionScoreLabel.textContent = t("hud.ffaYou");
			const you = state.ffaScores.find((e) => e.isHuman);
			this.ignitionScoreNumber.textContent = String(you?.score ?? 0);
		} else {
			this.ignitionScorePanel.classList.add("hidden");
		}

		const scoreboard = document.getElementById("scoreboard");
		if (scoreboard) {
			scoreboard.classList.toggle("ffa-mode", state.isFFA);
		}

		if (state.matchPhase === "finished" && state.winnerLabel) {
			this.endBanner.textContent = state.winnerLabel;
			this.endBanner.classList.add("show");
			if (state.rankedSubtitle) {
				this.endSubBanner.textContent = state.rankedSubtitle;
				this.endSubBanner.classList.add("show");
			} else {
				this.endSubBanner.textContent = "";
				this.endSubBanner.classList.remove("show");
			}
		} else {
			this.endBanner.classList.remove("show");
			this.endSubBanner.classList.remove("show");
		}

		this.rematchBtn.classList.toggle("show", Boolean(state.rematchHost));
		this.rematchBtn.classList.toggle("hidden", !state.rematchHost);
		this.rematchWait.classList.toggle("show", Boolean(state.rematchGuestWait));
		this.rematchWait.classList.toggle("hidden", !state.rematchGuestWait);

		if (state.goalTeam) {
			this.goalFlashTimer = state.goalSpectacle ? 3.6 : 2.4;
			if (state.isFFA && state.goalScorerName) {
				this.goalBanner.textContent = t("hud.goalPlayer", {
					name: state.goalScorerName,
				});
			} else {
				this.goalBanner.textContent =
					state.goalTeam === "blue" ? t("hud.goalBlue") : t("hud.goalOrange");
			}
			this.goalBanner.dataset.team = state.goalTeam;
			this.goalBanner.classList.remove("show", "celebrate");
			void this.goalBanner.offsetWidth;
			this.goalBanner.classList.add("show", "celebrate");
		}

		if (this.goalFlashTimer > 0) {
			this.goalFlashTimer -= dt;
			if (this.goalFlashTimer <= 0) {
				this.goalBanner.classList.remove("show", "celebrate");
			}
		}

		this.updateKickoffBanner(state);
		this.updatePowerUpPanel(state.powerUp, state.matchPhase);
	}

	private updatePowerUpPanel(
		powerUp: PowerUpHudState | undefined,
		phase: MatchPhase,
	): void {
		if (!powerUp?.enabled || phase === "finished") {
			this.powerUpPanel.classList.add("hidden");
			this.powerUpRing.dataset.ready = "0";
			this.powerUpRing.dataset.active = "0";
			return;
		}

		this.powerUpPanel.classList.remove("hidden");

		const kind = resolvePowerUpVisualKind(powerUp) ?? "charging";
		const fill = powerUpRingFill(powerUp);
		const ready = powerUp.held !== null;
		const active = powerUp.activeKind !== null && powerUp.activeProgress > 0;

		this.powerUpRing.dataset.kind = kind;
		this.powerUpRing.dataset.ready = ready && !active ? "1" : "0";
		this.powerUpRing.dataset.active = active ? "1" : "0";

		this.powerUpRingFill.style.strokeDashoffset = String(
			POWER_UP_RING_CIRCUMFERENCE * (1 - fill),
		);

		const timer = powerUpCenterTimer(powerUp);
		if (timer !== null) {
			this.powerUpIcon.classList.add("hidden");
			this.powerUpTimer.classList.remove("hidden");
			this.powerUpTimerValue.textContent = String(timer);
		} else {
			this.powerUpIcon.classList.remove("hidden");
			this.powerUpTimer.classList.add("hidden");
			this.powerUpIconUse.setAttribute("href", `#${powerUpIconSymbolId(kind)}`);
		}

		if (active && powerUp.activeKind) {
			this.powerUpHint.textContent = t(`powerup.${powerUp.activeKind}`);
		} else if (ready && powerUp.held) {
			this.powerUpHint.textContent = t("hud.powerUpUse");
		} else {
			this.powerUpHint.textContent = t("hud.powerUpCharging");
		}
	}

	private updateKickoffBanner(state: RlHudState): void {
		if (state.replayActive) {
			this.kickoffBanner.textContent = t("hud.replay");
			this.kickoffBanner.classList.remove(
				"kickoff-digit",
				"kickoff-ignite",
				"kickoff-overtime",
				"countdown-pop",
			);
			this.kickoffBanner.classList.add("show", "replay-mode");
			this.lastKickoffKey = "replay";
			return;
		}

		if (this.lastKickoffKey === "replay") {
			this.kickoffBanner.classList.remove("replay-mode");
		}

		if (this.goalFlashTimer > 0) {
			this.kickoffBanner.classList.remove(
				"show",
				"kickoff-digit",
				"kickoff-ignite",
				"kickoff-overtime",
				"countdown-pop",
			);
			return;
		}

		const key = state.overtimeBanner
			? "overtime"
			: state.kickoffIgnite
				? "ignite"
				: state.kickoffTick !== null && state.kickoffTick > 0
					? `tick-${state.kickoffTick}`
					: "";

		if (!key) {
			this.kickoffBanner.classList.remove(
				"show",
				"kickoff-digit",
				"kickoff-ignite",
				"kickoff-overtime",
				"countdown-pop",
			);
			this.lastKickoffKey = "";
			return;
		}

		if (key === this.lastKickoffKey) return;
		this.lastKickoffKey = key;

		this.kickoffBanner.classList.remove(
			"show",
			"kickoff-digit",
			"kickoff-ignite",
			"kickoff-overtime",
			"countdown-pop",
		);
		void this.kickoffBanner.offsetWidth;

		if (state.overtimeBanner) {
			this.kickoffBanner.textContent = t("hud.overtime");
			this.kickoffBanner.classList.add(
				"show",
				"kickoff-ignite",
				"kickoff-overtime",
				"countdown-pop",
			);
			return;
		}

		if (state.kickoffIgnite) {
			this.kickoffBanner.textContent = "IGN!TE!";
			this.kickoffBanner.classList.add(
				"show",
				"kickoff-ignite",
				"countdown-pop",
			);
			return;
		}

		this.kickoffBanner.textContent = String(state.kickoffTick);
		this.kickoffBanner.classList.add("show", "kickoff-digit", "countdown-pop");
	}

	private req(parent: HTMLElement, id: string): HTMLElement {
		const el = parent.querySelector<HTMLElement>(`#${id}`);
		if (!el) throw new Error(`RlHud: brak #${id}`);
		return el;
	}
}
