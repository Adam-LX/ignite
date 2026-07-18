/**
 * Meshy → kompletna bramka (rama + siatka) jako jeden GLB
 *
 *   npm run meshy:build-goal-complete
 *   npm run meshy:build-goal-complete -- --force
 */

import { copyFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import {
	createTextTo3dPreview,
	createTextTo3dRefine,
	downloadGlb,
	loadApiKey,
	loadArenaTaskMeta,
	meshyFetch,
	MESHY_ROOT,
	pollMeshyTask,
	pollTextTo3d,
	saveArenaTaskMeta,
	syncArenaManifestFromDisk,
} from "./client.js";

const MODELS = resolve(MESHY_ROOT, "public/assets/models");

const GOAL_WIDTH_M = 18;
const GOAL_TARGET_POLYS = 20_000;

const PROMPT =
	"Complete futuristic stadium soccer goal, sci-fi cyber sports goal cage, " +
	"professional stadium design with a sharp rectangular front frame and beautiful " +
	"aerodynamic parabolic arched supports curving down to the back, integrated glowing " +
	"energy net filling the back and sides, dark matte carbon fiber chrome chassis, " +
	"glowing neon line accents, solid single game asset, low-poly, gltf format";

const PATHS = {
	raw: resolve(MODELS, "stadium_goal_complete_meshy.glb"),
	sized: resolve(MODELS, "stadium_goal_complete_sized.glb"),
	final: resolve(MODELS, "stadium_goal_complete.glb"),
};

function parseArgs(): { force: boolean } {
	return { force: process.argv.slice(2).includes("--force") };
}

async function remeshGoal(key: string, inputTaskId: string): Promise<string> {
	const res = (await meshyFetch(key, "/openapi/v1/remesh", {
		method: "POST",
		body: JSON.stringify({
			input_task_id: inputTaskId,
			target_formats: ["glb"],
			topology: "triangle",
			target_polycount: GOAL_TARGET_POLYS,
		}),
	})) as { result?: string };
	if (!res.result) throw new Error("goal complete remesh: brak task id");
	saveArenaTaskMeta({ goalCompleteRemeshTaskId: res.result });
	const task = await pollMeshyTask(
		key,
		"remesh",
		res.result,
		"bramka complete remesh",
	);
	const url = task.model_urls?.glb;
	if (!url) throw new Error("goal complete remesh: brak GLB");
	await downloadGlb(url, PATHS.sized);
	return res.result;
}

async function resizeGoal(key: string, inputTaskId: string): Promise<void> {
	const res = (await meshyFetch(key, "/openapi/v1/resize", {
		method: "POST",
		body: JSON.stringify({
			input_task_id: inputTaskId,
			resize_longest_side: GOAL_WIDTH_M,
			origin_at: "bottom",
		}),
	})) as { result?: string };
	if (!res.result) throw new Error("goal complete resize: brak task id");
	saveArenaTaskMeta({ goalCompleteResizeTaskId: res.result });
	const task = await pollMeshyTask(
		key,
		"resize",
		res.result,
		"bramka complete resize",
	);
	const url = task.model_urls?.glb;
	if (!url) throw new Error("goal complete resize: brak GLB");
	await downloadGlb(url, PATHS.sized);
}

function publishGoalGlb(): void {
	copyFileSync(PATHS.sized, PATHS.final);
	console.info(`Bramka complete → ${PATHS.final}`);
}

function compressGoalGlb(): void {
	const work = resolve(MODELS, ".work/stadium_goal_complete_prep.glb");
	const r1 = spawnSync(
		"npx",
		[
			"--yes",
			"@gltf-transform/cli",
			"resize",
			PATHS.final,
			work,
			"--width",
			"1024",
			"--height",
			"1024",
		],
		{ cwd: MESHY_ROOT, stdio: "inherit" },
	);
	if (r1.status !== 0) throw new Error("gltf-transform resize goal complete failed");
	const r2 = spawnSync(
		"npx",
		["--yes", "@gltf-transform/cli", "draco", work, PATHS.final, "--method", "edgebreaker"],
		{ cwd: MESHY_ROOT, stdio: "inherit" },
	);
	if (r2.status !== 0) throw new Error("gltf-transform draco goal complete failed");
}

async function generateGoalComplete(key: string, force: boolean): Promise<void> {
	if (!force && existsSync(PATHS.final)) {
		console.info("Pomijam — stadium_goal_complete.glb istnieje");
		return;
	}

	const meta = loadArenaTaskMeta();
	let previewId = meta.goalCompletePreviewTaskId;
	let refineId = meta.goalCompleteRefineTaskId;

	if (force || !refineId || !existsSync(PATHS.raw)) {
		if (force || !previewId) {
			console.info("Meshy text-to-3d preview: kompletna bramka…");
			previewId = await createTextTo3dPreview(key, PROMPT);
			saveArenaTaskMeta({ goalCompletePreviewTaskId: previewId });
			await pollTextTo3d(key, previewId, "bramka complete preview");
		}
		console.info("Meshy text-to-3d refine: kompletna bramka PBR…");
		refineId = await createTextTo3dRefine(key, previewId!);
		saveArenaTaskMeta({ goalCompleteRefineTaskId: refineId });
		const refined = await pollTextTo3d(key, refineId, "bramka complete refine");
		const url = refined.model_urls?.glb;
		if (!url) throw new Error("bramka complete refine: brak GLB");
		await downloadGlb(url, PATHS.raw);
	}

	if (force || !existsSync(PATHS.sized)) {
		const remeshId = await remeshGoal(key, refineId!);
		await resizeGoal(key, remeshId);
	}

	publishGoalGlb();
	compressGoalGlb();
	syncArenaManifestFromDisk();
}

async function main(): Promise<void> {
	const key = loadApiKey();
	const { force } = parseArgs();
	await generateGoalComplete(key, force);
	console.info("\n✓ Kompletna bramka Meshy gotowa — npm run dev:force");
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
