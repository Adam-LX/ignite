import { defaultPolicyOutPath, evolveBotPolicy } from "../src/ai/learning/BotEvolution.ts";
import { publishTrainedPolicy } from "./publishTrainedPolicy.ts";

const generations = Number(process.env.BOT_TRAIN_GENS ?? 12);
const population = Number(process.env.BOT_TRAIN_POP ?? 16);
const episodeSec = Number(process.env.BOT_TRAIN_SEC ?? 14);
const outPath = process.env.BOT_TRAIN_OUT ?? defaultPolicyOutPath();

console.info(
	`[BotTrain] start — pop=${population} gens=${generations} episode=${episodeSec}s → ${outPath}`,
);

const best = await evolveBotPolicy(
	{
		population,
		generations,
		episodeSec,
		elite: Math.max(2, Math.floor(population * 0.2)),
		outPath,
	},
	(p) => {
		console.info(
			`[BotTrain] gen ${p.generation}/${generations} best=${p.bestFitness.toFixed(1)} avg=${p.avgFitness.toFixed(1)} goals=${p.goals}`,
		);
	},
);

console.info(
	`[BotTrain] done — gen=${best.generation} fitness=${best.fitness.toFixed(1)} saved ${outPath}`,
);

await publishTrainedPolicy(outPath);
