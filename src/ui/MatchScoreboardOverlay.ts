import { t } from "../i18n";
import type { ScoreboardRow } from "../match/MatchScoring";
import type { ScoringTeam } from "../game/modes";
import { getEquippedBannerId } from "../meta/PlayerInventory";
import { getBannerCssUrl } from "../visual/bannerTextures";

const TEAMS: ScoringTeam[] = ["blue", "orange"];

export type ScoreboardClockInfo = {
	clockLabel: string;
	isOvertime?: boolean;
	/** Ile slotów na drużynę (puste rzędy jak w RL). */
	teamSize?: number;
};

/** Tabela statystyk RL — premium HUD na Tab, podział drużynowy. */
export class MatchScoreboardOverlay {
	private readonly root: HTMLElement;
	private readonly tbodies: Record<ScoringTeam, HTMLElement>;
	private readonly teamTotals: Record<ScoringTeam, HTMLElement>;
	private readonly clockEl: HTMLElement | null;
	private readonly prevScores = new Map<number, number>();
	private readonly prevTeamTotals: Record<ScoringTeam, number> = {
		blue: 0,
		orange: 0,
	};
	private wasVisible = false;
	private lastRowsSignature = "";

	constructor(
		root: HTMLElement = document.getElementById("match-scoreboard")!,
	) {
		const tbodies = {} as Record<ScoringTeam, HTMLElement>;
		const teamTotals = {} as Record<ScoringTeam, HTMLElement>;
		for (const team of TEAMS) {
			const tbody = root.querySelector(`tbody[data-team-body="${team}"]`);
			const total = root.querySelector(`[data-team-total="${team}"]`);
			if (!(tbody instanceof HTMLElement) || !(total instanceof HTMLElement)) {
				throw new Error(`MatchScoreboardOverlay: brak sekcji drużyny ${team}`);
			}
			tbodies[team] = tbody;
			teamTotals[team] = total;
		}
		this.root = root;
		this.tbodies = tbodies;
		this.teamTotals = teamTotals;
		const clock = root.querySelector("[data-scoreboard-clock]");
		this.clockEl = clock instanceof HTMLElement ? clock : null;
	}

	update(
		rows: ScoreboardRow[],
		visible: boolean,
		humanSlot: number,
		matchScore: { blue: number; orange: number } = { blue: 0, orange: 0 },
		clock?: ScoreboardClockInfo,
	): void {
		this.root.classList.toggle("show", visible);
		this.root.setAttribute("aria-hidden", visible ? "false" : "true");

		const justOpened = visible && !this.wasVisible;
		this.wasVisible = visible;
		if (!visible) return;

		if (this.clockEl && clock) {
			this.clockEl.textContent = clock.clockLabel;
			this.clockEl.dataset.ot = clock.isOvertime ? "1" : "0";
		}

		const signature = `${rowsSignature(rows)}#${matchScore.blue}:${matchScore.orange}#${clock?.teamSize ?? 0}`;
		if (!justOpened && signature === this.lastRowsSignature) return;
		this.lastRowsSignature = signature;

		this.teamTotals.blue.textContent = String(matchScore.blue);
		this.teamTotals.orange.textContent = String(matchScore.orange);
		this.pulseTotal(this.teamTotals.blue, matchScore.blue, "blue");
		this.pulseTotal(this.teamTotals.orange, matchScore.orange, "orange");

		for (const team of TEAMS) {
			const teamRows = sortTeamRows(rows.filter((row) => row.team === team));
			const slots = Math.max(teamRows.length, clock?.teamSize ?? teamRows.length);
			const nodes: HTMLElement[] = teamRows.map((row, index) =>
				this.renderRow(row, row.slotIndex === humanSlot, index),
			);
			for (let i = teamRows.length; i < slots; i++) {
				nodes.push(this.renderEmptyRow(team, i));
			}
			this.tbodies[team].replaceChildren(...nodes);
		}
	}

	private pulseTotal(
		el: HTMLElement,
		score: number,
		team: ScoringTeam,
	): void {
		const prev = this.prevTeamTotals[team];
		if (score > prev) {
			el.classList.remove("match-scoreboard__bug-score--pop");
			void el.offsetWidth;
			el.classList.add("match-scoreboard__bug-score--pop");
		}
		this.prevTeamTotals[team] = score;
	}

	private renderRow(
		row: ScoreboardRow,
		isYou: boolean,
		rank: number,
	): HTMLTableRowElement {
		const tr = document.createElement("tr");
		tr.className = "match-scoreboard__row";
		tr.style.animationDelay = `${rank * 0.04}s`;
		if (isYou) tr.classList.add("match-scoreboard__row--you");
		if (rank === 0 && row.score > 0) {
			tr.classList.add("match-scoreboard__row--lead");
		}
		if (row.team) tr.dataset.team = row.team;

		const nameTd = document.createElement("td");
		const nameWrap = document.createElement("span");
		nameWrap.className = "match-scoreboard__name";
		if (isYou) {
			nameWrap.classList.add("match-scoreboard__name--banner");
			nameWrap.style.setProperty(
				"--player-banner",
				getBannerCssUrl(getEquippedBannerId()),
			);
		}
		if (row.team) {
			const stripe = document.createElement("span");
			stripe.className = "match-scoreboard__stripe";
			stripe.setAttribute("aria-hidden", "true");
			nameWrap.appendChild(stripe);
		}
		const rankEl = document.createElement("span");
		rankEl.className = "match-scoreboard__rank";
		if (rank === 0) rankEl.classList.add("match-scoreboard__rank--lead");
		rankEl.textContent = String(rank + 1);
		rankEl.setAttribute("aria-hidden", "true");
		nameWrap.appendChild(rankEl);

		const nameLabel = document.createElement("span");
		nameLabel.className = "match-scoreboard__name-text";
		nameLabel.textContent =
			row.name + (isYou ? ` · ${t("scoreboard.you")}` : "");
		nameWrap.appendChild(nameLabel);
		nameTd.appendChild(nameWrap);
		tr.appendChild(nameTd);

		const stats: number[] = [
			row.score,
			row.goals,
			row.assists,
			row.saves,
			row.centers,
			row.touches,
			row.shots,
		];
		const prevScore = this.prevScores.get(row.slotIndex);
		for (const [i, value] of stats.entries()) {
			const td = document.createElement("td");
			const valueEl = document.createElement("span");
			valueEl.className = "match-scoreboard__value";
			if (i === 0) valueEl.classList.add("match-scoreboard__value--score");
			valueEl.textContent = String(value);
			if (i === 0 && prevScore !== undefined && value > prevScore) {
				valueEl.classList.add("match-scoreboard__cell--up");
			}
			td.appendChild(valueEl);
			tr.appendChild(td);
		}
		this.prevScores.set(row.slotIndex, row.score);
		return tr;
	}

	private renderEmptyRow(team: ScoringTeam, rank: number): HTMLTableRowElement {
		const tr = document.createElement("tr");
		tr.className = "match-scoreboard__row match-scoreboard__row--empty";
		tr.dataset.team = team;
		tr.style.animationDelay = `${rank * 0.04}s`;
		const nameTd = document.createElement("td");
		const wrap = document.createElement("span");
		wrap.className = "match-scoreboard__name";
		const stripe = document.createElement("span");
		stripe.className = "match-scoreboard__stripe";
		stripe.setAttribute("aria-hidden", "true");
		wrap.appendChild(stripe);
		const rankEl = document.createElement("span");
		rankEl.className = "match-scoreboard__rank";
		rankEl.textContent = String(rank + 1);
		wrap.appendChild(rankEl);
		const label = document.createElement("span");
		label.className = "match-scoreboard__name-text";
		label.textContent = "—";
		wrap.appendChild(label);
		nameTd.appendChild(wrap);
		tr.appendChild(nameTd);
		for (let i = 0; i < 7; i++) {
			const td = document.createElement("td");
			td.textContent = "·";
			tr.appendChild(td);
		}
		return tr;
	}
}

function sortTeamRows(rows: ScoreboardRow[]): ScoreboardRow[] {
	return [...rows].sort(
		(a, b) => b.score - a.score || b.goals - a.goals || a.name.localeCompare(b.name),
	);
}

function rowsSignature(rows: ScoreboardRow[]): string {
	return TEAMS.map((team) =>
		sortTeamRows(rows.filter((row) => row.team === team))
			.map((row) =>
				[
					row.slotIndex,
					row.name,
					row.score,
					row.goals,
					row.assists,
					row.saves,
					row.centers,
					row.touches,
					row.shots,
				].join(","),
			)
			.join(";"),
	).join("|");
}
