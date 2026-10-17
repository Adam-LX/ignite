import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { BotPolicy, type BotPolicyData } from "./BotPolicy";
import { evaluateBotStackEpisode } from "./HeadlessBotMatch";

export type EvolutionOptions = {
	population: number;
	generations: number;
	episodeSec: number;
	elite: number;
	outPath: string;
};

export type EvolutionProgress = {
	generation: number;
	bestFitness: number;
	avgFitness: number;
	goals: number;
};

/** Wczytaj istniejącą politykę — smoke train nie startuje od zera. */
export function loadPolicyFromPath(path: string): BotPolicy | null {
	try {
		if (!existsSync(path)) return null;
		const data = JSON.parse(readFileSync(path, "utf8")) as BotPolicyData;
		return BotPolicy.fromData(data);
	} catch {
		return null;
	}
}

/**
 * Zachowaj seed gdy trening nie poprawił fitnessu; generacja rośnie tylko przy wygranej.
 */
export function pickEvolutionWinner(
	seed: BotPolicy | null,
	candidate: BotPolicy,
	generations: number,
): BotPolicy {
	if (!seed) {
		const out = candidate.clone();
		out.generation = Math.max(1, generations);
		return out;
	}
	if (candidate.fitness > seed.fitness + 1e-6) {
		const out = candidate.clone();
		out.generation = seed.generation + generations;
		return out;
	}
	return seed.clone();
}

function seedPopulation(
	seed: BotPolicy,
	population: number,
	rng: () => number,
): BotPolicy[] {
	const out: BotPolicy[] = [seed.clone()];
	while (out.length < population) {
		const child = seed.clone();
		child.mutate(0.12, rng);
		out.push(child);
	}
	return out;
}

export async function evolveBotPolicy(
	opts: EvolutionOptions,
	onProgress?: (p: EvolutionProgress) => void,
): Promise<BotPolicy> {
	const rng = mulberry32(42);
	const seed = loadPolicyFromPath(opts.outPath);
	let population: BotPolicy[] = seed
		? seedPopulation(seed, opts.population, rng)
		: Array.from({ length: opts.population }, (_, i) => new BotPolicy(i + 1));

	let best = population[0]!;
	let bestFitness = seed?.fitness ?? -Infinity;

	for (let gen = 1; gen <= opts.generations; gen++) {
		const scored: { policy: BotPolicy; fitness: number; goals: number }[] = [];

		for (let i = 0; i < population.length; i++) {
			const policy = population[i]!;
			const result = await evaluateBotStackEpisode(
				policy,
				opts.episodeSec,
				gen * 1000 + i,
			);
			const fitness = result.fitness;
			policy.fitness = fitness;
			scored.push({
				policy,
				fitness,
				goals: result.blueGoals + result.orangeGoals,
			});
			if (fitness > bestFitness) {
				bestFitness = fitness;
				best = policy.clone();
				best.generation = gen;
			}
		}

		scored.sort((a, b) => b.fitness - a.fitness);
		const avgFitness =
			scored.reduce((s, x) => s + x.fitness, 0) / scored.length;
		onProgress?.({
			generation: gen,
			bestFitness: scored[0]!.fitness,
			avgFitness,
			goals: scored[0]!.goals,
		});

		const next: BotPolicy[] = [];
		for (let e = 0; e < opts.elite; e++) {
			next.push(scored[e]!.policy.clone());
		}

		while (next.length < opts.population) {
			const a = tournamentPick(scored, rng);
			const b = tournamentPick(scored, rng);
			next.push(a.crossover(b, rng));
		}
		population = next;
	}

	const winner = pickEvolutionWinner(seed, best, opts.generations);
	winner.fitness = Math.max(bestFitness, seed?.fitness ?? bestFitness);
	mkdirSync(dirname(opts.outPath), { recursive: true });
	writeFileSync(opts.outPath, JSON.stringify(winner.toData(), null, 2));
	if (seed && winner.generation === seed.generation) {
		console.info(
			`[BotTrain] brak poprawy fitness (${bestFitness.toFixed(2)} ≤ seed ${seed.fitness.toFixed(2)}) — zachowano gen ${seed.generation}`,
		);
	}
	return winner;
}

function tournamentPick(
	scored: { policy: BotPolicy; fitness: number }[],
	rng: () => number,
): BotPolicy {
	const a = scored[Math.floor(rng() * scored.length)]!;
	const b = scored[Math.floor(rng() * scored.length)]!;
	return a.fitness >= b.fitness ? a.policy : b.policy;
}

function mulberry32(seed: number): () => number {
	let t = seed >>> 0;
	return () => {
		t += 0x6d2b79f5;
		let r = Math.imul(t ^ (t >>> 15), 1 | t);
		r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
		return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
	};
}

export function defaultPolicyOutPath(): string {
	return resolve(process.cwd(), "public/assets/ai/bot-policy.json");
}
