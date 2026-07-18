/**
 * Meshy → murawa, ściany, bramki (FlyBall arena visuals)
 *
 *   npm run meshy:build-arena
 *   npm run meshy:build-arena -- --textures-only
 *   npm run meshy:build-arena -- --goal-only
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import {
	createTextTo3dPreview,
	createTextTo3dRefine,
	createTextToImage,
	downloadGlb,
	downloadUrl,
	loadApiKey,
	loadArenaTaskMeta,
	meshyFetch,
	MESHY_ROOT,
	pollMeshyTask,
	pollTextTo3d,
	pollTextToImage,
	saveArenaTaskMeta,
	syncArenaManifestFromDisk,
} from "./client.js";

const TEX = resolve(MESHY_ROOT, "public/assets/textures");
const MODELS = resolve(MESHY_ROOT, "public/assets/models");

const GOAL_WIDTH_M = 18;
const GOAL_HEIGHT_M = 6;
const GOAL_TARGET_POLYS = 16_000;

const PROMPTS = {
	grass:
		"Photorealistic seamless soccer stadium turf texture, lush natural green grass, " +
		"top-down orthographic view, fine organic blade detail, subtle wear, " +
		"uniform coverage, no grid lines, no squares, no black gaps, no logo, PBR albedo",
	wall:
		"Seamless tileable futuristic stadium glass wall panel texture, dark navy blue, " +
		"subtle cyan neon grid lines, holographic glass, game texture, flat, no text",
	sky:
		"Cinematic cyberpunk night sky, volumetric neon fog, magenta purple aurora clouds, " +
		"cyan light pillars piercing smog, glowing toxic clouds, synthwave atmosphere, " +
		"stars and distant holographic beams in upper sky, soft photographic haze, " +
		"wide panoramic view, no buildings in foreground, no stadium, no text",
	skyHorizon:
		"Endless cyberpunk megacity at night, aerial view of millions of tower lights, " +
		"cyan blue and blood orange window glow, soft atmospheric smog, distant skyline, " +
		"volumetric fog between skyscrapers, cinematic wide horizon, no stadium no grass " +
		"no cars no people, photographic game environment",
	banner:
		"Seamless tileable LED stadium banner panel texture, dark carbon fiber, " +
		"cyan orange neon racing stripes, holographic display, game texture, no text",
	ceiling:
		"Seamless tileable futuristic stadium ceiling panel texture, dark navy carbon, " +
		"cyan orange holographic LED truss arrays, industrial sci-fi roof panels, " +
		"volumetric light strips, game texture, flat, no text",
	goal:
		"Futuristic stadium goalpost frame, sci-fi cyber sports goal cage structure, " +
		"glossy dark chrome carbon fiber material, neon orange emissive light stripes embedded in metal, " +
		"no nets, no meshes inside, clean hard-surface product design, gltf format",
} as const;

const PATHS = {
	grassRaw: resolve(TEX, "meshy_grass_raw.png"),
	grassColor: resolve(TEX, "meshy_grass_color.jpg"),
	grassNormal: resolve(TEX, "meshy_grass_normal.jpg"),
	grassRough: resolve(TEX, "meshy_grass_roughness.jpg"),
	wall: resolve(TEX, "meshy_arena_wall.png"),
	skyRaw: resolve(TEX, "meshy_skybox_raw.png"),
	skyAtmosphereRaw: resolve(TEX, "meshy_sky_atmosphere_raw.png"),
	skyHorizonRaw: resolve(TEX, "meshy_sky_horizon_raw.png"),
	skyPanorama: resolve(TEX, "meshy_skybox_panorama.jpg"),
	banner: resolve(TEX, "meshy_banner_panel.png"),
	ceiling: resolve(TEX, "meshy_arena_ceiling.png"),
	goalRaw: resolve(MODELS, "goal_frame_meshy.glb"),
	goalSized: resolve(MODELS, "goal_frame_meshy_sized.glb"),
	goalFinal: resolve(MODELS, "stadium_goal_frame.glb"),
};

function parseArgs(): {
	texturesOnly: boolean;
	goalOnly: boolean;
	grassOnly: boolean;
	skyOnly: boolean;
	ceilingOnly: boolean;
	force: boolean;
} {
	const args = process.argv.slice(2);
	return {
		texturesOnly: args.includes("--textures-only"),
		goalOnly: args.includes("--goal-only"),
		grassOnly: args.includes("--grass-only"),
		skyOnly: args.includes("--sky-only"),
		ceilingOnly: args.includes("--ceiling-only"),
		force: args.includes("--force"),
	};
}

function bakeSkyPanorama(): void {
	const r = spawnSync(
		"python3",
		[resolve(MESHY_ROOT, "scripts/bake_meshy_skybox.py")],
		{ cwd: MESHY_ROOT, stdio: "inherit" },
	);
	if (r.status !== 0) throw new Error("bake_meshy_skybox failed");
}

async function generateGrassTexture(key: string, force: boolean): Promise<void> {
	const meta = loadArenaTaskMeta();
	let taskId = meta.grassImageTaskId;
	if (force || !taskId || !existsSync(PATHS.grassColor)) {
		console.info("Meshy text-to-image: murawa…");
		taskId = await createTextToImage(key, PROMPTS.grass, "1:1");
		saveArenaTaskMeta({ grassImageTaskId: taskId });
	}
	const task = await pollTextToImage(key, taskId, "murawa");
	const url = task.image_urls?.[0];
	if (!url) throw new Error("murawa: brak image_urls");
	await downloadUrl(url, PATHS.grassRaw);
	bakeGrassMaps();
}

function bakeGrassMaps(): void {
	const r = spawnSync("python3", [resolve(MESHY_ROOT, "scripts/bake_meshy_grass_maps.py")], {
		cwd: MESHY_ROOT,
		stdio: "inherit",
	});
	if (r.status !== 0) throw new Error("bake_meshy_grass_maps failed");
}

async function generateWallTexture(key: string, force: boolean): Promise<void> {
	const meta = loadArenaTaskMeta();
	let taskId = meta.wallImageTaskId;
	if (force || !taskId || !existsSync(PATHS.wall)) {
		console.info("Meshy text-to-image: ściana stadionu…");
		taskId = await createTextToImage(
			key,
			PROMPTS.wall,
			"1:1",
			"nano-banana-pro",
		);
		saveArenaTaskMeta({ wallImageTaskId: taskId });
	}
	const task = await pollTextToImage(key, taskId, "ściana");
	const url = task.image_urls?.[0];
	if (!url) throw new Error("ściana: brak image_urls");
	await downloadUrl(url, PATHS.wall);
}

async function generateSkyTexture(key: string, force: boolean): Promise<void> {
	const meta = loadArenaTaskMeta();

	let atmosId = meta.skyAtmosphereTaskId;
	if (force || !atmosId || !existsSync(PATHS.skyAtmosphereRaw)) {
		console.info("Meshy text-to-image: niebo / atmosfera (pro)…");
		atmosId = await createTextToImage(
			key,
			PROMPTS.sky,
			"16:9",
			"nano-banana-pro",
		);
		saveArenaTaskMeta({ skyAtmosphereTaskId: atmosId });
	}
	const atmosTask = await pollTextToImage(key, atmosId, "sky-atmos");
	const atmosUrl = atmosTask.image_urls?.[0];
	if (!atmosUrl) throw new Error("sky-atmos: brak image_urls");
	if (force || !existsSync(PATHS.skyAtmosphereRaw)) {
		await downloadUrl(atmosUrl, PATHS.skyAtmosphereRaw);
	}

	let horizonId = meta.skyHorizonTaskId;
	if (force || !horizonId || !existsSync(PATHS.skyHorizonRaw)) {
		console.info("Meshy text-to-image: horyzont miasta (pro)…");
		horizonId = await createTextToImage(
			key,
			PROMPTS.skyHorizon,
			"16:9",
			"nano-banana-pro",
		);
		saveArenaTaskMeta({ skyHorizonTaskId: horizonId });
	}
	const horizonTask = await pollTextToImage(key, horizonId, "sky-horizon");
	const horizonUrl = horizonTask.image_urls?.[0];
	if (!horizonUrl) throw new Error("sky-horizon: brak image_urls");
	if (force || !existsSync(PATHS.skyHorizonRaw)) {
		await downloadUrl(horizonUrl, PATHS.skyHorizonRaw);
	}

	// Legacy single-layer — kopia horyzontu dla kompatybilności bake fallback.
	if (force || !existsSync(PATHS.skyRaw)) {
		const { copyFileSync } = await import("node:fs");
		copyFileSync(PATHS.skyHorizonRaw, PATHS.skyRaw);
	}

	if (force || !existsSync(PATHS.skyPanorama)) {
		bakeSkyPanorama();
	}
}

async function generateBannerTexture(key: string, force: boolean): Promise<void> {
	const meta = loadArenaTaskMeta();
	let taskId = meta.bannerImageTaskId;
	if (force || !taskId || !existsSync(PATHS.banner)) {
		console.info("Meshy text-to-image: bandy LED…");
		taskId = await createTextToImage(
			key,
			PROMPTS.banner,
			"16:9",
			"nano-banana-pro",
		);
		saveArenaTaskMeta({ bannerImageTaskId: taskId });
	}
	const task = await pollTextToImage(key, taskId, "bandy");
	const url = task.image_urls?.[0];
	if (!url) throw new Error("bandy: brak image_urls");
	await downloadUrl(url, PATHS.banner);
}

async function generateCeilingTexture(key: string, force: boolean): Promise<void> {
	const meta = loadArenaTaskMeta();
	let taskId = meta.ceilingImageTaskId;
	if (force || !taskId || !existsSync(PATHS.ceiling)) {
		console.info("Meshy text-to-image: sufit areny…");
		taskId = await createTextToImage(
			key,
			PROMPTS.ceiling,
			"16:9",
			"nano-banana-pro",
		);
		saveArenaTaskMeta({ ceilingImageTaskId: taskId });
	}
	const task = await pollTextToImage(key, taskId, "sufit");
	const url = task.image_urls?.[0];
	if (!url) throw new Error("sufit: brak image_urls");
	await downloadUrl(url, PATHS.ceiling);
}

async function remeshGoal(key: string, inputTaskId: string): Promise<string> {
	const res = (await meshyFetch(key, "/openapi/v1/remesh", {
		method: "POST",
		body: JSON.stringify({
			input_task_id: inputTaskId,
			target_formats: ["glb"],
			topology: "triangle",
			target_polycount: GOAL_TARGET_POLYS,
		}),
	})) as { result?: string };
	if (!res.result) throw new Error("goal remesh: brak task id");
	saveArenaTaskMeta({ goalRemeshTaskId: res.result });
	const task = await pollMeshyTask(key, "remesh", res.result, "bramka remesh");
	const url = task.model_urls?.glb;
	if (!url) throw new Error("goal remesh: brak GLB");
	await downloadGlb(url, PATHS.goalSized);
	return res.result;
}

async function resizeGoal(key: string, inputTaskId: string): Promise<void> {
	const res = (await meshyFetch(key, "/openapi/v1/resize", {
		method: "POST",
		body: JSON.stringify({
			input_task_id: inputTaskId,
			resize_longest_side: GOAL_WIDTH_M,
			origin_at: "bottom",
		}),
	})) as { result?: string };
	if (!res.result) throw new Error("goal resize: brak task id");
	saveArenaTaskMeta({ goalResizeTaskId: res.result });
	const task = await pollMeshyTask(key, "resize", res.result, "bramka resize");
	const url = task.model_urls?.glb;
	if (!url) throw new Error("goal resize: brak GLB");
	await downloadGlb(url, PATHS.goalSized);
}

function publishGoalFrameGlb(): void {
	copyFileSync(PATHS.goalSized, PATHS.goalFinal);
	console.info(`Bramka → ${PATHS.goalFinal} (bez łączenia meshów)`);
}

function compressGoalGlb(): void {
	const work = resolve(MODELS, ".work/stadium_goal_frame_prep.glb");
	const r1 = spawnSync(
		"npx",
		[
			"--yes",
			"@gltf-transform/cli",
			"resize",
			PATHS.goalFinal,
			work,
			"--width",
			"1024",
			"--height",
			"1024",
		],
		{ cwd: MESHY_ROOT, stdio: "inherit" },
	);
	if (r1.status !== 0) throw new Error("gltf-transform resize goal failed");
	const r2 = spawnSync(
		"npx",
		["--yes", "@gltf-transform/cli", "draco", work, PATHS.goalFinal, "--method", "edgebreaker"],
		{ cwd: MESHY_ROOT, stdio: "inherit" },
	);
	if (r2.status !== 0) throw new Error("gltf-transform draco goal failed");
}

async function generateGoalModel(key: string, force: boolean): Promise<void> {
	if (!force && existsSync(PATHS.goalFinal)) {
		console.info("Pomijam bramkę — stadium_goal_frame.glb istnieje");
		return;
	}

	const meta = loadArenaTaskMeta();
	let previewId = meta.goalPreviewTaskId;
	let refineId = meta.goalRefineTaskId;

	if (force || !refineId || !existsSync(PATHS.goalRaw)) {
		if (force || !previewId) {
			console.info("Meshy text-to-3d preview: bramka…");
			previewId = await createTextTo3dPreview(key, PROMPTS.goal);
			saveArenaTaskMeta({ goalPreviewTaskId: previewId });
			await pollTextTo3d(key, previewId, "bramka preview");
		}
		console.info("Meshy text-to-3d refine: bramka PBR…");
		refineId = await createTextTo3dRefine(key, previewId!);
		saveArenaTaskMeta({ goalRefineTaskId: refineId });
		const refined = await pollTextTo3d(key, refineId, "bramka refine");
		const url = refined.model_urls?.glb;
		if (!url) throw new Error("bramka refine: brak GLB");
		await downloadGlb(url, PATHS.goalRaw);
	}

	let remeshId = meta.goalRemeshTaskId;
	if (force || !existsSync(PATHS.goalSized)) {
		remeshId = await remeshGoal(key, refineId!);
		await resizeGoal(key, remeshId);
	}

	publishGoalFrameGlb();
	compressGoalGlb();
}

function writeManifest(): void {
	syncArenaManifestFromDisk();
}

async function main(): Promise<void> {
	const key = loadApiKey();
	const { texturesOnly, goalOnly, grassOnly, skyOnly, ceilingOnly, force } =
		parseArgs();

	if (grassOnly) {
		await generateGrassTexture(key, force);
		writeManifest();
		console.info("\n✓ Murawa Meshy gotowa — npm run dev:force");
		return;
	}

	if (skyOnly) {
		await generateSkyTexture(key, force);
		writeManifest();
		console.info("\n✓ Skybox Meshy gotowy — npm run dev:force");
		return;
	}

	if (ceilingOnly) {
		await generateCeilingTexture(key, force);
		writeManifest();
		console.info("\n✓ Sufit Meshy gotowy — npm run dev:force");
		return;
	}

	if (!goalOnly) {
		await generateGrassTexture(key, force);
		await generateWallTexture(key, force);
		await generateBannerTexture(key, force);
		await generateCeilingTexture(key, force);
	}
	if (!texturesOnly) {
		await generateGoalModel(key, force);
	}

	writeManifest();
	console.info("\n✓ Arena Meshy gotowa — npm run dev:force");
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
