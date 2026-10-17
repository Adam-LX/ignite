/**
 * remesh + resize (1.18 m) + Blender prep + Draco
 * @see docs/MESHY.md
 */

import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import {
	downloadGlb,
	loadApiKey,
	loadTaskMeta,
	MESHY_ROOT,
	meshyFetch,
	pollMeshyTask,
	saveTaskMeta,
} from "./meshy/client.js";

const OCTANE_LENGTH_M = 1.18;
const TARGET_POLYS = 28_000;

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
	if (!res.result) throw new Error("remesh: brak task id");
	saveTaskMeta({ remeshTaskId: res.result });
	const task = await pollMeshyTask(key, "remesh", res.result);
	const url = task.model_urls?.glb;
	if (!url) throw new Error("remesh: brak GLB");
	const out = resolve(MESHY_ROOT, "public/assets/models/car_meshy_low.glb");
	await downloadGlb(url, out);
	return res.result;
}

async function resize(key: string, inputTaskId: string): Promise<string> {
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
	const out = resolve(MESHY_ROOT, "public/assets/models/car_meshy_sized.glb");
	await downloadGlb(url, out);
	return res.result;
}

function runBlenderAndCompress(): void {
	const sized = resolve(MESHY_ROOT, "public/assets/models/car_meshy_sized.glb");
	const final = resolve(MESHY_ROOT, "public/assets/models/car.glb");
	const work = resolve(MESHY_ROOT, "public/assets/models/.work/car_prep.glb");

	const prep = spawnSync("bash", [resolve(MESHY_ROOT, "scripts/meshy_prep_car.sh")], {
		env: { ...process.env, MESHY_CAR_SRC: sized, FLYBALL_ROOT: MESHY_ROOT },
		stdio: "inherit",
	});
	if (prep.status !== 0) throw new Error("Blender prep failed");

	for (const args of [
		["--yes", "@gltf-transform/cli", "resize", final, work, "--width", "1024", "--height", "1024"],
		["--yes", "@gltf-transform/cli", "draco", work, final, "--method", "edgebreaker"],
	]) {
		const r = spawnSync("npx", args, { cwd: MESHY_ROOT, stdio: "inherit" });
		if (r.status !== 0) throw new Error("gltf-transform failed");
	}
}

async function main(): Promise<void> {
	const key = loadApiKey();
	const meta = loadTaskMeta();
	const source = meta.retextureTaskId;
	if (!source) throw new Error("Brak retextureTaskId — uruchom npm run meshy:build-car");

	const remeshId = await remesh(key, source);
	await resize(key, remeshId);
	runBlenderAndCompress();
	console.info("\n✓ car.glb zaktualizowany (docs/MESHY.md)");
}

main().catch((e) => {
	console.error(e instanceof Error ? e.message : e);
	process.exit(1);
});
