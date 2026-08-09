/**
 * Trellis image-to-3D: emblem menu głównego z konceptu ComfyUI.
 *   npm run trellis:build-menu-emblem
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
const CONCEPT = resolve(
	ROOT,
	"public/assets/ui/menu/ignite_menu_emblem_concept.png",
);
const DEST_DIR = resolve(ROOT, "public/assets/ui/menu");
const DEST = resolve(DEST_DIR, "ignite_menu_emblem.glb");

async function main(): Promise<void> {
	if (!existsSync(CONCEPT)) {
		throw new Error(
			`Brak konceptu: ${CONCEPT}\nNajpierw: npm run assets:menu-art`,
		);
	}
	if (!(await trellisHealth())) {
		throw new Error("Trellis niedostępny na :8004");
	}

	mkdirSync(DEST_DIR, { recursive: true });
	console.info("Trellis image-to-3D → menu emblem…");
	const job = await trellisGenerate({
		imagePath: CONCEPT,
		quality: "standard",
	});
	const url = await trellisWaitForJob(job.job_id, { outId: job.out_id });
	await trellisDownloadGlb(url, DEST);
	console.info(`\nEmblem saved: ${DEST}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
