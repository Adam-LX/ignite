import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import {
	createTextTo3dPreview,
	createTextTo3dRefine,
	downloadGlb,
	MESHY_ROOT,
	meshyFetch,
	pollMeshyTask,
	pollTextTo3d,
} from "./client.js";

export type Model3dPaths = {
	raw: string;
	sized: string;
	final: string;
};

export type Model3dGenOpts = {
	key: string;
	force: boolean;
	label: string;
	prompt: string;
	paths: Model3dPaths;
	targetLongestSideM: number;
	targetPolys: number;
	meta: {
		previewTaskId?: string;
		refineTaskId?: string;
		remeshTaskId?: string;
		resizeTaskId?: string;
	};
	onMeta: (patch: Partial<Model3dGenOpts["meta"]>) => void;
	/** Opcjonalny prep (Blender) przed draco. */
	prep?: () => void;
	compress?: boolean;
};

async function remeshModel(
	key: string,
	inputTaskId: string,
	targetPolys: number,
	outPath: string,
	label: string,
): Promise<string> {
	const res = (await meshyFetch(key, "/openapi/v1/remesh", {
		method: "POST",
		body: JSON.stringify({
			input_task_id: inputTaskId,
			target_formats: ["glb"],
			topology: "triangle",
			target_polycount: targetPolys,
		}),
	})) as { result?: string };
	if (!res.result) throw new Error(`${label} remesh: brak task id`);
	const task = await pollMeshyTask(key, "remesh", res.result, `${label} remesh`);
	const url = task.model_urls?.glb;
	if (!url) throw new Error(`${label} remesh: brak GLB`);
	await downloadGlb(url, outPath);
	return res.result;
}

async function resizeModel(
	key: string,
	inputTaskId: string,
	longestM: number,
	outPath: string,
	label: string,
): Promise<string> {
	const res = (await meshyFetch(key, "/openapi/v1/resize", {
		method: "POST",
		body: JSON.stringify({
			input_task_id: inputTaskId,
			resize_longest_side: longestM,
			origin_at: "bottom",
		}),
	})) as { result?: string };
	if (!res.result) throw new Error(`${label} resize: brak task id`);
	const task = await pollMeshyTask(key, "resize", res.result, `${label} resize`);
	const url = task.model_urls?.glb;
	if (!url) throw new Error(`${label} resize: brak GLB`);
	await downloadGlb(url, outPath);
	return res.result;
}

function dracoCompress(inPath: string, outPath: string, label: string): void {
	const work = resolve(MESHY_ROOT, "public/assets/models/.work", `${label}-prep.glb`);
	const r1 = spawnSync(
		"npx",
		[
			"--yes",
			"@gltf-transform/cli",
			"resize",
			inPath,
			work,
			"--width",
			"1024",
			"--height",
			"1024",
		],
		{ cwd: MESHY_ROOT, stdio: "inherit" },
	);
	if (r1.status !== 0) throw new Error(`gltf-transform resize ${label} failed`);
	const r2 = spawnSync(
		"npx",
		["--yes", "@gltf-transform/cli", "draco", work, outPath, "--method", "edgebreaker"],
		{ cwd: MESHY_ROOT, stdio: "inherit" },
	);
	if (r2.status !== 0) throw new Error(`gltf-transform draco ${label} failed`);
}

/** text-to-3d preview → refine → remesh → resize → opcjonalny prep → draco. */
export async function ensureMeshyModel3d(opts: Model3dGenOpts): Promise<void> {
	const {
		key,
		force,
		label,
		prompt,
		paths,
		targetLongestSideM,
		targetPolys,
		meta,
		onMeta,
		prep,
		compress = true,
	} = opts;

	if (!force && existsSync(paths.final)) {
		console.info(`Pomijam ${label} — ${paths.final} istnieje`);
		return;
	}

	let previewId = meta.previewTaskId;
	let refineId = meta.refineTaskId;

	if (force || !refineId || !existsSync(paths.raw)) {
		if (force || !previewId) {
			console.info(`Meshy text-to-3d preview: ${label}…`);
			previewId = await createTextTo3dPreview(key, prompt);
			onMeta({ previewTaskId: previewId });
			await pollTextTo3d(key, previewId, `${label} preview`);
		}
		console.info(`Meshy text-to-3d refine: ${label}…`);
		refineId = await createTextTo3dRefine(key, previewId!);
		onMeta({ refineTaskId: refineId });
		const refined = await pollTextTo3d(key, refineId, `${label} refine`);
		const url = refined.model_urls?.glb;
		if (!url) throw new Error(`${label} refine: brak GLB`);
		await downloadGlb(url, paths.raw);
	}

	let remeshId = meta.remeshTaskId;
	if (force || !existsSync(paths.sized)) {
		remeshId = await remeshModel(
			key,
			refineId!,
			targetPolys,
			paths.sized,
			label,
		);
		onMeta({ remeshTaskId: remeshId });
		const resizeId = await resizeModel(
			key,
			remeshId,
			targetLongestSideM,
			paths.sized,
			label,
		);
		onMeta({ resizeTaskId: resizeId });
	}

	if (prep) prep();
	else {
		const { copyFileSync, mkdirSync } = await import("node:fs");
		mkdirSync(resolve(paths.final, ".."), { recursive: true });
		copyFileSync(paths.sized, paths.final);
	}

	if (compress) dracoCompress(paths.final, paths.final, label);
}
