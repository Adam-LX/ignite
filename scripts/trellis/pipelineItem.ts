/**
 * Trellis → item GLB (skrzynka, koła, czapki)
 *   npm run trellis:build-item -- --kind crate --id ignite_supply
 *   npm run trellis:build-item -- --kind wheel --id neon
 */

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import {
	trellisDownloadGlb,
	trellisGenerate,
	trellisHealth,
	trellisWaitForJob,
} from "./client.js";

const ROOT = resolve(import.meta.dirname, "../..");

type ItemKind = "crate" | "wheel" | "topper";

function parseArgs(): { kind: ItemKind; id: string; prompt: string } {
	const args = process.argv.slice(2);
	let kind: ItemKind = "crate";
	let id = "ignite_supply";
	let prompt = "";
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--kind" && args[i + 1]) kind = args[++i]! as ItemKind;
		if (args[i] === "--id" && args[i + 1]) id = args[++i]!;
		if (args[i] === "--prompt" && args[i + 1]) prompt = args[++i]!;
	}
	if (!prompt) {
		if (kind === "crate") {
			prompt =
				"Rocket League supply crate, hexagonal sci-fi loot box, orange-cyan Ignite neon trim, glowing seams, game-ready PBR, 0.8m tall";
		} else if (kind === "wheel") {
			prompt = `Stylized rocket league wheel rim ${id}, game-ready PBR, 0.35m diameter`;
		} else {
			prompt = `Stylized rocket league car topper ${id}, game-ready PBR, 0.25m`;
		}
	}
	return { kind, id, prompt };
}

function destFor(kind: ItemKind, id: string): string {
	const sub =
		kind === "crate" ? "crate" : kind === "wheel" ? "wheels" : "toppers";
	const file = kind === "crate" ? `${id}.glb` : `${id}.glb`;
	const dir = resolve(ROOT, `public/assets/items/${sub}`);
	mkdirSync(dir, { recursive: true });
	return resolve(dir, file);
}

async function main(): Promise<void> {
	const { kind, id, prompt } = parseArgs();
	const dest = destFor(kind, id);

	if (!(await trellisHealth())) {
		throw new Error("Trellis niedostępny na :8004");
	}

	const job = await trellisGenerate({ prompt, quality: "standard" });
	const url = await trellisWaitForJob(job.job_id, { outId: job.out_id });
	await trellisDownloadGlb(url, dest);
	console.info(`Item saved: ${dest}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
