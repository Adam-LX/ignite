/**
 * Meshy → kafel menu 3D (menu_tile.glb)
 *   npm run meshy:build-menu-tile
 *   npm run meshy:build-menu-tile -- --force
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
const TILE_WIDTH_M = 2.6;

async function main(): Promise<void> {
	const key = loadApiKey();
	const force = process.argv.includes("--force");
	let meta = loadArenaTaskMeta();

	const paths = {
		raw: resolve(MODELS, "menu_tile_meshy_raw.glb"),
		sized: resolve(MODELS, "menu_tile_meshy_sized.glb"),
		final: resolve(MODELS, "menu_tile.glb"),
	};

	await ensureMeshyModel3d({
		key,
		force,
		label: "menu-tile",
		prompt: MESHY_MODEL_PROMPTS.menuTile,
		paths,
		targetLongestSideM: TILE_WIDTH_M,
		targetPolys: 3_500,
		meta: {
			previewTaskId: meta.menuTilePreviewTaskId,
			refineTaskId: meta.menuTileRefineTaskId,
			remeshTaskId: meta.menuTileRemeshTaskId,
			resizeTaskId: meta.menuTileResizeTaskId,
		},
		onMeta: (patch) => {
			meta = saveArenaTaskMeta({
				...(patch.previewTaskId
					? { menuTilePreviewTaskId: patch.previewTaskId }
					: {}),
				...(patch.refineTaskId
					? { menuTileRefineTaskId: patch.refineTaskId }
					: {}),
				...(patch.remeshTaskId
					? { menuTileRemeshTaskId: patch.remeshTaskId }
					: {}),
				...(patch.resizeTaskId
					? { menuTileResizeTaskId: patch.resizeTaskId }
					: {}),
			});
		},
	});

	syncArenaManifestFromDisk();
	console.info("\n✓ menu_tile.glb gotowe");
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
