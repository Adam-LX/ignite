/**
 * Meshy → power-up pickup GLB (magnet, plunger, haymaker, spikes)
 *   npm run meshy:build-powerups
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
const PICKUP_SIZE_M = 0.85;

const SPECS = [
	{
		id: "magnet" as const,
		prompt: MESHY_MODEL_PROMPTS.powerUpMagnet,
		final: "powerup_magnet.glb",
		metaKeys: {
			preview: "powerUpMagnetPreviewTaskId" as const,
			refine: "powerUpMagnetRefineTaskId" as const,
			remesh: "powerUpMagnetRemeshTaskId" as const,
			resize: "powerUpMagnetResizeTaskId" as const,
		},
	},
	{
		id: "plunger" as const,
		prompt: MESHY_MODEL_PROMPTS.powerUpPlunger,
		final: "powerup_plunger.glb",
		metaKeys: {
			preview: "powerUpPlungerPreviewTaskId" as const,
			refine: "powerUpPlungerRefineTaskId" as const,
			remesh: "powerUpPlungerRemeshTaskId" as const,
			resize: "powerUpPlungerResizeTaskId" as const,
		},
	},
	{
		id: "haymaker" as const,
		prompt: MESHY_MODEL_PROMPTS.powerUpHaymaker,
		final: "powerup_haymaker.glb",
		metaKeys: {
			preview: "powerUpHaymakerPreviewTaskId" as const,
			refine: "powerUpHaymakerRefineTaskId" as const,
			remesh: "powerUpHaymakerRemeshTaskId" as const,
			resize: "powerUpHaymakerResizeTaskId" as const,
		},
	},
	{
		id: "spikes" as const,
		prompt: MESHY_MODEL_PROMPTS.powerUpSpikes,
		final: "powerup_spikes.glb",
		metaKeys: {
			preview: "powerUpSpikesPreviewTaskId" as const,
			refine: "powerUpSpikesRefineTaskId" as const,
			remesh: "powerUpSpikesRemeshTaskId" as const,
			resize: "powerUpSpikesResizeTaskId" as const,
		},
	},
];

async function main(): Promise<void> {
	const key = loadApiKey();
	const force = process.argv.includes("--force");
	let meta = loadArenaTaskMeta();

	for (const spec of SPECS) {
		const paths = {
			raw: resolve(MODELS, `${spec.id}_meshy_raw.glb`),
			sized: resolve(MODELS, `${spec.id}_meshy_sized.glb`),
			final: resolve(MODELS, spec.final),
		};

		await ensureMeshyModel3d({
			key,
			force,
			label: `powerup-${spec.id}`,
			prompt: spec.prompt,
			paths,
			targetLongestSideM: PICKUP_SIZE_M,
			targetPolys: 4_000,
			meta: {
				previewTaskId: meta[spec.metaKeys.preview],
				refineTaskId: meta[spec.metaKeys.refine],
				remeshTaskId: meta[spec.metaKeys.remesh],
				resizeTaskId: meta[spec.metaKeys.resize],
			},
			onMeta: (patch) => {
				const mapped: Record<string, string> = {};
				if (patch.previewTaskId) mapped[spec.metaKeys.preview] = patch.previewTaskId;
				if (patch.refineTaskId) mapped[spec.metaKeys.refine] = patch.refineTaskId;
				if (patch.remeshTaskId) mapped[spec.metaKeys.remesh] = patch.remeshTaskId;
				if (patch.resizeTaskId) mapped[spec.metaKeys.resize] = patch.resizeTaskId;
				meta = saveArenaTaskMeta(mapped);
			},
		});
	}

	syncArenaManifestFromDisk();
	console.info("\n✓ Power-up GLB gotowe");
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
