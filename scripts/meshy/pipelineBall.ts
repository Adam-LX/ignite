/**
 * Meshy → piłka (referencja obrazu → model 3D + albedo)
 *
 *   npm run meshy:build-ball -- --from-image public/assets/textures/ball_meshy_reference.png --force
 *   npm run meshy:build-ball
 *   npm run meshy:build-ball -- --texture-only
 */

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import {
	createImageTo3d,
	createTextTo3dPreview,
	createTextTo3dRefine,
	createTextToImage,
	downloadGlb,
	downloadUrl,
	imageToDataUri,
	loadApiKey,
	loadBallTaskMeta,
	meshyFetch,
	MESHY_ROOT,
	pollImageTo3d,
	pollMeshyTask,
	pollTextTo3d,
	pollTextToImage,
	saveBallTaskMeta,
	syncArenaManifestFromDisk,
} from "./client.js";

const TEX = resolve(MESHY_ROOT, "public/assets/textures");
const MODELS = resolve(MESHY_ROOT, "public/assets/models");

/** RL piłka: średnica 1.825 m */
const BALL_DIAMETER_M = 1.825;
const BALL_TARGET_POLYS = 8_000;

const PROMPTS = {
	albedo:
		"Futuristic sci-fi sports ball, weathered dark gunmetal panels, cyan blue neon on left half, " +
		"orange neon on right half, hexagonal mesh inserts, battle-worn brushed metal, PBR albedo, " +
		"flat studio lighting, no background, no text",
	ball3d:
		"Perfect sphere futuristic sci-fi sports ball, intricate geometric paneling, weathered dark metal, " +
		"cyan and orange emissive neon accents, chrome carbon fiber, game-ready 3D asset, clean topology",
} as const;

const PATHS = {
	reference: resolve(TEX, "ball_meshy_reference.png"),
	albedo: resolve(TEX, "meshy_ball_albedo.jpg"),
	raw: resolve(MODELS, "ball_meshy.glb"),
	sized: resolve(MODELS, "ball_meshy_sized.glb"),
	final: resolve(MODELS, "ball_meshy.glb"),
	gameBall: resolve(MODELS, "ball.glb"),
};

function parseArgs(): {
	textureOnly: boolean;
	force: boolean;
	localOnly: boolean;
	fromImage: string | null;
} {
	const args = process.argv.slice(2);
	let fromImage: string | null = null;
	const idx = args.indexOf("--from-image");
	if (idx >= 0 && args[idx + 1]) {
		fromImage = resolve(MESHY_ROOT, args[idx + 1]!);
	}
	return {
		textureOnly: args.includes("--texture-only"),
		force: args.includes("--force"),
		localOnly: args.includes("--local-only"),
		fromImage,
	};
}

async function generateBallAlbedo(key: string, force: boolean): Promise<void> {
	const meta = loadBallTaskMeta();
	let taskId = meta.ballAlbedoTaskId;
	if (force || !taskId || !existsSync(PATHS.albedo)) {
		console.info("Meshy text-to-image: piłka albedo…");
		taskId = await createTextToImage(key, PROMPTS.albedo, "1:1");
		saveBallTaskMeta({ ballAlbedoTaskId: taskId });
	}
	const task = await pollTextToImage(key, taskId, "piłka albedo");
	const url = task.image_urls?.[0];
	if (!url) throw new Error("piłka albedo: brak image_urls");
	await downloadUrl(url, PATHS.albedo);
}

async function remeshBall(key: string, inputTaskId: string): Promise<string> {
	const res = (await meshyFetch(key, "/openapi/v1/remesh", {
		method: "POST",
		body: JSON.stringify({
			input_task_id: inputTaskId,
			target_formats: ["glb"],
			topology: "triangle",
			target_polycount: BALL_TARGET_POLYS,
		}),
	})) as { result?: string };
	if (!res.result) throw new Error("ball remesh: brak task id");
	saveBallTaskMeta({ ballRemeshTaskId: res.result });
	const task = await pollMeshyTask(key, "remesh", res.result, "piłka remesh");
	const url = task.model_urls?.glb;
	if (!url) throw new Error("ball remesh: brak GLB");
	await downloadGlb(url, PATHS.sized);
	return res.result;
}

async function resizeBall(key: string, inputTaskId: string): Promise<void> {
	const res = (await meshyFetch(key, "/openapi/v1/resize", {
		method: "POST",
		body: JSON.stringify({
			input_task_id: inputTaskId,
			resize_longest_side: BALL_DIAMETER_M,
			origin_at: "center",
		}),
	})) as { result?: string };
	if (!res.result) throw new Error("ball resize: brak task id");
	saveBallTaskMeta({ ballResizeTaskId: res.result });
	const task = await pollMeshyTask(key, "resize", res.result, "piłka resize");
	const url = task.model_urls?.glb;
	if (!url) throw new Error("ball resize: brak GLB");
	await downloadGlb(url, PATHS.sized);
}

function compressBallGlb(): void {
	const workDir = resolve(MODELS, ".work");
	mkdirSync(workDir, { recursive: true });
	const work = resolve(workDir, "ball_prep.glb");
	if (!existsSync(PATHS.sized)) {
		throw new Error(
			`Brak ${PATHS.sized} — uruchom meshy:build-ball (API) lub podaj --from-image`,
		);
	}
	const r1 = spawnSync(
		"npx",
		[
			"--yes",
			"@gltf-transform/cli",
			"resize",
			PATHS.sized,
			work,
			"--width",
			"1024",
			"--height",
			"1024",
		],
		{ cwd: MESHY_ROOT, stdio: "inherit" },
	);
	if (r1.status !== 0) throw new Error("gltf-transform resize ball failed");
	const r2 = spawnSync(
		"npx",
		["--yes", "@gltf-transform/cli", "draco", work, PATHS.final, "--method", "edgebreaker"],
		{ cwd: MESHY_ROOT, stdio: "inherit" },
	);
	if (r2.status !== 0) throw new Error("gltf-transform draco ball failed");
}

async function generateBallFromImage(
	key: string,
	imagePath: string,
	force: boolean,
): Promise<void> {
	if (!existsSync(imagePath)) {
		throw new Error(`Brak obrazu referencyjnego: ${imagePath}`);
	}

	const meta = loadBallTaskMeta();
	let taskId = meta.ballImageTo3dTaskId;

	if (force || !taskId || !existsSync(PATHS.raw)) {
		console.info(`Meshy image-to-3d: ${imagePath}…`);
		const dataUri = imageToDataUri(imagePath);
		taskId = await createImageTo3d(key, dataUri);
		saveBallTaskMeta({ ballImageTo3dTaskId: taskId });
		const task = await pollImageTo3d(key, taskId, "piłka image-to-3d");
		const url = task.model_urls?.glb;
		if (!url) throw new Error("piłka image-to-3d: brak GLB");
		await downloadGlb(url, PATHS.raw);
	}

	let remeshId = meta.ballRemeshTaskId;
	if (force || !existsSync(PATHS.sized)) {
		remeshId = await remeshBall(key, taskId!);
		await resizeBall(key, remeshId);
	}

	compressBallGlb();
	syncGameBallFromMeshy();
}

async function generateBallModel(key: string, force: boolean): Promise<void> {
	if (!force && existsSync(PATHS.final)) {
		console.info("Pomijam model piłki — ball_meshy.glb istnieje");
		syncGameBallFromMeshy();
		return;
	}

	const meta = loadBallTaskMeta();
	let previewId = meta.ballPreviewTaskId;
	let refineId = meta.ballRefineTaskId;

	if (force || !refineId || !existsSync(PATHS.raw)) {
		if (force || !previewId) {
			console.info("Meshy text-to-3d preview: piłka…");
			previewId = await createTextTo3dPreview(key, PROMPTS.ball3d);
			saveBallTaskMeta({ ballPreviewTaskId: previewId });
			await pollTextTo3d(key, previewId, "piłka preview");
		}
		console.info("Meshy text-to-3d refine: piłka PBR…");
		refineId = await createTextTo3dRefine(key, previewId!);
		saveBallTaskMeta({ ballRefineTaskId: refineId });
		const refined = await pollTextTo3d(key, refineId, "piłka refine");
		const url = refined.model_urls?.glb;
		if (!url) throw new Error("piłka refine: brak GLB");
		await downloadGlb(url, PATHS.raw);
	}

	let remeshId = meta.ballRemeshTaskId;
	if (force || !existsSync(PATHS.sized)) {
		remeshId = await remeshBall(key, refineId!);
		await resizeBall(key, remeshId);
	}

	compressBallGlb();
	syncGameBallFromMeshy();
}

function syncReferenceAlbedo(imagePath: string | null): void {
	if (!imagePath || !existsSync(imagePath)) return;
	if (imagePath.toLowerCase().endsWith(".png")) {
		copyFileSync(imagePath, resolve(TEX, "ball_meshy_reference.png"));
	}
}

function writeManifest(): void {
	syncArenaManifestFromDisk();
}

function syncGameBallFromMeshy(): void {
	if (!existsSync(PATHS.final)) {
		throw new Error(`Brak ${PATHS.final}`);
	}
	copyFileSync(PATHS.final, PATHS.gameBall);
	console.info(`Skopiowano → ${PATHS.gameBall}`);
}

/** Bez API — compress sized → ball_meshy.glb + sync ball.glb + manifest. */
function prepBallLocal(): void {
	if (existsSync(PATHS.sized)) {
		console.info("Lokalny prep: gltf-transform resize + draco…");
		compressBallGlb();
	} else if (existsSync(PATHS.final)) {
		console.info("Pomijam compress — brak ball_meshy_sized.glb, używam ball_meshy.glb");
	} else {
		throw new Error(
			"Brak ball_meshy_sized.glb ani ball_meshy.glb — npm run meshy:build-ball",
		);
	}
	syncGameBallFromMeshy();
}

async function main(): Promise<void> {
	const { textureOnly, force, localOnly, fromImage } = parseArgs();

	if (localOnly) {
		prepBallLocal();
		writeManifest();
		console.info("\n✓ Piłka lokalnie gotowa — npm run dev:force");
		return;
	}

	const key = loadApiKey();
	const refImage = fromImage ?? (existsSync(PATHS.reference) ? PATHS.reference : null);

	if (fromImage) {
		syncReferenceAlbedo(fromImage);
		if (!textureOnly) {
			await generateBallFromImage(key, fromImage, force);
		}
	} else if (refImage && force) {
		await generateBallFromImage(key, refImage, force);
	} else {
		await generateBallAlbedo(key, force);
		if (!textureOnly) {
			await generateBallModel(key, force);
		}
	}

	writeManifest();
	console.info("\n✓ Piłka Meshy gotowa — npm run dev:force");
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
