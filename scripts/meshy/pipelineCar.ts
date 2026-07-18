/**
 * Pełny pipeline Meshy → car.glb (FlyBall / Ignite)
 *
 *   npm run meshy:build-car
 *
 * Kolejność (docs/MESHY.md):
 *   retexture (opcjonalnie) → remesh → resize → Blender prep → Draco
 */

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import {
	downloadGlb,
	loadApiKey,
	loadTaskMeta,
	MESHY_ROOT,
	meshyFetch,
	modelToDataUri,
	pollMeshyTask,
	saveTaskMeta,
	syncArenaManifestFromDisk,
} from "./client.js";

const OCTANE_LENGTH_M = 1.18;
const TARGET_POLYS = 28_000;
const RETexture_PROMPT =
	"Futuristic rocket league cyberpunk car, proper 3D vehicle proportions with height and volume, " +
	"not flat or squashed, brushed chrome panels, cyan neon LED trim, carbon fiber, game-ready PBR";

const PATHS = {
	source: resolve(MESHY_ROOT, "T4.glb"),
	retextured: resolve(MESHY_ROOT, "public/assets/models/car_meshy.glb"),
	remeshed: resolve(MESHY_ROOT, "public/assets/models/car_meshy_low.glb"),
	sized: resolve(MESHY_ROOT, "public/assets/models/car_meshy_sized.glb"),
	final: resolve(MESHY_ROOT, "public/assets/models/car.glb"),
	work: resolve(MESHY_ROOT, "public/assets/models/.work/car_prep.glb"),
};

function parseArgs(): { retexture: boolean; input: string; id: string } {
	const args = process.argv.slice(2);
	let retexture = false;
	let input = PATHS.source;
	let id = "octane";
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--retexture") retexture = true;
		if (args[i] === "--input" && args[i + 1]) input = resolve(MESHY_ROOT, args[++i]);
		if (args[i] === "--id" && args[i + 1]) id = args[++i]!;
	}
	return { retexture, input, id };
}

function pathsForCar(id: string) {
	const isDefault = id === "octane";
	const outDir = isDefault
		? resolve(MESHY_ROOT, "public/assets/models")
		: resolve(MESHY_ROOT, "public/assets/cars");
	const finalName = isDefault ? "car.glb" : `${id}.glb`;
	return {
		source: PATHS.source,
		retextured: resolve(outDir, `.work/${id}_meshy.glb`),
		remeshed: resolve(outDir, `.work/${id}_meshy_low.glb`),
		sized: resolve(outDir, `.work/${id}_meshy_sized.glb`),
		final: resolve(outDir, finalName),
		work: resolve(outDir, `.work/${id}_prep.glb`),
	};
}

async function retextureFromFile(
	key: string,
	input: string,
	outPath: string,
): Promise<string> {
	console.info("Meshy retexture…");
	const res = (await meshyFetch(key, "/openapi/v1/retexture", {
		method: "POST",
		body: JSON.stringify({
			model_url: modelToDataUri(input),
			text_style_prompt: RETexture_PROMPT,
			ai_model: "latest",
			enable_original_uv: true,
			enable_pbr: true,
			hd_texture: true,
			remove_lighting: true,
			target_formats: ["glb"],
		}),
	})) as { result?: string };
	if (!res.result) throw new Error("retexture: brak task id");
	saveTaskMeta({ retextureTaskId: res.result });
	const task = await pollMeshyTask(key, "retexture", res.result);
	const url = task.model_urls?.glb;
	if (!url) throw new Error("retexture: brak GLB");
	await downloadGlb(url, outPath);
	return res.result;
}

async function remesh(
	key: string,
	inputTaskId: string,
	outPath: string,
): Promise<string> {
	console.info("Meshy remesh…");
	const res = (await meshyFetch(key, "/openapi/v1/remesh", {
		method: "POST",
		body: JSON.stringify({
			input_task_id: inputTaskId,
			target_formats: ["glb"],
			topology: "triangle",
			target_polycount: TARGET_POLYS,
		}),
	})) as { result?: string };
	if (!res.result) throw new Error("remesh: brak task id");
	saveTaskMeta({ remeshTaskId: res.result });
	const task = await pollMeshyTask(key, "remesh", res.result);
	const url = task.model_urls?.glb;
	if (!url) throw new Error("remesh: brak GLB");
	await downloadGlb(url, outPath);
	return res.result;
}

async function resizeToOctane(
	key: string,
	inputTaskId: string,
	outPath: string,
): Promise<string> {
	console.info(`Meshy resize (longest side = ${OCTANE_LENGTH_M} m)…`);
	const res = (await meshyFetch(key, "/openapi/v1/resize", {
		method: "POST",
		body: JSON.stringify({
			input_task_id: inputTaskId,
			resize_longest_side: OCTANE_LENGTH_M,
			origin_at: "bottom",
		}),
	})) as { result?: string };
	if (!res.result) throw new Error("resize: brak task id");
	saveTaskMeta({ resizeTaskId: res.result });
	const task = await pollMeshyTask(key, "resize", res.result);
	const url = task.model_urls?.glb;
	if (!url) throw new Error("resize: brak GLB");
	await downloadGlb(url, outPath);
	return res.result;
}

function runBlenderPrep(src: string): void {
	const r = spawnSync("bash", [resolve(MESHY_ROOT, "scripts/meshy_prep_car.sh")], {
		env: { ...process.env, MESHY_CAR_SRC: src, FLYBALL_ROOT: MESHY_ROOT },
		stdio: "inherit",
	});
	if (r.status !== 0) throw new Error("Blender prep failed");
}

function runGltfCompress(inPath: string, workPath: string, outPath: string): void {
	mkdirSync(resolve(workPath, ".."), { recursive: true });
	const npx = "npx";
	for (const [label, args] of [
		[
			"resize-textures",
			["--yes", "@gltf-transform/cli", "resize", inPath, workPath, "--width", "1024", "--height", "1024"],
		],
		[
			"draco",
			["--yes", "@gltf-transform/cli", "draco", workPath, outPath, "--method", "edgebreaker"],
		],
	] as const) {
		console.info(`gltf-transform ${label}…`);
		const r = spawnSync(npx, [...args], { cwd: MESHY_ROOT, stdio: "inherit" });
		if (r.status !== 0) throw new Error(`gltf-transform ${label} failed`);
	}
}

async function main(): Promise<void> {
	const key = loadApiKey();
	const { retexture, input, id } = parseArgs();
	const carPaths = pathsForCar(id);
	const meta = loadTaskMeta();
	const blenderOut = resolve(MESHY_ROOT, "public/assets/models/car.glb");

	let sourceTaskId = meta.retextureTaskId;
	if (retexture || !sourceTaskId) {
		sourceTaskId = await retextureFromFile(key, input, carPaths.retextured);
	} else {
		console.info("Pomijam retexture — używam task", sourceTaskId);
	}

	const remeshId = await remesh(key, sourceTaskId, carPaths.remeshed);
	await resizeToOctane(key, remeshId, carPaths.sized);

	runBlenderPrep(carPaths.sized);
	runGltfCompress(blenderOut, carPaths.work, carPaths.final);

	const { statSync } = await import("node:fs");
	const mb = (statSync(carPaths.final).size / (1024 * 1024)).toFixed(1);
	console.info(`\n✓ ${id}.glb gotowy (${mb} MB) → ${carPaths.final}`);
	if (id === "octane") syncArenaManifestFromDisk();
	console.info("  npm run dev:force");
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
