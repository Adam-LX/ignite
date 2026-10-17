/**
 * Meshy → energy_pylon.glb
 *   npm run meshy:build-pylon
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
const PYLON_HEIGHT_M = 56;

const PATHS = {
	raw: resolve(MODELS, "pylon_meshy_raw.glb"),
	sized: resolve(MODELS, "pylon_meshy_sized.glb"),
	final: resolve(MODELS, "energy_pylon.glb"),
};

async function main(): Promise<void> {
	const key = loadApiKey();
	const force = process.argv.includes("--force");
	const meta = loadArenaTaskMeta();

	await ensureMeshyModel3d({
		key,
		force,
		label: "pylon",
		prompt: MESHY_MODEL_PROMPTS.pylon,
		paths: PATHS,
		targetLongestSideM: PYLON_HEIGHT_M,
		targetPolys: 12_000,
		meta: {
			previewTaskId: meta.pylonPreviewTaskId,
			refineTaskId: meta.pylonRefineTaskId,
			remeshTaskId: meta.pylonRemeshTaskId,
			resizeTaskId: meta.pylonResizeTaskId,
		},
		onMeta: (patch) => saveArenaTaskMeta(patch),
	});

	syncArenaManifestFromDisk();
	console.info("\n✓ energy_pylon.glb gotowy");
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
