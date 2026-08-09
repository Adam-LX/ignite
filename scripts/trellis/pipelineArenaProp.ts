/**
 * Trellis → prop areny (bramka, pylon)
 *   npm run trellis:build-arena-props -- --arena standard --prop goalFrame
 *   npm run trellis:build-arena-props -- --arena standard --prop goalFrame --image public/assets/arenas/standard/concepts/goalFrame_front.png --quality high
 */

import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import {
	trellisDownloadGlb,
	trellisGenerate,
	trellisHealth,
	trellisWaitForJob,
} from "./client.js";

const ROOT = resolve(import.meta.dirname, "../..");

const DEFAULT_GOAL_PROMPT =
	"Rocket League soccar goal frame only: two vertical posts and one crossbar forming a hollow rectangular mouth, " +
	"thin black metal tubes, cyan neon edge accents, open ground — no floor plate, no back wall fill, no brick, " +
	"no net mesh, no scaffold, no pipes crossing the mouth, game-ready PBR, centered, clean topology, orthographic";

function parseArgs(): {
	arena: string;
	prop: string;
	prompt: string;
	imagePath?: string;
	quality: "standard" | "high" | "ultra";
} {
	const args = process.argv.slice(2);
	let arena = "standard";
	let prop = "goalFrame";
	let prompt = "";
	let imagePath: string | undefined;
	let quality: "standard" | "high" | "ultra" = "high";
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--arena" && args[i + 1]) arena = args[++i]!;
		if (args[i] === "--prop" && args[i + 1]) prop = args[++i]!;
		if (args[i] === "--prompt" && args[i + 1]) prompt = args[++i]!;
		if (args[i] === "--image" && args[i + 1]) imagePath = args[++i]!;
		if (args[i] === "--quality" && args[i + 1]) {
			const q = args[++i]!;
			if (q === "standard" || q === "high" || q === "ultra") quality = q;
		}
	}
	if (!prompt) {
		prompt =
			prop === "goalFrame"
				? DEFAULT_GOAL_PROMPT
				: `Stylized rocket league ${prop} for ${arena} arena, neon cyberpunk, game-ready PBR`;
	}
	return { arena, prop, prompt, imagePath, quality };
}

async function main(): Promise<void> {
	const { arena, prop, prompt, imagePath, quality } = parseArgs();
	const outDir = resolve(ROOT, `public/assets/arenas/${arena}/props`);
	mkdirSync(outDir, { recursive: true });
	const dest = resolve(outDir, `${prop}.glb`);

	if (!(await trellisHealth())) {
		throw new Error("Trellis niedostępny na :8004");
	}

	let job;
	if (imagePath) {
		const abs = resolve(ROOT, imagePath);
		if (!existsSync(abs)) throw new Error(`Brak konceptu: ${abs}`);
		console.info(`Trellis image-to-3D ← ${abs} (quality=${quality})`);
		job = await trellisGenerate({ imagePath: abs, quality });
	} else {
		console.info(`Trellis text-to-3D (quality=${quality})\n  ${prompt}`);
		job = await trellisGenerate({ prompt, quality });
	}
	const url = await trellisWaitForJob(job.job_id, { outId: job.out_id });
	await trellisDownloadGlb(url, dest);
	console.info(`Prop saved: ${dest}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
