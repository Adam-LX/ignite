import { describe, expect, it } from "vitest";

import { forfeitMatchScores } from "../../src/net/rankedForfeit";

describe("forfeitMatchScores", () => {
	it("host (slot 0) poddaje — 3–0 orange", () => {
		expect(forfeitMatchScores(0)).toEqual({ blueScore: 0, orangeScore: 3 });
	});

	it("gość (slot 1) poddaje — 3–0 blue", () => {
		expect(forfeitMatchScores(1)).toEqual({ blueScore: 3, orangeScore: 0 });
	});

	it("2v2 orange (slot 2) poddaje — 3–0 blue", () => {
		expect(forfeitMatchScores(2, "2v2")).toEqual({ blueScore: 3, orangeScore: 0 });
	});

	it("2v2 orange (slot 3) poddaje — 3–0 blue", () => {
		expect(forfeitMatchScores(3, "2v2")).toEqual({ blueScore: 3, orangeScore: 0 });
	});

	it("2v2 blue (slot 1) poddaje — 3–0 orange", () => {
		expect(forfeitMatchScores(1, "2v2")).toEqual({ blueScore: 0, orangeScore: 3 });
	});
});
