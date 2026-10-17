import type { CarEntity } from "../CarEntity";
import type { ScoringTeam } from "../modes";
import type { MatchController } from "../../modes/MatchController";
import { t, type I18nKey } from "../../i18n";
import { defaultSpawnCenterY } from "../../visual/carWheelGround";

export type PodiumTitleId =
	| "mvp"
	| "prodigy"
	| "warden"
	| "playmaker"
	| "champion";

const TITLE_I18N: Record<PodiumTitleId, I18nKey> = {
	mvp: "podium.title.mvp",
	prodigy: "podium.title.prodigy",
	warden: "podium.title.warden",
	playmaker: "podium.title.playmaker",
	champion: "podium.title.champion",
};

/**
 * Post-Game Spotlights — lineup zwycięzców + tytuły (jak RL).
 * Human winner może freestyle; boty mają celebracyjny spin.
 */
export class PostMatchSpotlight {
	private active = false;
	private readonly winnerSlots = new Set<number>();
	private readonly titles = new Map<number, PodiumTitleId>();
	private focusSlot = 0;
	private arranged = false;

	get isActive(): boolean {
		return this.active;
	}

	isWinner(slot: number): boolean {
		return this.winnerSlots.has(slot);
	}

	getFocusSlot(): number {
		return this.focusSlot;
	}

	getTitleLabel(slot: number): string | null {
		const id = this.titles.get(slot);
		return id ? t(TITLE_I18N[id]) : null;
	}

	getWinnerSlots(): ReadonlySet<number> {
		return this.winnerSlots;
	}

	/** Wejście w fazę podium — wyznacz zwycięzców i tytuły. */
	begin(match: MatchController, cars: CarEntity[]): void {
		this.active = true;
		this.arranged = false;
		this.winnerSlots.clear();
		this.titles.clear();

		const scores = match.getScores();
		const isFFA = match.getHudSnapshot(cars).isFFA;
		const winners = resolveWinnerCars(cars, scores, isFFA);
		for (const car of winners) {
			this.winnerSlots.add(car.slotIndex);
		}

		assignTitles(this.titles, winners, match);

		const humanWinner = winners.find((c) => c.isHuman);
		const mvpSlot = [...this.titles.entries()].find(
			([, id]) => id === "mvp",
		)?.[0];
		this.focusSlot =
			humanWinner?.slotIndex ??
			mvpSlot ??
			winners[0]?.slotIndex ??
			cars[0]?.slotIndex ??
			0;

		for (const car of winners) {
			car.player.boostFuel = 1;
		}
	}

	/** Teleport lineup — raz po wejściu w podium. */
	ensureArranged(cars: CarEntity[], _carHalfHeight: number): void {
		if (!this.active || this.arranged) return;
		this.arranged = true;

		const winners = cars
			.filter((c) => this.winnerSlots.has(c.slotIndex))
			.sort((a, b) => a.slotIndex - b.slotIndex);
		const losers = cars.filter((c) => !this.winnerSlots.has(c.slotIndex));

		const n = Math.max(1, winners.length);
		const spacing = 3.4;
		const startX = -((n - 1) * spacing) / 2;
		const y = defaultSpawnCenterY();
		const yaw = 0;

		for (let i = 0; i < winners.length; i++) {
			const car = winners[i]!;
			car.player.resetKickoffPose(startX + i * spacing, y, 0, yaw);
			car.player.boostFuel = 1;
			car.freezeInPlace();
		}

		for (let i = 0; i < losers.length; i++) {
			const car = losers[i]!;
			const side = i % 2 === 0 ? -1 : 1;
			car.player.resetKickoffPose(
				side * 28,
				y,
				-18 - Math.floor(i / 2) * 4,
				side > 0 ? -Math.PI / 2 : Math.PI / 2,
			);
			car.freezeInPlace();
		}
	}

	end(): void {
		this.active = false;
		this.arranged = false;
		this.winnerSlots.clear();
		this.titles.clear();
	}

	focusCar(cars: CarEntity[]): CarEntity | null {
		return cars.find((c) => c.slotIndex === this.focusSlot) ?? cars[0] ?? null;
	}
}

function resolveWinnerCars(
	cars: CarEntity[],
	scores: { blue: number; orange: number },
	isFFA: boolean,
): CarEntity[] {
	if (isFFA) {
		return [...cars]
			.sort((a, b) => b.individualScore - a.individualScore)
			.slice(0, Math.min(3, cars.length));
	}
	const team: ScoringTeam =
		scores.blue >= scores.orange ? "blue" : "orange";
	const pool = cars.filter((c) => (c.team ?? c.visualTeam) === team);
	return pool.length > 0 ? pool : cars.slice(0, 1);
}

function assignTitles(
	out: Map<number, PodiumTitleId>,
	winners: CarEntity[],
	match: MatchController,
): void {
	const payload = match.scoring.exportPayload();
	const bySlot = new Map(payload.map((p) => [p.slotIndex, p]));

	let bestAssist = -1;
	let bestAssistSlot = -1;
	let bestScore = -1;
	let bestScoreSlot = -1;

	for (const car of winners) {
		const s = bySlot.get(car.slotIndex);
		const assists = s?.assists ?? 0;
		const score = s?.score ?? car.individualScore;
		if (assists > bestAssist) {
			bestAssist = assists;
			bestAssistSlot = car.slotIndex;
		}
		if (score > bestScore) {
			bestScore = score;
			bestScoreSlot = car.slotIndex;
		}
	}

	for (const car of winners) {
		const s = bySlot.get(car.slotIndex);
		const goals = s?.goals ?? 0;
		const saves = s?.saves ?? 0;
		let title: PodiumTitleId = "champion";
		if (goals >= 3) title = "prodigy";
		else if (saves >= 3) title = "warden";
		else if (car.slotIndex === bestAssistSlot && bestAssist > 0) {
			title = "playmaker";
		} else if (car.slotIndex === bestScoreSlot) {
			title = "mvp";
		}
		out.set(car.slotIndex, title);
	}

	if (![...out.values()].includes("mvp") && bestScoreSlot >= 0) {
		const cur = out.get(bestScoreSlot);
		if (cur === "champion" || cur === "playmaker") {
			out.set(bestScoreSlot, "mvp");
		}
	}
}
