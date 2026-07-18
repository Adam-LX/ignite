import { t } from "../i18n";
import type { ScoreboardRow } from "../match/MatchScoring";
import type { ScoringTeam } from "../game/modes";

const RANK_MEDALS = ["🥇", "🥈", "🥉"] as const;
const TEAMS: ScoringTeam[] = ["blue", "orange"];

/** Tabela statystyk RL — premium HUD na Tab, podział drużynowy. */
export class MatchScoreboardOverlay {
	private readonly root: HTMLElement;
	private readonly tbodies: Record<ScoringTeam, HTMLElement>;
	private readonly teamTotals: Record<ScoringTeam, HTMLElement>;
	private readonly prevScores = new Map<number, number>();
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
	}

	update(rows: ScoreboardRow[], visible: boolean, humanSlot: number): void {
		this.root.classList.toggle("show", visible);
		this.root.setAttribute("aria-hidden", visible ? "false" : "true");

		const justOpened = visible && !this.wasVisible;
		this.wasVisible = visible;
		if (!visible) return;

		const signature = rowsSignature(rows);
		if (!justOpened && signature === this.lastRowsSignature) return;
		this.lastRowsSignature = signature;

		for (const team of TEAMS) {
			const teamRows = sortTeamRows(rows.filter((row) => row.team === team));
			this.teamTotals[team].textContent = String(
				teamRows.reduce((sum, row) => sum + row.score, 0),
			);
			this.tbodies[team].replaceChildren(
				...teamRows.map((row, index) =>
					this.renderRow(row, row.slotIndex === humanSlot, index),
				),
			);
		}
	}

	private renderRow(
		row: ScoreboardRow,
		isYou: boolean,
		rank: number,
	): HTMLTableRowElement {
		const tr = document.createElement("tr");
		tr.className = "match-scoreboard__row";
		tr.style.animationDelay = `${rank * 0.035}s`;
		if (isYou) tr.classList.add("match-scoreboard__row--you");
		if (rank === 0 && row.score > 0) {
			tr.classList.add("match-scoreboard__row--lead");
		}
		if (row.team) tr.dataset.team = row.team;

		const nameTd = document.createElement("td");
		const nameWrap = document.createElement("span");
		nameWrap.className = "match-scoreboard__name";
		if (row.team) {
			const stripe = document.createElement("span");
			stripe.className = "match-scoreboard__stripe";
			stripe.setAttribute("aria-hidden", "true");
			nameWrap.appendChild(stripe);
		}
		const medal = RANK_MEDALS[rank];
		if (medal) {
			const medalEl = document.createElement("span");
			medalEl.className = "match-scoreboard__medal";
			medalEl.textContent = medal;
			medalEl.setAttribute("aria-hidden", "true");
			nameWrap.appendChild(medalEl);
		}
		const nameLabel = document.createElement("span");
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
