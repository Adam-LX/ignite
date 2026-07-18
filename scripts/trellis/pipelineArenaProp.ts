/**
 * Trellis → prop areny (bramka, pylon)
 *   npm run trellis:build-arena-props -- --arena vault --prop goalFrame
 */

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { trellisDownloadGlb, trellisGenerate, trellisHealth, trellisWaitForJob } from "./client.js";

const ROOT = resolve(import.meta.dirname, "../..");

function parseArgs(): { arena: string; prop: string; prompt: string } {
	const args = process.argv.slice(2);
	let arena = "vault";
	let prop = "goalFrame";
	let prompt = "";
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--arena" && args[i + 1]) arena = args[++i]!;
		if (args[i] === "--prop" && args[i + 1]) prop = args[++i]!;
		if (args[i] === "--prompt" && args[i + 1]) prompt = args[++i]!;
	}
	if (!prompt) {
		prompt = `Stylized rocket league ${prop} for ${arena} arena, neon cyberpunk, game-ready PBR`;
	}
	return { arena, prop, prompt };
}

async function main(): Promise<void> {
	const { arena, prop, prompt } = parseArgs();
	const outDir = resolve(ROOT, `public/assets/arenas/${arena}/props`);
	mkdirSync(outDir, { recursive: true });
	const dest = resolve(outDir, `${prop}.glb`);

	if (!(await trellisHealth())) {
		throw new Error("Trellis niedostępny na :8004");
	}

	const job = await trellisGenerate({ prompt, quality: "standard" });
	const url = await trellisWaitForJob(job.job_id, { outId: job.out_id });
	await trellisDownloadGlb(url, dest);
	console.info(`Prop saved: ${dest}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
