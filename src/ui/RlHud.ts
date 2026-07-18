import { t } from "../i18n";
import type { PowerUpHudState } from "../modes/IgnitionManager";
import type { MatchPhase } from "../modes/MatchController";
import { mpsToUu } from "../util/rlPhysics";
import {
	applyPowerUpAccentVars,
	paintPowerUpHudIcon,
} from "../visual/powerUpHudIcon";
import {
	POWER_UP_RING_CIRCUMFERENCE,
	powerUpCenterTimer,
	powerUpRingFill,
	resolvePowerUpHintParts,
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
	isRanked?: boolean;
	rankedElo?: number | null;
	powerUp?: PowerUpHudState;
	onFire?: boolean;
	matchTension?: number;
	rush?: {
		active: boolean;
		nextInSec: number | null;
		phaseLeftSec: number | null;
	} | null;
	overcharge?: {
		blue: number;
		orange: number;
		activeTeam: "blue" | "orange" | null;
		activeLeftSec: number;
	} | null;
	zoneBuff?: {
		kind: "lowGrav" | "magnetic";
		leftSec: number;
	} | null;
	mutator?: {
		id: string;
		nameKey: string;
	} | null;
	meridianHalf?: "blue" | "orange" | "neutral" | null;
	/** Live possession counter (fractional) while ball is on scoring half. */
	meridianLive?: {
		team: "blue" | "orange";
		liveTotal: number;
	} | null;
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
	private readonly powerUpIconCanvas: HTMLCanvasElement;
	private readonly powerUpTimer: HTMLElement;
	private readonly powerUpTimerValue: HTMLElement;
	private readonly powerUpHint: HTMLElement;
	private goalFlashTimer = 0;
	private lastKickoffKey = "";
	private readonly onFireBadge: HTMLElement | null;
	private prevBlueScore = 0;
	private prevOrangeScore = 0;
	private readonly rushBanner: HTMLElement;
	private readonly overchargeRoot: HTMLElement;
	private readonly ocBlueFill: HTMLElement;
	private readonly ocOrangeFill: HTMLElement;
	private readonly zoneHint: HTMLElement;
	private readonly mutatorHint: HTMLElement;
	private readonly meridianHint: HTMLElement;
	private rushFlashLeft = 0;

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
		const powerUpIconCanvasEl = root.querySelector("#power-up-icon-canvas");
		if (!(powerUpIconCanvasEl instanceof HTMLCanvasElement)) {
			throw new Error("RlHud: brak #power-up-icon-canvas");
		}
		this.powerUpIconCanvas = powerUpIconCanvasEl;
		this.powerUpTimer = this.req(root, "power-up-timer");
		this.powerUpTimerValue = this.req(root, "power-up-timer-value");
		this.powerUpHint = this.req(root, "power-up-hint");
		this.onFireBadge = document.getElementById("on-fire-badge");

		this.rushBanner = this.ensureEl(root, "rush-banner", "div");
		this.rushBanner.setAttribute("aria-live", "polite");
		this.overchargeRoot = this.ensureEl(root, "overcharge-bars", "div");
		this.overchargeRoot.classList.add("overcharge-bars");
		this.ocBlueFill = this.ensureOcFill(this.overchargeRoot, "blue");
		this.ocOrangeFill = this.ensureOcFill(this.overchargeRoot, "orange");
		this.zoneHint = this.ensureEl(root, "zone-buff-hint", "div");
		this.zoneHint.setAttribute("aria-live", "polite");
		this.mutatorHint = this.ensureEl(root, "mutator-hint", "div");
		this.mutatorHint.setAttribute("aria-live", "polite");
		this.meridianHint = this.ensureEl(root, "meridian-hint", "div");
		this.meridianHint.setAttribute("aria-live", "polite");

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

		this.applyScore(this.scoreBlue, state.blueScore);
		this.applyScore(this.scoreOrange, state.orangeScore);

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
		} else if (
			state.isRanked &&
			state.rankedElo != null &&
			state.matchPhase === "playing"
		) {
			this.matchStatus.textContent = t("hud.rankedClock", {
				time: timeLabel,
				elo: state.rankedElo,
			});
		} else {
			this.matchStatus.textContent = timeLabel;
		}

		const tension = state.matchTension ?? 0;
		const tensionBand =
			tension >= 0.85
				? "critical"
				: tension >= 0.35
					? "high"
					: tension > 0.08
						? "mid"
						: "";
		this.matchStatus.dataset.tension = tensionBand;
		const scoreCenter = document.getElementById("score-center");
		if (scoreCenter) {
			scoreCenter.dataset.tension = tensionBand;
		}
		if (this.onFireBadge) {
			this.onFireBadge.classList.toggle("show", Boolean(state.onFire));
		}

		this.updateRushBanner(state, dt);
		this.updateOverchargeBars(state);
		this.updateZoneHint(state);
		this.updateMutatorHint(state);
		this.updateMeridianHint(state);

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
		applyPowerUpAccentVars(this.powerUpRing, kind);

		this.powerUpRingFill.style.strokeDashoffset = String(
			POWER_UP_RING_CIRCUMFERENCE * (1 - fill),
		);

		const timer = powerUpCenterTimer(powerUp);
		if (timer !== null) {
			this.powerUpIconCanvas.classList.add("hidden");
			this.powerUpTimer.classList.remove("hidden");
			this.powerUpTimerValue.textContent = String(timer);
		} else {
			this.powerUpIconCanvas.classList.remove("hidden");
			this.powerUpTimer.classList.add("hidden");
			paintPowerUpHudIcon(this.powerUpIconCanvas, kind);
		}

		const hint = resolvePowerUpHintParts(powerUp);
		this.powerUpHint.textContent = hint.suffixKey
			? `${t(hint.labelKey)} · ${t(hint.suffixKey)}`
			: t(hint.labelKey);
		if (powerUp.held && ready && !active) {
			this.powerUpHint.dataset.kind = powerUp.held;
		} else {
			delete this.powerUpHint.dataset.kind;
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
			this.kickoffBanner.textContent = "IGNITION";
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

	private updateRushBanner(state: RlHudState, dt: number): void {
		const rush = state.rush;
		if (!rush) {
			this.rushBanner.classList.remove("show", "rush-active");
			this.rushBanner.textContent = "";
			this.rushFlashLeft = 0;
			return;
		}

		if (rush.active) {
			if (this.rushFlashLeft <= 0 && !this.rushBanner.classList.contains("rush-active")) {
				this.rushFlashLeft = 1.8;
			}
			this.rushBanner.classList.add("show", "rush-active");
			const left = rush.phaseLeftSec ?? 0;
			this.rushBanner.textContent =
				this.rushFlashLeft > 0.6
					? t("hud.rush")
					: t("hud.rushLeft", { sec: Math.ceil(left) });
			this.rushFlashLeft = Math.max(0, this.rushFlashLeft - dt);
			return;
		}

		this.rushBanner.classList.remove("rush-active");
		const next = rush.nextInSec;
		if (next != null && next <= 12 && state.matchPhase === "playing") {
			this.rushBanner.classList.add("show");
			this.rushBanner.textContent = t("hud.rushSoon", {
				sec: Math.ceil(next),
			});
		} else {
			this.rushBanner.classList.remove("show");
			this.rushBanner.textContent = "";
		}
		this.rushFlashLeft = 0;
	}

	private updateOverchargeBars(state: RlHudState): void {
		const oc = state.overcharge;
		if (!oc || state.isFFA) {
			this.overchargeRoot.classList.add("hidden");
			return;
		}
		this.overchargeRoot.classList.remove("hidden");
		const blue = Math.min(1, Math.max(0, oc.blue));
		const orange = Math.min(1, Math.max(0, oc.orange));
		this.ocBlueFill.style.transform = `scaleX(${blue})`;
		this.ocOrangeFill.style.transform = `scaleX(${orange})`;
		this.overchargeRoot.dataset.active = oc.activeTeam ?? "";
		this.overchargeRoot.classList.toggle("oc-firing", Boolean(oc.activeTeam));
		if (oc.activeTeam && oc.activeLeftSec > 0) {
			this.overchargeRoot.dataset.left = String(Math.ceil(oc.activeLeftSec));
		} else {
			delete this.overchargeRoot.dataset.left;
		}
	}

	private updateZoneHint(state: RlHudState): void {
		const buff = state.zoneBuff;
		if (!buff) {
			this.zoneHint.classList.remove("show");
			this.zoneHint.textContent = "";
			this.zoneHint.dataset.kind = "";
			return;
		}
		this.zoneHint.classList.add("show");
		this.zoneHint.dataset.kind = buff.kind;
		const key =
			buff.kind === "lowGrav" ? "hud.zoneLowGrav" : "hud.zoneMagnetic";
		this.zoneHint.textContent = t(key);
	}

	private updateMutatorHint(state: RlHudState): void {
		const mut = state.mutator;
		if (!mut) {
			this.mutatorHint.classList.remove("show");
			this.mutatorHint.textContent = "";
			return;
		}
		this.mutatorHint.classList.add("show");
		this.mutatorHint.textContent = t("hud.mutator", {
			name: t(mut.nameKey as never),
		});
	}

	private updateMeridianHint(state: RlHudState): void {
		/** Live counter pod scoreboardem był zbędny — wynik jest na tablicy. */
		void state;
		this.meridianHint.classList.remove("show");
		this.meridianHint.textContent = "";
		this.meridianHint.dataset.half = "";
	}

	private ensureEl(
		parent: HTMLElement,
		id: string,
		tag: keyof HTMLElementTagNameMap,
	): HTMLElement {
		let el = document.getElementById(id);
		if (!el) {
			el = document.createElement(tag);
			el.id = id;
			parent.appendChild(el);
		}
		return el;
	}

	private ensureOcFill(root: HTMLElement, team: "blue" | "orange"): HTMLElement {
		let bar = root.querySelector<HTMLElement>(`.oc-bar--${team}`);
		if (!bar) {
			bar = document.createElement("div");
			bar.className = `oc-bar oc-bar--${team}`;
			const fill = document.createElement("div");
			fill.className = "oc-bar__fill";
			fill.id = `oc-${team}-fill`;
			bar.appendChild(fill);
			root.appendChild(bar);
			return fill;
		}
		return bar.querySelector(".oc-bar__fill") ?? bar;
	}

	private req(parent: HTMLElement, id: string): HTMLElement {
		const el = parent.querySelector<HTMLElement>(`#${id}`);
		if (!el) throw new Error(`RlHud: brak #${id}`);
		return el;
	}

	private applyScore(el: HTMLElement, score: number): void {
		const prev =
			el === this.scoreBlue ? this.prevBlueScore : this.prevOrangeScore;
		if (score !== Number(el.textContent)) {
			el.textContent = String(score);
		}
		if (score > prev) {
			el.classList.remove("team-score--pop");
			void el.offsetWidth;
			el.classList.add("team-score--pop");
		}
		if (el === this.scoreBlue) this.prevBlueScore = score;
		else this.prevOrangeScore = score;
	}
}
