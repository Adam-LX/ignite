import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const MESHY_ROOT = resolve(import.meta.dirname, "../..");
export const MESHY_ENV = resolve(MESHY_ROOT, "data/meshy.env");
export const MESHY_TASK_FILE = resolve(MESHY_ROOT, "data/meshy-car-task.json");
export const MESHY_ARENA_TASK_FILE = resolve(
	MESHY_ROOT,
	"data/meshy-arena-task.json",
);
export const MESHY_BALL_TASK_FILE = resolve(
	MESHY_ROOT,
	"data/meshy-ball-task.json",
);
export const MESHY_MANIFEST = resolve(
	MESHY_ROOT,
	"public/assets/meshy/arena-manifest.json",
);

export type MeshyTaskKind = "retexture" | "remesh" | "resize";

export type MeshyBallTaskMeta = {
	ballAlbedoTaskId?: string;
	ballPreviewTaskId?: string;
	ballRefineTaskId?: string;
	ballImageTo3dTaskId?: string;
	ballRemeshTaskId?: string;
	ballResizeTaskId?: string;
	updatedAt?: string;
};

export type MeshyArenaTaskMeta = {
	grassImageTaskId?: string;
	wallImageTaskId?: string;
	skyImageTaskId?: string;
	skyAtmosphereTaskId?: string;
	skyHorizonTaskId?: string;
	bannerImageTaskId?: string;
	goalPreviewTaskId?: string;
	goalRefineTaskId?: string;
	goalRemeshTaskId?: string;
	goalResizeTaskId?: string;
	goalCompletePreviewTaskId?: string;
	goalCompleteRefineTaskId?: string;
	goalCompleteRemeshTaskId?: string;
	goalCompleteResizeTaskId?: string;
	ceilingImageTaskId?: string;
	updatedAt?: string;
};

export type MeshyImageTask = {
	id: string;
	status: "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "CANCELED";
	progress?: number;
	task_error?: { message?: string };
	image_urls?: string[];
};

export type MeshyTaskMeta = {
	retextureTaskId?: string;
	remeshTaskId?: string;
	resizeTaskId?: string;
	updatedAt?: string;
};

export type MeshyTask = {
	id: string;
	status: "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "CANCELED";
	progress?: number;
	task_error?: { message?: string };
	model_urls?: { glb?: string };
};

export function loadApiKey(): string {
	if (process.env.MESHY_API_KEY) return process.env.MESHY_API_KEY;
	if (!existsSync(MESHY_ENV)) {
		throw new Error(
			"Brak data/meshy.env — skopiuj data/meshy.env.example i wklej klucz z meshy.ai/settings/api",
		);
	}
	const raw = readFileSync(MESHY_ENV, "utf8");
	for (const line of raw.split("\n")) {
		const m = line.match(/^\s*MESHY_API_KEY\s*=\s*(.+)\s*$/);
		if (m) return m[1].replace(/^["']|["']$/g, "");
	}
	throw new Error("MESHY_API_KEY nie znaleziony w data/meshy.env");
}

export function loadTaskMeta(): MeshyTaskMeta {
	if (!existsSync(MESHY_TASK_FILE)) return {};
	return JSON.parse(readFileSync(MESHY_TASK_FILE, "utf8")) as MeshyTaskMeta;
}

export function saveTaskMeta(patch: Partial<MeshyTaskMeta>): MeshyTaskMeta {
	const next = {
		...loadTaskMeta(),
		...patch,
		updatedAt: new Date().toISOString(),
	};
	writeFileSync(MESHY_TASK_FILE, `${JSON.stringify(next, null, "\t")}\n`);
	return next;
}

export function loadArenaTaskMeta(): MeshyArenaTaskMeta {
	if (!existsSync(MESHY_ARENA_TASK_FILE)) return {};
	return JSON.parse(
		readFileSync(MESHY_ARENA_TASK_FILE, "utf8"),
	) as MeshyArenaTaskMeta;
}

export function saveArenaTaskMeta(
	patch: Partial<MeshyArenaTaskMeta>,
): MeshyArenaTaskMeta {
	const next = {
		...loadArenaTaskMeta(),
		...patch,
		updatedAt: new Date().toISOString(),
	};
	writeFileSync(MESHY_ARENA_TASK_FILE, `${JSON.stringify(next, null, "\t")}\n`);
	return next;
}

export function loadBallTaskMeta(): MeshyBallTaskMeta {
	if (!existsSync(MESHY_BALL_TASK_FILE)) return {};
	return JSON.parse(
		readFileSync(MESHY_BALL_TASK_FILE, "utf8"),
	) as MeshyBallTaskMeta;
}

export function saveBallTaskMeta(
	patch: Partial<MeshyBallTaskMeta>,
): MeshyBallTaskMeta {
	const next = {
		...loadBallTaskMeta(),
		...patch,
		updatedAt: new Date().toISOString(),
	};
	writeFileSync(MESHY_BALL_TASK_FILE, `${JSON.stringify(next, null, "\t")}\n`);
	return next;
}

export async function meshyFetch(
	key: string,
	path: string,
	init?: RequestInit,
): Promise<unknown> {
	const res = await fetch(`https://api.meshy.ai${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${key}`,
			"Content-Type": "application/json",
			...(init?.headers ?? {}),
		},
	});
	const text = await res.text();
	if (!res.ok) {
		throw new Error(`Meshy ${path} → ${res.status}: ${text.slice(0, 500)}`);
	}
	return text ? JSON.parse(text) : {};
}

export function modelToDataUri(path: string): string {
	const buf = readFileSync(path);
	return `data:application/octet-stream;base64,${buf.toString("base64")}`;
}

/** PNG/JPEG → data URI dla Meshy image-to-3d. */
export function imageToDataUri(path: string): string {
	const buf = readFileSync(path);
	const lower = path.toLowerCase();
	const mime = lower.endsWith(".png")
		? "image/png"
		: lower.endsWith(".webp")
			? "image/webp"
			: "image/jpeg";
	return `data:${mime};base64,${buf.toString("base64")}`;
}

export async function pollMeshyTask(
	key: string,
	kind: MeshyTaskKind,
	taskId: string,
	label = kind,
): Promise<MeshyTask> {
	for (let i = 0; i < 150; i++) {
		const task = (await meshyFetch(
			key,
			`/openapi/v1/${kind}/${taskId}`,
		)) as MeshyTask;
		process.stdout.write(
			`\rMeshy ${label}: ${task.status} ${task.progress ?? 0}%   `,
		);
		if (task.status === "SUCCEEDED") {
			console.info(`\nMeshy ${label}: gotowe (${taskId})`);
			return task;
		}
		if (task.status === "FAILED" || task.status === "CANCELED") {
			throw new Error(task.task_error?.message ?? `${label} ${task.status}`);
		}
		await new Promise((r) => setTimeout(r, 5000));
	}
	throw new Error(`Meshy ${label} timeout`);
}

export async function downloadGlb(url: string, out: string): Promise<void> {
	await downloadUrl(url, out);
}

export async function downloadUrl(url: string, out: string): Promise<void> {
	const { mkdirSync, writeFileSync } = await import("node:fs");
	const { dirname } = await import("node:path");
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Pobieranie: ${res.status}`);
	mkdirSync(dirname(out), { recursive: true });
	writeFileSync(out, Buffer.from(await res.arrayBuffer()));
	console.info("Pobrano:", out);
}

export async function pollMeshyApiTask<T extends { status: string; progress?: number; task_error?: { message?: string } }>(
	key: string,
	path: string,
	taskId: string,
	label: string,
): Promise<T> {
	for (let i = 0; i < 180; i++) {
		const task = (await meshyFetch(key, `${path}/${taskId}`)) as T;
		process.stdout.write(
			`\rMeshy ${label}: ${task.status} ${task.progress ?? 0}%   `,
		);
		if (task.status === "SUCCEEDED") {
			console.info(`\nMeshy ${label}: gotowe (${taskId})`);
			return task;
		}
		if (task.status === "FAILED" || task.status === "CANCELED") {
			throw new Error(task.task_error?.message ?? `${label} ${task.status}`);
		}
		await new Promise((r) => setTimeout(r, 5000));
	}
	throw new Error(`Meshy ${label} timeout`);
}

export async function createTextToImage(
	key: string,
	prompt: string,
	aspectRatio = "1:1",
	aiModel: "nano-banana-2" | "nano-banana-pro" = "nano-banana-2",
): Promise<string> {
	const res = (await meshyFetch(key, "/openapi/v1/text-to-image", {
		method: "POST",
		body: JSON.stringify({
			ai_model: aiModel,
			prompt,
			aspect_ratio: aspectRatio,
		}),
	})) as { result?: string };
	if (!res.result) throw new Error("text-to-image: brak task id");
	return res.result;
}

export async function pollTextToImage(
	key: string,
	taskId: string,
	label: string,
): Promise<MeshyImageTask> {
	return pollMeshyApiTask<MeshyImageTask>(
		key,
		"/openapi/v1/text-to-image",
		taskId,
		label,
	);
}

export async function createTextTo3dPreview(
	key: string,
	prompt: string,
): Promise<string> {
	const res = (await meshyFetch(key, "/openapi/v2/text-to-3d", {
		method: "POST",
		body: JSON.stringify({
			mode: "preview",
			prompt,
			ai_model: "latest",
			should_remesh: true,
		}),
	})) as { result?: string };
	if (!res.result) throw new Error("text-to-3d preview: brak task id");
	return res.result;
}

export async function createTextTo3dRefine(
	key: string,
	previewTaskId: string,
): Promise<string> {
	const res = (await meshyFetch(key, "/openapi/v2/text-to-3d", {
		method: "POST",
		body: JSON.stringify({
			mode: "refine",
			preview_task_id: previewTaskId,
			enable_pbr: true,
		}),
	})) as { result?: string };
	if (!res.result) throw new Error("text-to-3d refine: brak task id");
	return res.result;
}

export async function pollTextTo3d(
	key: string,
	taskId: string,
	label: string,
): Promise<MeshyTask> {
	return pollMeshyApiTask<MeshyTask>(
		key,
		"/openapi/v2/text-to-3d",
		taskId,
		label,
	);
}

export async function createImageTo3d(
	key: string,
	imageUrl: string,
): Promise<string> {
	const res = (await meshyFetch(key, "/openapi/v1/image-to-3d", {
		method: "POST",
		body: JSON.stringify({
			image_url: imageUrl,
			ai_model: "latest",
			should_texture: true,
			enable_pbr: true,
			hd_texture: true,
			target_formats: ["glb"],
		}),
	})) as { result?: string };
	if (!res.result) throw new Error("image-to-3d: brak task id");
	return res.result;
}

export async function pollImageTo3d(
	key: string,
	taskId: string,
	label: string,
): Promise<MeshyTask> {
	return pollMeshyApiTask<MeshyTask>(
		key,
		"/openapi/v1/image-to-3d",
		taskId,
		label,
	);
}

export function writeArenaManifest(manifest: Record<string, string>): void {
	mkdirSync(dirname(MESHY_MANIFEST), { recursive: true });
	let existing: Record<string, string> = {};
	if (existsSync(MESHY_MANIFEST)) {
		existing = JSON.parse(
			readFileSync(MESHY_MANIFEST, "utf8"),
		) as Record<string, string>;
	}
	writeFileSync(
		MESHY_MANIFEST,
		`${JSON.stringify({ ...existing, ...manifest, updatedAt: new Date().toISOString() }, null, "\t")}\n`,
	);
	console.info("Manifest:", MESHY_MANIFEST);
}

/** Skanuje dysk i wpisuje wszystkie gotowe assety Meshy do manifestu (bez skyboxa). */
export function syncArenaManifestFromDisk(): void {
	const texDir = resolve(MESHY_ROOT, "public/assets/textures");
	const modDir = resolve(MESHY_ROOT, "public/assets/models");
	const tex = (name: string) => resolve(texDir, name);
	const mod = (name: string) => resolve(modDir, name);
	const patch: Record<string, string> = {};

	if (existsSync(tex("meshy_grass_color.jpg"))) {
		patch.grassColor = "/assets/textures/meshy_grass_color.jpg";
		patch.grassNormal = "/assets/textures/meshy_grass_normal.jpg";
		patch.grassRoughness = "/assets/textures/meshy_grass_roughness.jpg";
	}
	if (existsSync(tex("meshy_arena_wall.png"))) {
		patch.wallPanel = "/assets/textures/meshy_arena_wall.png";
	}
	if (existsSync(tex("meshy_arena_ceiling.png"))) {
		patch.ceilingPanel = "/assets/textures/meshy_arena_ceiling.png";
	}
	if (existsSync(tex("meshy_banner_panel.png"))) {
		patch.bannerPanel = "/assets/textures/meshy_banner_panel.png";
	}
	if (existsSync(tex("meshy_ball_albedo.jpg"))) {
		patch.ballAlbedo = "/assets/textures/meshy_ball_albedo.jpg";
	}
	if (existsSync(mod("stadium_goal_complete.glb"))) {
		patch.goalFrame = "/assets/models/stadium_goal_complete.glb";
	} else if (existsSync(mod("stadium_goal_frame.glb"))) {
		patch.goalFrame = "/assets/models/stadium_goal_frame.glb";
	} else if (existsSync(mod("goal_frame.glb"))) {
		patch.goalFrame = "/assets/models/goal_frame.glb";
	}
	if (existsSync(mod("ball_meshy.glb"))) {
		patch.ballModel = "/assets/models/ball_meshy.glb";
	}
	if (existsSync(mod("car.glb"))) {
		patch.carModel = "/assets/models/car.glb";
	}
	if (existsSync(mod("car_orange.glb"))) {
		patch.carOrangeModel = "/assets/models/car_orange.glb";
	}
	for (const id of ["magnet", "plunger", "haymaker", "spikes"] as const) {
		const file = `powerup_${id}.glb`;
		if (existsSync(mod(file))) {
			patch[`powerUp_${id}`] = `/assets/models/${file}`;
		}
	}

	writeArenaManifest(patch);
}
