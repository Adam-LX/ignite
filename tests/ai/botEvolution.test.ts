import { describe, expect, it } from "vitest";

import { BotPolicy } from "../../src/ai/learning/BotPolicy";
import { pickEvolutionWinner } from "../../src/ai/learning/BotEvolution";

describe("BotEvolution", () => {
	it("pickEvolutionWinner — gorszy kandydat zachowuje seed gen", () => {
		const seed = new BotPolicy(1);
		seed.generation = 210;
		seed.fitness = 28;

		const worse = new BotPolicy(2);
		worse.fitness = 20;

		const out = pickEvolutionWinner(seed, worse, 4);
		expect(out.generation).toBe(210);
		expect(out.fitness).toBe(28);
	});

	it("pickEvolutionWinner — lepszy kandydat bumpuje gen o liczbę generacji", () => {
		const seed = new BotPolicy(3);
		seed.generation = 210;
		seed.fitness = 25;

		const better = new BotPolicy(4);
		better.fitness = 30;

		const out = pickEvolutionWinner(seed, better, 4);
		expect(out.generation).toBe(214);
		expect(out.fitness).toBe(30);
	});

	it("pickEvolutionWinner — brak seeda startuje od gen = generations", () => {
		const fresh = new BotPolicy(5);
		fresh.fitness = 12;
		const out = pickEvolutionWinner(null, fresh, 6);
		expect(out.generation).toBe(6);
	});
});
