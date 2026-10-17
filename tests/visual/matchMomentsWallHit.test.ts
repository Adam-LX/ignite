import { describe, expect, it } from "vitest";
import { pickHumanHitMoment } from "../../src/visual/matchMoments/matchMoments";

describe("pickHumanHitMoment wall ride", () => {
	it("pokazuje WALL HIT przy solidnym kontakcie na ścianie", () => {
		const m = pickHumanHitMoment({
			impact: 6,
			ballY: 0.8,
			inAir: false,
			flipping: false,
			onWall: true,
			matchTimeSec: 40,
		});
		expect(m?.id).toBe("wall_shot");
		expect(m?.label).toBe("WALL HIT!");
	});

	it("nie spamuje wall hit przy lekkim kontakcie", () => {
		expect(
			pickHumanHitMoment({
				impact: 3,
				ballY: 0.5,
				inAir: false,
				flipping: false,
				onWall: true,
				matchTimeSec: 40,
			}),
		).toBeNull();
	});

	it("aerial ma priorytet nad wall hit", () => {
		const m = pickHumanHitMoment({
			impact: 6,
			ballY: 3,
			inAir: true,
			flipping: false,
			onWall: true,
			matchTimeSec: 40,
		});
		expect(m?.id).toBe("aerial");
	});

	it("FLIP HIT przy dodge w powietrzu poniżej progu aerial Y", () => {
		const m = pickHumanHitMoment({
			impact: 6,
			ballY: 0.9,
			inAir: true,
			flipping: true,
			onWall: false,
			matchTimeSec: 40,
		});
		expect(m?.label).toBe("FLIP HIT!");
	});
});
