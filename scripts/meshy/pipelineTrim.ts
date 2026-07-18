/**
 * Meshy → stadium_trim.glb (modular pitch border)
 *   npm run meshy:build-trim
 */

import { resolve } from "node:path";

import {
	loadApiKey,
	loadArenaTaskMeta,
	MESHY_ROOT,
	saveArenaTaskMeta,
	syncArenaManifestFromDisk,
} from "./client.js";
import { ensureMeshyModel3d } from "./model3dGen.js";
import { MESHY_MODEL_PROMPTS } from "./prompts.js";

const MODELS = resolve(MESHY_ROOT, "public/assets/models");
/** Długość jednego modułu krawężnika wzdłuż linii boiska (m). */
const TRIM_MODULE_M = 3.5;

const PATHS = {
	raw: resolve(MODELS, "stadium_trim_meshy.glb"),
	sized: resolve(MODELS, "stadium_trim_meshy_sized.glb"),
	final: resolve(MODELS, "stadium_trim.glb"),
};

async function main(): Promise<void> {
	const key = loadApiKey();
	const force = process.argv.includes("--force");
	const meta = loadArenaTaskMeta();

	await ensureMeshyModel3d({
		key,
		force,
		label: "stadium-trim",
		prompt: MESHY_MODEL_PROMPTS.stadiumTrim,
		paths: PATHS,
		targetLongestSideM: TRIM_MODULE_M,
		targetPolys: 8_000,
		meta: {
			previewTaskId: meta.trimPreviewTaskId,
			refineTaskId: meta.trimRefineTaskId,
			remeshTaskId: meta.trimRemeshTaskId,
			resizeTaskId: meta.trimResizeTaskId,
		},
		onMeta: (patch) =>
			saveArenaTaskMeta({
				trimPreviewTaskId: patch.previewTaskId,
				trimRefineTaskId: patch.refineTaskId,
				trimRemeshTaskId: patch.remeshTaskId,
				trimResizeTaskId: patch.resizeTaskId,
			}),
	});

	syncArenaManifestFromDisk();
	console.info("\n✓ stadium_trim.glb gotowy — npm run dev:force");
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
