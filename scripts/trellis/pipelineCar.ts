/**
 * Trellis → car GLB pipeline
 *   npm run trellis:build-car -- --id muscle --prompt "..."
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { appendCarToCatalog } from "./catalogUtils.js";
import {
	promptForEmptyWheelWells,
	wheelMountsForBodyStyle,
	type PipelineBodyStyle,
} from "./carWheelPipeline.js";
import {
	trellisBaseUrl,
	trellisDownloadGlb,
	trellisGenerate,
	trellisHealth,
	trellisWaitForHealthy,
	trellisWaitForJob,
} from "./client.js";

const ROOT = resolve(import.meta.dirname, "../..");
const OCTANE_LENGTH_M = 1.18;

/** Island-prune wygryza karoserię Trellis (dziury) — wyłączone dla wszystkich. */
const PRUNE_ISLAND_CAR_IDS = new Set<string>();

type DesignCar = {
	id: string;
	nameKey: string;
	rarity: "common" | "rare" | "epic" | "legendary";
	bodyStyle: PipelineBodyStyle;
	defaultUnlocked: boolean;
	trellisPrompt: string;
	defaultWheelId?: string;
};

function loadDesignCar(id: string): DesignCar | undefined {
	const designPath = resolve(ROOT, "data/content/cars.design.json");
	const design = JSON.parse(readFileSync(designPath, "utf8")) as { cars: DesignCar[] };
	return design.cars.find((c) => c.id === id);
}

function bodyStyleForCarId(id: string, design?: DesignCar): PipelineBodyStyle {
	if (design?.bodyStyle) return design.bodyStyle;
	if (id === "muscle" || id === "buggy" || id === "bruiser" || id === "bruiserNeo")
		return "wide";
	if (id === "truck") return "tall";
	if (id === "hatch") return "hatch";
	return "low";
}

function rarityForCarId(id: string, design?: DesignCar): DesignCar["rarity"] {
	if (design?.rarity) return design.rarity;
	if (id === "sleek" || id === "phantom") return "epic";
	if (id === "truck" || id === "bruiser" || id === "bruiserNeo") return "legendary";
	return "rare";
}

const DEFAULT_PROMPTS: Record<string, string> = {
	muscle:
		"Wide muscle hover car, aggressive fenders, orange neon underglow, game-ready PBR vehicle",
	sleek:
		"Low profile sleek supercar hover, aerodynamic wedge shape, purple neon accents, game-ready PBR vehicle",
};

function parseArgs(): {
	id: string;
	prompt: string;
	fromOutId?: string;
	imagePath?: string;
	prepOnly: boolean;
	quality: "standard" | "high" | "ultra";
} {
	const args = process.argv.slice(2);
	let id = "muscle";
	let prompt = "";
	let fromOutId: string | undefined;
	let imagePath: string | undefined;
	let prepOnly = false;
	let quality: "standard" | "high" | "ultra" =
		(process.env.FLYBALL_TRELLIS_QUALITY as "standard" | "high" | "ultra") ??
		"standard";
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--id" && args[i + 1]) id = args[++i]!;
		if (args[i] === "--prompt" && args[i + 1]) prompt = args[++i]!;
		if (args[i] === "--from-out-id" && args[i + 1]) fromOutId = args[++i]!;
		if (args[i] === "--image" && args[i + 1]) imagePath = args[++i]!;
		if (args[i] === "--quality" && args[i + 1]) {
			const q = args[++i]!;
			if (q === "standard" || q === "high" || q === "ultra") quality = q;
		}
		if (args[i] === "--prep-only") prepOnly = true;
	}
	if (!prompt) {
		const design = loadDesignCar(id);
		prompt = design?.trellisPrompt ?? DEFAULT_PROMPTS[id] ?? DEFAULT_PROMPTS.muscle!;
	}
	return { id, prompt, fromOutId, imagePath, prepOnly, quality };
}

function findBlenderBin(): string {
	const which = spawnSync("which", ["blender"], { encoding: "utf8" });
	if (which.stdout.trim()) return which.stdout.trim();
	const nix = spawnSync("bash", ["-c", "ls -d /nix/store/*-blender-*/bin/blender 2>/dev/null | tail -1"], {
		encoding: "utf8",
	});
	return nix.stdout.trim() || "blender";
}

function runBlenderPrep(
	input: string,
	output: string,
	carId: string,
	emptyWells = true,
): void {
	const blenderBin = findBlenderBin();
	const script = resolve(ROOT, "scripts/blender_prep_meshy_car.py");
	const pruneIslands = PRUNE_ISLAND_CAR_IDS.has(carId) ? "1" : "0";
	const darkenGlass =
		carId === "bruiser" || carId === "bruiserNeo" ? "1" : "0";
	const repairMesh = "0";
	/** Gentle weld + interior cull wygryza Trellis (Bułdog Neo, Ostrze, …). */
	const gentleWeld = "0";
	const invertThreshold = "-0.04";
	const r = spawnSync(
		blenderBin,
		["--background", "--python", script, "--", input, output],
		{
			stdio: "inherit",
			cwd: ROOT,
			env: {
				...process.env,
				FLYBALL_EMPTY_WHEEL_WELLS: emptyWells ? "1" : "0",
				FLYBALL_WHEEL_STRIP_RADIUS: "0",
				FLYBALL_STRIP_SPARE: "0",
				FLYBALL_PRUNE_ISLANDS: pruneIslands,
				FLYBALL_DARKEN_MILKY_GLASS: darkenGlass,
				FLYBALL_REPAIR_MESH: repairMesh,
				FLYBALL_GENTLE_WELD: gentleWeld,
				FLYBALL_DROP_INVERTED: "0",
				FLYBALL_INVERT_THRESHOLD: invertThreshold,
				FLYBALL_INTERIOR_SHELL_FRAC: "0.035",
				FLYBALL_FORCE_UPRIGHT_FLIP: "0",
			},
		},
	);
	if (r.status !== 0) {
		console.warn("Blender prep failed — kopiuję surowy GLB");
		copyFileSync(input, output);
	}
}

async function main(): Promise<void> {
	const { id, prompt, fromOutId, imagePath, prepOnly, quality } = parseArgs();
	const designCar = loadDesignCar(id);
	const outDir = resolve(ROOT, "public/assets/cars");
	const workDir = resolve(outDir, ".work");
	mkdirSync(workDir, { recursive: true });

	const rawGlb = resolve(workDir, `${id}_trellis_raw.glb`);
	const finalGlb = resolve(outDir, `${id}.glb`);

	if (prepOnly) {
		const raw = resolve(workDir, `${id}_trellis_raw.glb`);
		const src = existsSync(raw) ? raw : resolve(outDir, `${id}.glb`);
		if (!existsSync(src)) {
			throw new Error(`Brak ${src} — najpierw trellis:build-car`);
		}
		const tmp = resolve(workDir, `${id}_prep.glb`);
		runBlenderPrep(src, tmp, id);
		copyFileSync(tmp, finalGlb);
		console.info(`Prep-only: ${finalGlb}${existsSync(raw) ? " (z raw)" : ""}`);
		return;
	}

	let glbUrl: string;
	if (fromOutId) {
		glbUrl = `${trellisBaseUrl()}/view/${fromOutId}.glb`;
		console.info(`Skip generate — pobieram istniejący ${fromOutId}.glb`);
	} else {
		if (!(await trellisHealth())) {
			console.warn("Trellis offline — czekam na :8004…");
			await trellisWaitForHealthy();
		}
		console.info(`Trellis generate: ${id}`);
		const fullPrompt = promptForEmptyWheelWells(prompt);
		if (imagePath) {
			const absImage = resolve(ROOT, imagePath);
			if (!existsSync(absImage)) throw new Error(`Brak obrazu referencyjnego: ${absImage}`);
			console.info(`Image-to-3D: ${absImage} (quality=${quality})`);
			const job = await trellisGenerate({ imagePath: absImage, quality });
			glbUrl = await trellisWaitForJob(job.job_id, { outId: job.out_id });
		} else {
			console.info(`Prompt: ${fullPrompt}`);
			console.info(`Quality: ${quality}`);
			const job = await trellisGenerate({ prompt: fullPrompt, quality });
			glbUrl = await trellisWaitForJob(job.job_id, { outId: job.out_id });
		}
	}

	await trellisDownloadGlb(glbUrl, rawGlb);

	const bodyStyle = bodyStyleForCarId(id, designCar);
	const catalogPrompt = promptForEmptyWheelWells(prompt);

	runBlenderPrep(rawGlb, finalGlb, id, true);

	appendCarToCatalog({
		id,
		nameKey: designCar?.nameKey ?? `garage.car.${id}`,
		glb: `/assets/cars/${id}.glb`,
		rarity: rarityForCarId(id, designCar),
		bodyStyle,
		source: "trellis",
		generationPrompt: catalogPrompt,
		tintable: true,
		defaultUnlocked: designCar?.defaultUnlocked ?? false,
		wheelWellMode: "empty",
		wheelMounts: wheelMountsForBodyStyle(bodyStyle),
		...(designCar?.defaultWheelId ? { defaultWheelId: designCar.defaultWheelId } : {}),
	});

	console.info(`Done: ${finalGlb} (${OCTANE_LENGTH_M}m target via Blender prep)`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
