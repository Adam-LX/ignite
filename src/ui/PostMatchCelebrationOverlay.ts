import { t } from "../i18n";
import type { PodiumTitleId } from "../game/session/PostMatchSpotlight";

export type CelebrationRosterRow = {
	slot: number;
	name: string;
	score: number;
	team: "blue" | "orange" | null;
	title: string | null;
	isHuman: boolean;
	isWinner: boolean;
};

export type CelebrationScreenState = {
	visible: boolean;
	stage: "spotlights" | "results" | null;
	winnerLabel: string | null;
	blueScore: number;
	orangeScore: number;
	isFFA: boolean;
	mvpName: string | null;
	mvpScore: number | null;
	rankedSubtitle: string | null;
	roster: CelebrationRosterRow[];
	podiumLeftSec: number | null;
	canSkip: boolean;
	rematchHost: boolean;
	rematchGuestWait: boolean;
};

const EMPTY: CelebrationScreenState = {
	visible: false,
	stage: null,
	winnerLabel: null,
	blueScore: 0,
	orangeScore: 0,
	isFFA: false,
	mvpName: null,
	mvpScore: null,
	rankedSubtitle: null,
	roster: [],
	podiumLeftSec: null,
	canSkip: false,
	rematchHost: false,
	rematchGuestWait: false,
};

/**
 * Osobny ekran pomeczowy (wzorowany na RL Spotlights → Results).
 * Nie używa RMB/jump do skipu — tylko Enter / Esc / przycisk.
 */
export class PostMatchCelebrationOverlay {
	private readonly root: HTMLElement;
	private readonly winnerEl: HTMLElement;
	private readonly scoreEl: HTMLElement;
	private readonly eyebrowEl: HTMLElement;
	private readonly rosterEl: HTMLElement;
	private readonly mvpEl: HTMLElement;
	private readonly hintEl: HTMLElement;
	private readonly continueBtn: HTMLButtonElement;
	private readonly rematchBtn: HTMLButtonElement;
	private readonly rematchWaitEl: HTMLElement;
	private readonly rankedEl: HTMLElement;
	private onContinue: (() => void) | null = null;
	private onRematch: (() => void) | null = null;
	private lastKey = "";

	constructor(parent: HTMLElement = document.body) {
		let root = document.getElementById("post-match-celebration");
		if (!root) {
			root = document.createElement("div");
			root.id = "post-match-celebration";
			parent.appendChild(root);
		}
		root.className = "pmc hidden";
		root.innerHTML = `
			<div class="pmc__veil" aria-hidden="true"></div>
			<div class="pmc__panel" role="dialog" aria-modal="true" aria-labelledby="pmc-winner">
				<p class="pmc__eyebrow" id="pmc-eyebrow"></p>
				<h1 class="pmc__winner" id="pmc-winner"></h1>
				<p class="pmc__score" id="pmc-score"></p>
				<p class="pmc__ranked" id="pmc-ranked" hidden></p>
				<ul class="pmc__roster" id="pmc-roster"></ul>
				<p class="pmc__mvp" id="pmc-mvp"></p>
				<div class="pmc__actions">
					<button type="button" class="pmc__btn pmc__btn--primary" id="pmc-continue"></button>
					<button type="button" class="pmc__btn pmc__btn--ghost" id="pmc-rematch" hidden></button>
				</div>
				<p class="pmc__hint" id="pmc-hint"></p>
				<p class="pmc__rematch-wait" id="pmc-rematch-wait" hidden></p>
			</div>
		`;
		this.root = root;
		this.eyebrowEl = root.querySelector("#pmc-eyebrow")!;
		this.winnerEl = root.querySelector("#pmc-winner")!;
		this.scoreEl = root.querySelector("#pmc-score")!;
		this.rosterEl = root.querySelector("#pmc-roster")!;
		this.mvpEl = root.querySelector("#pmc-mvp")!;
		this.hintEl = root.querySelector("#pmc-hint")!;
		this.rankedEl = root.querySelector("#pmc-ranked")!;
		this.continueBtn = root.querySelector("#pmc-continue")!;
		this.rematchBtn = root.querySelector("#pmc-rematch")!;
		this.rematchWaitEl = root.querySelector("#pmc-rematch-wait")!;

		this.continueBtn.addEventListener("click", () => this.onContinue?.());
		this.rematchBtn.addEventListener("click", () => this.onRematch?.());
	}

	setHandlers(opts: {
		onContinue?: () => void;
		onRematch?: () => void;
	}): void {
		this.onContinue = opts.onContinue ?? null;
		this.onRematch = opts.onRematch ?? null;
	}

	hide(): void {
		this.update(EMPTY);
	}

	update(state: CelebrationScreenState): void {
		const key = JSON.stringify({
			v: state.visible,
			s: state.stage,
			w: state.winnerLabel,
			b: state.blueScore,
			o: state.orangeScore,
			m: state.mvpName,
			r: state.roster.map((x) => [x.slot, x.title, x.score]),
			skip: state.canSkip,
			rh: state.rematchHost,
			rw: state.rematchGuestWait,
			left: state.podiumLeftSec != null ? Math.ceil(state.podiumLeftSec) : null,
		});
		if (key === this.lastKey) return;
		this.lastKey = key;

		if (!state.visible || !state.stage) {
			this.root.classList.add("hidden");
			this.root.classList.remove("pmc--spotlights", "pmc--results");
			return;
		}

		this.root.classList.remove("hidden");
		this.root.classList.toggle("pmc--spotlights", state.stage === "spotlights");
		this.root.classList.toggle("pmc--results", state.stage === "results");

		this.eyebrowEl.textContent =
			state.stage === "spotlights"
				? t("hud.podium")
				: t("hud.celebrationResults");
		this.winnerEl.textContent = state.winnerLabel ?? t("hud.winners");

		if (state.isFFA) {
			this.scoreEl.textContent = "";
			this.scoreEl.hidden = true;
		} else {
			this.scoreEl.hidden = false;
			this.scoreEl.textContent = `${state.blueScore}  —  ${state.orangeScore}`;
		}

		if (state.rankedSubtitle) {
			this.rankedEl.hidden = false;
			this.rankedEl.textContent = state.rankedSubtitle;
		} else {
			this.rankedEl.hidden = true;
			this.rankedEl.textContent = "";
		}

		this.rosterEl.innerHTML = state.roster
			.map((row) => {
				const teamClass = row.team ? `pmc__row--${row.team}` : "";
				const winClass = row.isWinner ? "pmc__row--winner" : "";
				const title = row.title
					? `<span class="pmc__title">${escapeHtml(row.title)}</span>`
					: "";
				const you = row.isHuman
					? `<span class="pmc__you">${t("hud.ffaYou")}</span>`
					: "";
				return `<li class="pmc__row ${teamClass} ${winClass}">
					<span class="pmc__name">${escapeHtml(row.name)}${you}</span>
					${title}
					<span class="pmc__pts">${row.score}</span>
				</li>`;
			})
			.join("");

		if (state.mvpName) {
			const scoreBit =
				state.mvpScore != null && state.mvpScore > 0
					? ` · ${state.mvpScore}`
					: "";
			this.mvpEl.textContent = t("hud.mvp", {
				name: state.mvpName,
				score: scoreBit,
			});
			this.mvpEl.hidden = false;
		} else {
			this.mvpEl.textContent = "";
			this.mvpEl.hidden = true;
		}

		if (state.stage === "spotlights") {
			this.continueBtn.hidden = !state.canSkip;
			this.continueBtn.textContent = t("hud.celebrationContinue");
			this.hintEl.textContent = state.canSkip
				? t("hud.celebrationSkip")
				: t("hud.celebrationWait");
			if (state.podiumLeftSec != null) {
				this.hintEl.textContent += ` · ${Math.ceil(state.podiumLeftSec)}s`;
			}
		} else {
			this.continueBtn.hidden = false;
			this.continueBtn.textContent = t("hud.celebrationMenu");
			this.hintEl.textContent = t("hud.celebrationMenuHint");
		}

		this.rematchBtn.hidden = !state.rematchHost;
		this.rematchBtn.textContent = t("hud.rematch");
		this.rematchWaitEl.hidden = !state.rematchGuestWait;
		this.rematchWaitEl.textContent = t("hud.rematchWait");
	}
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

export type { PodiumTitleId };
