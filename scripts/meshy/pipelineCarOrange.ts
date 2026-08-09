/**
 * Meshy → car_orange.glb (retexture pomarańczowy)
 *
 *   npm run meshy:build-car:orange
 *   npm run meshy:build-car:orange -- --retexture
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import {
	downloadGlb,
	loadApiKey,
	MESHY_ROOT,
	meshyFetch,
	modelToDataUri,
	pollMeshyTask,
	syncArenaManifestFromDisk,
} from "./client.js";
import { MESHY_CAR_PROMPTS } from "./prompts.js";

const OCTANE_LENGTH_M = 1.18;
const TARGET_POLYS = 28_000;
const TASK_FILE = resolve(MESHY_ROOT, "data/meshy-car-orange-task.json");

const PATHS = {
	source: resolve(MESHY_ROOT, "T4.glb"),
	retextured: resolve(MESHY_ROOT, "public/assets/models/car_orange_meshy.glb"),
	remeshed: resolve(MESHY_ROOT, "public/assets/models/car_orange_meshy_low.glb"),
	sized: resolve(MESHY_ROOT, "public/assets/models/car_orange_meshy_sized.glb"),
	final: resolve(MESHY_ROOT, "public/assets/models/car_orange.glb"),
	work: resolve(MESHY_ROOT, "public/assets/models/.work/car_orange_prep.glb"),
};

type OrangeMeta = {
	retextureTaskId?: string;
	remeshTaskId?: string;
	resizeTaskId?: string;
};

function loadOrangeMeta(): OrangeMeta {
	if (!existsSync(TASK_FILE)) return {};
	return JSON.parse(readFileSync(TASK_FILE, "utf8")) as OrangeMeta;
}

function saveOrangeMeta(patch: Partial<OrangeMeta>): void {
	const next = {
		...loadOrangeMeta(),
		...patch,
		updatedAt: new Date().toISOString(),
	};
	writeFileSync(TASK_FILE, `${JSON.stringify(next, null, "\t")}\n`);
}

async function retextureFromFile(key: string, input: string): Promise<string> {
	console.info("Meshy retexture (orange)…");
	const res = (await meshyFetch(key, "/openapi/v1/retexture", {
		method: "POST",
		body: JSON.stringify({
			model_url: modelToDataUri(input),
			text_style_prompt: MESHY_CAR_PROMPTS.orange,
			ai_model: "latest",
			enable_original_uv: true,
			enable_pbr: true,
			hd_texture: true,
			remove_lighting: true,
			target_formats: ["glb"],
		}),
	})) as { result?: string };
	if (!res.result) throw new Error("retexture orange: brak task id");
	saveOrangeMeta({ retextureTaskId: res.result });
	const task = await pollMeshyTask(key, "retexture", res.result);
	const url = task.model_urls?.glb;
	if (!url) throw new Error("retexture orange: brak GLB");
	await downloadGlb(url, PATHS.retextured);
	return res.result;
}

async function remesh(key: string, inputTaskId: string): Promise<string> {
	const res = (await meshyFetch(key, "/openapi/v1/remesh", {
		method: "POST",
		body: JSON.stringify({
			input_task_id: inputTaskId,
			target_formats: ["glb"],
			topology: "triangle",
			target_polycount: TARGET_POLYS,
		}),
	})) as { result?: string };
	if (!res.result) throw new Error("orange remesh: brak task id");
	saveOrangeMeta({ remeshTaskId: res.result });
	const task = await pollMeshyTask(key, "remesh", res.result);
	const url = task.model_urls?.glb;
	if (!url) throw new Error("orange remesh: brak GLB");
	await downloadGlb(url, PATHS.remeshed);
	return res.result;
}

async function resizeToOctane(key: string, inputTaskId: string): Promise<void> {
	const res = (await meshyFetch(key, "/openapi/v1/resize", {
		method: "POST",
		body: JSON.stringify({
			input_task_id: inputTaskId,
			resize_longest_side: OCTANE_LENGTH_M,
			origin_at: "bottom",
		}),
	})) as { result?: string };
	if (!res.result) throw new Error("orange resize: brak task id");
	saveOrangeMeta({ resizeTaskId: res.result });
	const task = await pollMeshyTask(key, "resize", res.result);
	const url = task.model_urls?.glb;
	if (!url) throw new Error("orange resize: brak GLB");
	await downloadGlb(url, PATHS.sized);
}

function runBlenderPrep(): void {
	const r = spawnSync("bash", [resolve(MESHY_ROOT, "scripts/meshy_prep_car.sh")], {
		env: {
			...process.env,
			MESHY_CAR_SRC: PATHS.sized,
			MESHY_CAR_OUT: PATHS.final,
			FLYBALL_ROOT: MESHY_ROOT,
		},
		stdio: "inherit",
	});
	if (r.status !== 0) throw new Error("Blender orange prep failed");
}

function runGltfCompress(): void {
	mkdirSync(resolve(MESHY_ROOT, "public/assets/models/.work"), { recursive: true });
	for (const [label, args] of [
		[
			"resize-textures",
			[
				"--yes",
				"@gltf-transform/cli",
				"resize",
				PATHS.final,
				PATHS.work,
				"--width",
				"1024",
				"--height",
				"1024",
			],
		],
		[
			"draco",
			[
				"--yes",
				"@gltf-transform/cli",
				"draco",
				PATHS.work,
				PATHS.final,
				"--method",
				"edgebreaker",
			],
		],
	] as const) {
		const r = spawnSync("npx", [...args], { cwd: MESHY_ROOT, stdio: "inherit" });
		if (r.status !== 0) throw new Error(`gltf-transform ${label} orange failed`);
	}
}

async function main(): Promise<void> {
	const key = loadApiKey();
	const retexture = process.argv.includes("--retexture");
	const input = PATHS.source;
	const meta = loadOrangeMeta();

	let sourceTaskId = meta.retextureTaskId;
	if (retexture || !sourceTaskId) {
		sourceTaskId = await retextureFromFile(key, input);
	}

	const remeshId = await remesh(key, sourceTaskId);
	await resizeToOctane(key, remeshId);
	runBlenderPrep();
	runGltfCompress();
	syncArenaManifestFromDisk();
	console.info("\n✓ car_orange.glb gotowy — npm run dev:force");
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
