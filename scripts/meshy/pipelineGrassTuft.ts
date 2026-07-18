/**
 * Meshy → kępka trawy 3D (stadium_grass.glb)
 *   npm run meshy:build-grass-tuft
 *   npm run meshy:build-grass-tuft -- --force
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
const TUFT_HEIGHT_M = 0.55;

async function main(): Promise<void> {
	const key = loadApiKey();
	const force = process.argv.includes("--force");
	let meta = loadArenaTaskMeta();

	const paths = {
		raw: resolve(MODELS, "stadium_grass_meshy_raw.glb"),
		sized: resolve(MODELS, "stadium_grass_meshy_sized.glb"),
		final: resolve(MODELS, "stadium_grass.glb"),
	};

	await ensureMeshyModel3d({
		key,
		force,
		label: "stadium-grass-tuft",
		prompt: MESHY_MODEL_PROMPTS.grassTuft,
		paths,
		targetLongestSideM: TUFT_HEIGHT_M,
		targetPolys: 1_200,
		meta: {
			previewTaskId: meta.grassTuftPreviewTaskId,
			refineTaskId: meta.grassTuftRefineTaskId,
			remeshTaskId: meta.grassTuftRemeshTaskId,
			resizeTaskId: meta.grassTuftResizeTaskId,
		},
		onMeta: (patch) => {
			meta = saveArenaTaskMeta({
				...(patch.previewTaskId
					? { grassTuftPreviewTaskId: patch.previewTaskId }
					: {}),
				...(patch.refineTaskId
					? { grassTuftRefineTaskId: patch.refineTaskId }
					: {}),
				...(patch.remeshTaskId
					? { grassTuftRemeshTaskId: patch.remeshTaskId }
					: {}),
				...(patch.resizeTaskId
					? { grassTuftResizeTaskId: patch.resizeTaskId }
					: {}),
			});
		},
	});

	syncArenaManifestFromDisk();
	console.info("\n✓ stadium_grass.glb gotowe");
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
