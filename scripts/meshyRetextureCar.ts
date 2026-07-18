/**
 * Meshy Retexture API → car.glb
 *
 * Wymaga klucza API (NIE cookies z przeglądarki):
 *   echo 'MESHY_API_KEY=msy_...' > data/meshy.env
 *
 * Użycie:
 *   npx vite-node scripts/meshyRetextureCar.ts
 *   npx vite-node scripts/meshyRetextureCar.ts --input T4.glb --out public/assets/models/car_meshy.glb
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const ENV_PATH = resolve(ROOT, "data/meshy.env");
const TASK_PATH = resolve(ROOT, "data/meshy-car-task.json");

const STYLE_PROMPT =
	"Futuristic rocket league cyberpunk car, brushed chrome panels, cyan neon LED trim lines, " +
	"carbon fiber accents, glossy iridescent paint, game-ready PBR, clean studio albedo, no rust";

type RetextureTask = {
	id: string;
	status: "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "CANCELED";
	progress?: number;
	task_error?: { message?: string };
	model_urls?: { glb?: string };
};

function loadApiKey(): string {
	if (process.env.MESHY_API_KEY) return process.env.MESHY_API_KEY;
	try {
		const raw = readFileSync(ENV_PATH, "utf8");
		for (const line of raw.split("\n")) {
			const m = line.match(/^\s*MESHY_API_KEY\s*=\s*(.+)\s*$/);
			if (m) return m[1].replace(/^["']|["']$/g, "");
		}
	} catch {
		/* brak pliku */
	}
	throw new Error(
		"Brak MESHY_API_KEY. Utwórz data/meshy.env z kluczem z https://www.meshy.ai/settings/api",
	);
}

function parseArgs(): { input: string; out: string; skipPrep: boolean } {
	const args = process.argv.slice(2);
	let input = resolve(ROOT, "T4.glb");
	let out = resolve(ROOT, "public/assets/models/car_meshy.glb");
	let skipPrep = false;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--input" && args[i + 1]) input = resolve(ROOT, args[++i]);
		else if (args[i] === "--out" && args[i + 1]) out = resolve(ROOT, args[++i]);
		else if (args[i] === "--skip-prep") skipPrep = true;
	}
	return { input, out, skipPrep };
}

function toDataUri(path: string): string {
	const buf = readFileSync(path);
	return `data:application/octet-stream;base64,${buf.toString("base64")}`;
}

async function meshyFetch(
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
		throw new Error(`Meshy ${path} → ${res.status}: ${text.slice(0, 400)}`);
	}
	return text ? JSON.parse(text) : {};
}

async function createRetextureTask(key: string, modelPath: string): Promise<string> {
	console.info("Meshy: upload modelu (data URI)…");
	const payload = {
		model_url: toDataUri(modelPath),
		text_style_prompt: STYLE_PROMPT,
		ai_model: "latest",
		enable_original_uv: true,
		enable_pbr: true,
		hd_texture: true,
		remove_lighting: true,
		target_formats: ["glb"],
	};
	const res = (await meshyFetch(key, "/openapi/v1/retexture", {
		method: "POST",
		body: JSON.stringify(payload),
	})) as { result?: string };
	if (!res.result) throw new Error("Meshy nie zwróciło task id");
	console.info("Meshy task:", res.result);
	return res.result;
}

async function pollTask(key: string, taskId: string): Promise<RetextureTask> {
	for (let i = 0; i < 120; i++) {
		const task = (await meshyFetch(
			key,
			`/openapi/v1/retexture/${taskId}`,
		)) as RetextureTask;
		const pct = task.progress ?? 0;
		process.stdout.write(`\rMeshy: ${task.status} ${pct}%   `);
		if (task.status === "SUCCEEDED") {
			console.info("\nMeshy: gotowe.");
			return task;
		}
		if (task.status === "FAILED" || task.status === "CANCELED") {
			throw new Error(task.task_error?.message ?? task.status);
		}
		await new Promise((r) => setTimeout(r, 5000));
	}
	throw new Error("Meshy timeout (10 min)");
}

async function downloadGlb(url: string, out: string): Promise<void> {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Pobieranie GLB: ${res.status}`);
	const buf = Buffer.from(await res.arrayBuffer());
	mkdirSync(dirname(out), { recursive: true });
	writeFileSync(out, buf);
	console.info("Zapisano:", out);
}

async function runBlenderPrep(src: string): Promise<void> {
	const { spawnSync } = await import("node:child_process");
	const blender = spawnSync("bash", [resolve(ROOT, "scripts/meshy_prep_car.sh")], {
		env: { ...process.env, MESHY_CAR_SRC: src, FLYBALL_ROOT: ROOT },
		stdio: "inherit",
	});
	if (blender.status !== 0) {
		throw new Error("Blender prep failed");
	}
}

async function main(): Promise<void> {
	const key = loadApiKey();
	const { input, out, skipPrep } = parseArgs();
	if (!existsSync(input)) throw new Error(`Brak pliku: ${input}`);

	const taskId = await createRetextureTask(key, input);
	const task = await pollTask(key, taskId);
	const glbUrl = task.model_urls?.glb;
	if (!glbUrl) throw new Error("Brak model_urls.glb w odpowiedzi Meshy");

	writeFileSync(
		TASK_PATH,
		JSON.stringify({ retextureTaskId: taskId }, null, "\t") + "\n",
	);
	console.info("Zapisano task id →", TASK_PATH);

	await downloadGlb(glbUrl, out);

	if (!skipPrep) {
		console.info("Blender: skala + koła → car.glb");
		await runBlenderPrep(out);
	}

	console.info("Optymalizacja: remesh + compress…");
	const { spawnSync } = await import("node:child_process");
	const opt = spawnSync(
		"npx",
		["vite-node", "scripts/meshyOptimizeCar.ts"],
		{ cwd: ROOT, stdio: "inherit", env: process.env },
	);
	if (opt.status !== 0) {
		throw new Error("meshy:optimize-car failed");
	}
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
