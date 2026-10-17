import { t, type I18nKey } from "../i18n";
import { getEquippedBannerId } from "../meta/PlayerInventory";
import type { PowerUpHudState } from "../modes/IgnitionManager";
import type { MatchPhase } from "../modes/MatchController";
import { mpsToUu } from "../util/rlPhysics";
import { applyPlayerBannerStyle } from "../visual/playerBannerUi";
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
	/** Toast alt rigu (V) — klucz i18n lub null. */
	camRigToastKey?: I18nKey | null;
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
	mvpName?: string | null;
	mvpScore?: number | null;
	podiumLeftSec?: number | null;
	podiumTitle?: string | null;
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
		descKey?: string;
	} | null;
	/** Field Energy mode (Rush stack) — one-shot announce. */
	fieldEnergy?: boolean;
	/** Ignition Storm = Rush ∩ Overcharge (Ignite-only). */
	storm?: {
		active: boolean;
		team: "blue" | "orange" | null;
		intensity: number;
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
	private readonly kickoffStage: HTMLElement | null;
	private readonly kickoffLabel: HTMLElement | null;
	private readonly kickoffHalo: HTMLElement | null;
	private readonly kickoffEmbers: HTMLElement | null;
	private readonly kickoffRays: HTMLElement | null;
	private readonly kickoffRaysAlt: HTMLElement | null;
	private readonly kickoffCore: HTMLElement | null;
	private readonly kickoffScan: HTMLElement | null;
	private readonly kickoffFlare: HTMLElement | null;
	private readonly kickoffGrid: HTMLElement | null;
	private readonly kickoffHeat: HTMLElement | null;
	private readonly kickoffArcs: HTMLElement | null;
	private readonly kickoffSparks: HTMLElement | null;
	private readonly kickoffBoom: HTMLElement | null;
	private readonly kickoffImpactFlash: HTMLElement | null;
	private readonly kickoffImpactSlam: HTMLElement | null;
	private readonly kickoffImpactShock: HTMLElement | null;
	private readonly kickoffImpactRing: HTMLElement | null;
	private readonly kickoffImpactRing2: HTMLElement | null;
	private readonly ignitionScorePanel: HTMLElement;
	private readonly ignitionScoreNumber: HTMLElement;
	private readonly ignitionScoreLabel: HTMLElement;
	private readonly endBanner: HTMLElement;
	private readonly endSubBanner: HTMLElement;
	private readonly endMvp: HTMLElement;
	private readonly podiumBanner: HTMLElement;
	private readonly podiumHint: HTMLElement;
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
	private prevBoostPct = -1;
	private boostPickupFlashLeft = 0;
	private readonly rushBanner: HTMLElement;
	private readonly overchargeRoot: HTMLElement;
	private readonly ocBlueFill: HTMLElement;
	private readonly ocOrangeFill: HTMLElement;
	private readonly zoneHint: HTMLElement;
	private readonly mutatorHint: HTMLElement;
	private readonly meridianHint: HTMLElement;
	private rushFlashLeft = 0;
	private stormFlashLeft = 0;
	private mutatorAnnounceLeft = 0;
	private fieldEnergyAnnounceLeft = 0;
	private lastMutatorId = "";
	private fieldEnergyAnnounced = false;
	private lastStormActive = false;

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
		this.kickoffStage = document.getElementById("kickoff-stage");
		this.kickoffLabel = document.getElementById("kickoff-label");
		this.kickoffHalo = document.getElementById("kickoff-halo");
		this.kickoffEmbers = document.getElementById("kickoff-embers");
		this.kickoffRays = document.getElementById("kickoff-rays");
		this.kickoffRaysAlt = document.getElementById("kickoff-rays-alt");
		this.kickoffCore = document.getElementById("kickoff-core");
		this.kickoffScan = document.getElementById("kickoff-scan");
		this.kickoffFlare = document.getElementById("kickoff-flare");
		this.kickoffGrid = document.getElementById("kickoff-grid");
		this.kickoffHeat = document.getElementById("kickoff-heat");
		this.kickoffArcs = document.getElementById("kickoff-arcs");
		this.kickoffSparks = document.getElementById("kickoff-sparks");
		this.kickoffBoom = document.getElementById("kickoff-boom");
		this.kickoffImpactFlash = document.getElementById("kickoff-impact-flash");
		this.kickoffImpactSlam = document.getElementById("kickoff-impact-slam");
		this.kickoffImpactShock = document.getElementById("kickoff-impact-shock");
		this.kickoffImpactRing = document.getElementById("kickoff-impact-ring");
		this.kickoffImpactRing2 = document.getElementById("kickoff-impact-ring2");
		this.ignitionScorePanel = this.req(root, "ignition-score-panel");
		this.ignitionScoreNumber = this.req(root, "ignition-score-number");
		this.ignitionScoreLabel = this.req(root, "ignition-score-label");
		this.endBanner = this.req(root, "match-end-banner");
		this.endSubBanner = this.req(root, "match-end-sub");
		this.endMvp = this.ensureEl(root, "match-end-mvp", "div");
		this.endMvp.classList.add("match-end-mvp");
		this.endMvp.setAttribute("aria-live", "polite");
		this.podiumBanner = this.ensureEl(root, "match-podium-banner", "div");
		this.podiumBanner.classList.add("match-podium-banner");
		this.podiumBanner.setAttribute("aria-live", "polite");
		this.podiumHint = this.ensureEl(root, "match-podium-hint", "div");
		this.podiumHint.classList.add("match-podium-hint");
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
		/** Snappy ring fill — bez lagującego lerp (czytelność RL). */
		this.boostRingFill.style.strokeDashoffset = String(
			BOOST_RING_CIRCUMFERENCE * (1 - boostPct / 100),
		);
		this.boostRingFill.style.transition = "stroke-dashoffset 0.08s linear";
		this.boostNumber.textContent = String(boostPct);
		const isLow = boostPct <= 20;
		this.boostNumber.dataset.low = isLow ? "1" : "0";
		this.boostRing.dataset.low = isLow ? "1" : "0";
		this.boostRing.classList.toggle("boosting", state.boosting && boostPct > 0);
		this.boostRing.classList.toggle("empty", boostPct <= 0);

		/** RL: krótki pulse pierścienia przy zbieraniu pada (≥ small pad ~12%). */
		if (this.prevBoostPct >= 0 && boostPct - this.prevBoostPct >= 10) {
			this.boostPickupFlashLeft = boostPct - this.prevBoostPct >= 80 ? 0.28 : 0.18;
			this.boostRing.classList.remove("pad-pickup");
			void this.boostRing.offsetWidth;
			this.boostRing.classList.add("pad-pickup");
		}
		this.prevBoostPct = boostPct;
		if (this.boostPickupFlashLeft > 0) {
			this.boostPickupFlashLeft = Math.max(0, this.boostPickupFlashLeft - dt);
			if (this.boostPickupFlashLeft <= 0) {
				this.boostRing.classList.remove("pad-pickup");
			}
		}

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

		if (state.camRigToastKey) {
			this.camIndicator.textContent = t(state.camRigToastKey);
			this.camIndicator.classList.add("alt-rig-toast");
			this.camIndicator.classList.remove("active", "free-cam");
		} else {
			this.camIndicator.classList.remove("alt-rig-toast");
			this.camIndicator.textContent = state.ballCam
				? t("hud.ballCam")
				: t("hud.freeCam");
			this.camIndicator.classList.toggle("active", state.ballCam);
			this.camIndicator.classList.toggle("free-cam", !state.ballCam);
		}

		const timeLabel = formatTime(state.matchTimeSec);
		if (state.matchPhase === "finished") {
			this.matchStatus.textContent = t("hud.matchEnd");
		} else if (state.matchPhase === "podium") {
			this.matchStatus.textContent = t("hud.podium");
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
		this.updateMutatorHint(state, dt);
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

		if (state.matchPhase === "podium" || state.matchPhase === "finished") {
			/** Celebracja = osobny ekran (PostMatchCelebrationOverlay). */
			this.podiumBanner.classList.remove("show");
			this.podiumHint.classList.remove("show");
			this.endBanner.classList.remove("show");
			this.endSubBanner.classList.remove("show");
			this.endMvp.classList.remove("show");
			this.rematchBtn.classList.remove("show");
			this.rematchBtn.classList.add("hidden");
			this.rematchWait.classList.remove("show");
			this.rematchWait.classList.add("hidden");
		} else {
			this.podiumBanner.classList.remove("show");
			this.podiumHint.classList.remove("show");
			this.endBanner.classList.remove("show");
			this.endSubBanner.classList.remove("show");
			this.endMvp.classList.remove("show");
			this.rematchBtn.classList.toggle("show", Boolean(state.rematchHost));
			this.rematchBtn.classList.toggle("hidden", !state.rematchHost);
			this.rematchWait.classList.toggle("show", Boolean(state.rematchGuestWait));
			this.rematchWait.classList.toggle("hidden", !state.rematchGuestWait);
		}

		if (state.goalTeam) {
			this.goalFlashTimer = state.goalSpectacle ? 2.8 : 1.85;
			if (state.isFFA && state.goalScorerName) {
				this.goalBanner.textContent = t("hud.goalPlayer", {
					name: state.goalScorerName,
				});
			} else {
				this.goalBanner.textContent =
					state.goalTeam === "blue" ? t("hud.goalBlue") : t("hud.goalOrange");
			}
			this.goalBanner.dataset.team = state.goalTeam;
			/** RL: banner wokół napisu gola / nicku, nie 3D za autem. */
			applyPlayerBannerStyle(this.goalBanner, getEquippedBannerId());
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
		if (!powerUp?.enabled || phase === "finished" || phase === "podium") {
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
		if (state.goalSpectacle) {
			/** Skip hint niepotrzebny — jump nadal pomija w GameSession. */
			this.hideKickoffStage();
			this.kickoffBanner.classList.remove(
				"show",
				"spectacle-skip",
				"kickoff-digit",
				"kickoff-ignite",
				"kickoff-overtime",
				"countdown-pop",
				"kickoff-word",
				"kickoff-slide-left",
				"kickoff-slide-right",
				"replay-mode",
			);
			this.kickoffBanner.textContent = "";
			this.lastKickoffKey = "spectacle";
			return;
		}

		this.kickoffBanner.classList.remove("spectacle-skip");

		if (state.replayActive) {
			this.hideKickoffStage();
			this.kickoffBanner.textContent = t("hud.replay");
			delete this.kickoffBanner.dataset.glow;
			delete this.kickoffBanner.dataset.tick;
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
			this.hideKickoffStage();
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
			this.hideKickoffStage();
			this.kickoffBanner.classList.remove(
				"show",
				"kickoff-digit",
				"kickoff-ignite",
				"kickoff-overtime",
				"countdown-pop",
			);
			delete this.kickoffBanner.dataset.tick;
			delete this.kickoffBanner.dataset.glow;
			this.clearKickoffShake();
			this.lastKickoffKey = "";
			return;
		}

		this.syncKickoffStage(state);

		if (key === this.lastKickoffKey) return;
		this.lastKickoffKey = key;

		this.kickoffBanner.classList.remove(
			"show",
			"kickoff-digit",
			"kickoff-ignite",
			"kickoff-overtime",
			"countdown-pop",
			"kickoff-word",
			"kickoff-slide-left",
			"kickoff-slide-right",
		);
		void this.kickoffBanner.offsetWidth;

		this.renderKickoffWordBanner(state);
		this.pulseKickoffLabel(state);
		if (state.overtimeBanner || state.kickoffIgnite) {
			this.pulseKickoffImpact("ignite");
		} else {
			this.pulseKickoffImpact(
				state.kickoffTick != null && state.kickoffTick <= 1 ? "one" : "tick",
			);
		}
	}

	private syncKickoffStage(state: RlHudState): void {
		const stage = this.kickoffStage;
		if (!stage) return;
		stage.classList.add("show");
		if (state.kickoffIgnite || state.overtimeBanner) {
			stage.dataset.kind = "ignite";
			delete stage.dataset.tick;
			stage.style.setProperty("--kickoff-through", "0");
			return;
		}
		delete stage.dataset.kind;
		const tick = state.kickoffTick;
		if (tick != null) stage.dataset.tick = String(tick);
		else delete stage.dataset.tick;
		const left = state.countdownSec;
		const through =
			tick != null && left != null
				? Math.min(1, Math.max(0, tick - left))
				: 0;
		stage.style.setProperty("--kickoff-through", through.toFixed(4));
	}

	/** Eyebrow tylko na zmianę ticka — nie co klatkę. */

	/** Kickoff jako naprzemienne napisy (slide L/R) + litery z fill jak boot/loading. */
	private kickoffWordForState(state: RlHudState): string {
		if (state.overtimeBanner) return t("hud.overtime");
		if (state.kickoffIgnite) return t("hud.go");
		const tick = state.kickoffTick;
		if (tick == null) return "";
		switch (tick) {
			case 5:
				return t("hud.kickoffEyebrow");
			case 4:
				return t("hud.kickoffArena");
			case 3:
				return t("hud.kickoffReady");
			case 2:
				return t("hud.kickoffSet");
			case 1:
				return t("hud.kickoffFire");
			default:
				return String(tick);
		}
	}

	/** Parzysty tick / GO → slide z lewej; nieparzysty → z prawej. */
	private kickoffSlideDir(state: RlHudState): "left" | "right" {
		if (state.overtimeBanner || state.kickoffIgnite) return "left";
		const tick = state.kickoffTick ?? 0;
		return tick % 2 === 0 ? "right" : "left";
	}

	private renderKickoffWordBanner(state: RlHudState): void {
		const word = this.kickoffWordForState(state);
		const dir = this.kickoffSlideDir(state);
		const el = this.kickoffBanner;
		el.replaceChildren();
		el.dataset.glow = word;
		el.dataset.slide = dir;
		if (state.kickoffTick != null) el.dataset.tick = String(state.kickoffTick);
		else delete el.dataset.tick;

		/** FX w tle liter (nie fill w glifie). */
		const fx = document.createElement("div");
		fx.className = "kickoff-word-fx";
		fx.setAttribute("aria-hidden", "true");
		const bloom = document.createElement("span");
		bloom.className = "kickoff-word-fx__bloom";
		fx.appendChild(bloom);
		for (const kind of ["a", "b", "c"] as const) {
			const streak = document.createElement("span");
			streak.className = `kickoff-word-fx__streak kickoff-word-fx__streak--${kind}`;
			fx.appendChild(streak);
		}
		const ring = document.createElement("span");
		ring.className = "kickoff-word-fx__ring";
		fx.appendChild(ring);
		for (let s = 0; s < 20; s++) {
			const spark = document.createElement("i");
			spark.className = "kickoff-word-fx__spark";
			spark.style.setProperty("--s", String(s));
			fx.appendChild(spark);
		}
		el.appendChild(fx);

		const letters = Array.from(word);
		for (let i = 0; i < letters.length; i++) {
			const ch = letters[i]!;
			const glyph = ch === " " ? "\u00a0" : ch;
			const span = document.createElement("span");
			span.className = "kickoff-letter";
			span.style.setProperty("--i", String(i));
			/** Animowane wnętrze z assetów Ignite + solid outline. */
			const fill = document.createElement("span");
			fill.className = "kickoff-letter__fill";
			fill.setAttribute("aria-hidden", "true");
			fill.dataset.ch = glyph;
			fill.textContent = glyph;
			const stroke = document.createElement("span");
			stroke.className = "kickoff-letter__stroke";
			stroke.textContent = glyph;
			span.append(fill, stroke);
			el.appendChild(span);
		}

		el.classList.add(
			"show",
			"kickoff-word",
			dir === "left" ? "kickoff-slide-left" : "kickoff-slide-right",
			"countdown-pop",
		);
		if (state.kickoffIgnite) el.classList.add("kickoff-ignite");
		if (state.overtimeBanner) el.classList.add("kickoff-overtime");
		if (!state.kickoffIgnite && !state.overtimeBanner) {
			el.classList.add("kickoff-digit"); // zachowaj data-tick stage sync / FX
		}
	}

	private pulseKickoffLabel(state: RlHudState): void {
		const label = this.kickoffLabel;
		if (!label) return;
		/** Mały licznik pod napisem — też max punch. */
		label.classList.remove("kickoff-label--hot");
		if (state.overtimeBanner) {
			label.textContent = "";
			label.dataset.kind = "ignite";
		} else if (state.kickoffIgnite) {
			label.textContent = t("hud.ignitionSubtitle");
			label.dataset.kind = "ignite";
			label.classList.add("kickoff-label--hot");
		} else {
			label.dataset.kind = "tick";
			const tick = state.kickoffTick;
			label.textContent = tick != null ? `${tick}` : "";
			if (tick != null && tick <= 3) label.classList.add("kickoff-label--hot");
		}
		this.retriggerAnim(label, "kickoff-label-pop");
	}

	private hideKickoffStage(): void {
		this.kickoffStage?.classList.remove("show");
		if (this.kickoffStage) {
			delete this.kickoffStage.dataset.kind;
			delete this.kickoffStage.dataset.tick;
		}
		if (this.kickoffLabel) {
			this.kickoffLabel.textContent = "";
			delete this.kickoffLabel.dataset.kind;
			this.kickoffLabel.classList.remove("kickoff-label-pop");
		}
		this.kickoffEmbers?.classList.remove("kickoff-embers-burst");
		this.kickoffHalo?.classList.remove("kickoff-halo-pulse");
		this.kickoffRays?.classList.remove("kickoff-rays-burst");
		this.kickoffRaysAlt?.classList.remove("kickoff-rays-alt-burst");
		this.kickoffCore?.classList.remove("kickoff-core-pulse");
		this.kickoffScan?.classList.remove("kickoff-scan-sweep");
		this.kickoffFlare?.classList.remove("kickoff-flare-burst");
		this.kickoffGrid?.classList.remove("kickoff-grid-pulse");
		this.kickoffHeat?.classList.remove("kickoff-heat-pulse");
		this.kickoffArcs?.classList.remove("kickoff-arcs-burst");
		this.kickoffSparks?.classList.remove("kickoff-sparks-burst");
		this.kickoffBoom?.classList.remove("kickoff-boom-explode");
	}

	private retriggerAnim(el: HTMLElement | null, cls: string): void {
		if (!el) return;
		el.classList.remove(cls);
		void el.offsetWidth;
		el.classList.add(cls);
	}

	private clearKickoffShake(): void {
		document.body.classList.remove(
			"kickoff-boom-shake",
			"kickoff-boom-shake--hard",
			"kickoff-boom-shake--ignite",
		);
	}

	/**
	 * Odliczanie max punch: każdy tick wali FX + shake; 1 i GO = eksplozja.
	 */
	private pulseKickoffImpact(kind: "tick" | "one" | "ignite"): void {
		if (kind === "ignite") {
			this.pulseKickoffExplosion();
			this.triggerKickoffShake("ignite");
			return;
		}
		if (kind === "one") {
			/** Prawie jak GO — fireball + full deck. */
			this.retriggerAnim(this.kickoffBoom, "kickoff-boom-explode");
			this.retriggerAnim(this.kickoffRays, "kickoff-rays-burst");
			this.retriggerAnim(this.kickoffRaysAlt, "kickoff-rays-alt-burst");
			if (this.kickoffImpactShock) {
				this.kickoffImpactShock.dataset.kind = "one";
				this.retriggerAnim(this.kickoffImpactShock, "kickoff-impact-shock-pop");
			}
			if (this.kickoffImpactRing) {
				this.kickoffImpactRing.dataset.kind = "one";
				this.retriggerAnim(this.kickoffImpactRing, "kickoff-impact-ring-pop");
			}
			if (this.kickoffImpactRing2) {
				this.kickoffImpactRing2.dataset.kind = "one";
				this.retriggerAnim(this.kickoffImpactRing2, "kickoff-impact-ring2-pop");
			}
		}
		for (const [el, cls] of [
			[this.kickoffHalo, "kickoff-halo-pulse"],
			[this.kickoffEmbers, "kickoff-embers-burst"],
			[this.kickoffCore, "kickoff-core-pulse"],
			[this.kickoffScan, "kickoff-scan-sweep"],
			[this.kickoffFlare, "kickoff-flare-burst"],
			[this.kickoffGrid, "kickoff-grid-pulse"],
			[this.kickoffHeat, "kickoff-heat-pulse"],
			[this.kickoffArcs, "kickoff-arcs-burst"],
			[this.kickoffSparks, "kickoff-sparks-burst"],
			[this.kickoffRays, "kickoff-rays-burst"],
			[this.kickoffRaysAlt, "kickoff-rays-alt-burst"],
		] as const) {
			if (el) el.dataset.kind = kind;
			this.retriggerAnim(el, cls);
		}
		const flash = this.kickoffImpactFlash;
		if (flash) {
			flash.dataset.kind = kind;
			this.retriggerAnim(flash, "kickoff-impact-pop");
		}
		if (this.kickoffImpactSlam) {
			this.kickoffImpactSlam.dataset.kind = kind;
			this.retriggerAnim(this.kickoffImpactSlam, "kickoff-impact-slam-pop");
		}
		this.triggerKickoffShake(kind === "one" ? "hard" : "tick");
	}

	private triggerKickoffShake(level: "tick" | "hard" | "ignite"): void {
		this.clearKickoffShake();
		const cls =
			level === "ignite"
				? "kickoff-boom-shake--ignite"
				: level === "hard"
					? "kickoff-boom-shake--hard"
					: "kickoff-boom-shake";
		document.body.classList.add(cls);
		window.setTimeout(() => this.clearKickoffShake(), level === "ignite" ? 780 : level === "hard" ? 560 : 440);
	}

	/** Spektakularna eksplozja na GO — fireball + shockwave + odłamki. */
	private pulseKickoffExplosion(): void {
		this.retriggerAnim(this.kickoffBoom, "kickoff-boom-explode");
		this.retriggerAnim(this.kickoffFlare, "kickoff-flare-burst");
		this.retriggerAnim(this.kickoffEmbers, "kickoff-embers-burst");
		this.retriggerAnim(this.kickoffSparks, "kickoff-sparks-burst");
		this.retriggerAnim(this.kickoffArcs, "kickoff-arcs-burst");
		this.retriggerAnim(this.kickoffHeat, "kickoff-heat-pulse");
		this.retriggerAnim(this.kickoffGrid, "kickoff-grid-pulse");
		this.retriggerAnim(this.kickoffHalo, "kickoff-halo-pulse");
		this.retriggerAnim(this.kickoffCore, "kickoff-core-pulse");
		if (this.kickoffFlare) this.kickoffFlare.dataset.kind = "ignite";
		if (this.kickoffEmbers) this.kickoffEmbers.dataset.kind = "ignite";
		if (this.kickoffSparks) this.kickoffSparks.dataset.kind = "ignite";
		if (this.kickoffHalo) this.kickoffHalo.dataset.kind = "ignite";
		if (this.kickoffHeat) this.kickoffHeat.dataset.kind = "ignite";
		/** Istniejące pierścienie shock — teraz pod eksplozję. */
		if (this.kickoffImpactSlam) {
			this.kickoffImpactSlam.dataset.kind = "ignite";
			this.retriggerAnim(this.kickoffImpactSlam, "kickoff-impact-slam-pop");
		}
		if (this.kickoffImpactShock) {
			this.kickoffImpactShock.dataset.kind = "ignite";
			this.retriggerAnim(this.kickoffImpactShock, "kickoff-impact-shock-pop");
		}
		if (this.kickoffImpactRing) {
			this.kickoffImpactRing.dataset.kind = "ignite";
			this.retriggerAnim(this.kickoffImpactRing, "kickoff-impact-ring-pop");
		}
		if (this.kickoffImpactRing2) {
			this.kickoffImpactRing2.dataset.kind = "ignite";
			this.retriggerAnim(this.kickoffImpactRing2, "kickoff-impact-ring2-pop");
		}
	}

	private updateRushBanner(state: RlHudState, dt: number): void {
		const rush = state.rush;
		const storm = state.storm;
		if (!rush) {
			this.rushBanner.classList.remove("show", "rush-active", "storm-active");
			this.rushBanner.textContent = "";
			this.rushFlashLeft = 0;
			this.stormFlashLeft = 0;
			this.lastStormActive = false;
			return;
		}

		if (storm?.active) {
			if (!this.lastStormActive) {
				this.stormFlashLeft = 2.4;
			}
			this.lastStormActive = true;
			this.rushBanner.classList.add("show", "rush-active", "storm-active");
			const leftSec = Math.ceil(
				Math.min(
					rush.phaseLeftSec ?? 99,
					state.overcharge?.activeLeftSec ?? 99,
				),
			);
			this.rushBanner.textContent =
				this.stormFlashLeft > 0.5
					? t("hud.storm")
					: t("hud.stormLeft", { sec: leftSec });
			this.stormFlashLeft = Math.max(0, this.stormFlashLeft - dt);
			this.rushFlashLeft = 0;
			return;
		}
		this.lastStormActive = false;
		this.rushBanner.classList.remove("storm-active");

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
		this.stormFlashLeft = 0;
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

	private updateMutatorHint(state: RlHudState, dt: number): void {
		const mut = state.mutator;
		if (mut && mut.id !== this.lastMutatorId) {
			this.lastMutatorId = mut.id;
			this.mutatorAnnounceLeft = 5.5;
		}
		if (!mut) {
			this.lastMutatorId = "";
			this.mutatorAnnounceLeft = 0;
		} else {
			this.mutatorAnnounceLeft = Math.max(0, this.mutatorAnnounceLeft - dt);
		}

		if (
			state.fieldEnergy &&
			!mut &&
			!this.fieldEnergyAnnounced
		) {
			this.fieldEnergyAnnounced = true;
			this.fieldEnergyAnnounceLeft = 4.2;
		}
		if (!state.fieldEnergy) {
			this.fieldEnergyAnnounced = false;
			this.fieldEnergyAnnounceLeft = 0;
		} else {
			this.fieldEnergyAnnounceLeft = Math.max(
				0,
				this.fieldEnergyAnnounceLeft - dt,
			);
		}

		if (mut && this.mutatorAnnounceLeft > 0 && mut.descKey) {
			this.mutatorHint.classList.add("show", "mutator-hint--announce");
			this.mutatorHint.textContent = t("hud.mutatorAnnounce", {
				name: t(mut.nameKey as never),
				desc: t(mut.descKey as never),
			});
			return;
		}

		if (!mut && this.fieldEnergyAnnounceLeft > 0) {
			this.mutatorHint.classList.add("show", "mutator-hint--announce");
			this.mutatorHint.textContent = t("hud.fieldEnergyAnnounce");
			return;
		}

		this.mutatorHint.classList.remove("mutator-hint--announce");
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
			const block = el.closest(".team-block");
			if (block instanceof HTMLElement) {
				block.classList.remove("team-block--score-flash");
				void block.offsetWidth;
				block.classList.add("team-block--score-flash");
			}
		}
		if (el === this.scoreBlue) this.prevBlueScore = score;
		else this.prevOrangeScore = score;
	}
}
