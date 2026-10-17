/**
 * Batch Trellis z data/content/cars.design.json
 *   npm run trellis:batch -- --cars-only
 *   npm run trellis:batch -- --missing-only   (pomija istniejące GLB)
 *   vite-node scripts/trellis/batchFromDesign.ts --only sleek,hatch
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { trellisHealth, trellisWaitForHealthy } from "./client.js";
import { promptForEmptyWheelWells } from "./carWheelPipeline.js";

const ROOT = resolve(import.meta.dirname, "../..");
const WORK_DIR = resolve(ROOT, "public/assets/cars/.work");
const STATUS_PATH = resolve(WORK_DIR, "trellis-batch-status.json");
const LOG_PATH = resolve(WORK_DIR, "trellis-regen.log");

type CarDesign = {
	id: string;
	trellisPrompt: string;
	defaultUnlocked?: boolean;
};

function glbPath(id: string): string {
	return resolve(ROOT, "public/assets/cars", `${id}.glb`);
}

function hasStrippedBody(id: string): boolean {
	const raw = resolve(ROOT, "public/assets/cars/.work", `${id}_trellis_raw.glb`);
	const final = glbPath(id);
	if (!existsSync(raw) || !existsSync(final)) return false;
	const rawSize = readFileSync(raw).length;
	const finalSize = readFileSync(final).length;
	return finalSize < rawSize * 0.18;
}

function hasValidGlb(id: string): boolean {
	const path = glbPath(id);
	if (!existsSync(path)) return false;
	if (hasStrippedBody(id)) {
		console.warn(`WARN ${id} — GLB uszkodzony (vertex strip?) — wymaga regen`);
		return false;
	}
	const r = spawnSync("node", ["scripts/validateGlb.mjs", path], {
		cwd: ROOT,
		encoding: "utf8",
	});
	return r.status === 0;
}

type BatchStatus = {
	startedAt: string;
	updatedAt: string;
	quality: string;
	queue: string[];
	done: string[];
	failed: string[];
	current: string | null;
	phase: string | null;
};

function writeBatchStatus(patch: Partial<BatchStatus> & { queue?: string[] }): void {
	mkdirSync(WORK_DIR, { recursive: true });
	let prev: BatchStatus | null = null;
	if (existsSync(STATUS_PATH)) {
		try {
			prev = JSON.parse(readFileSync(STATUS_PATH, "utf8")) as BatchStatus;
		} catch {
			prev = null;
		}
	}
	const next: BatchStatus = {
		startedAt: prev?.startedAt ?? new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		quality:
			(process.env.FLYBALL_TRELLIS_QUALITY as string | undefined) ?? "high",
		queue: patch.queue ?? prev?.queue ?? [],
		done: patch.done ?? prev?.done ?? [],
		failed: patch.failed ?? prev?.failed ?? [],
		current: patch.current !== undefined ? patch.current : (prev?.current ?? null),
		phase: patch.phase !== undefined ? patch.phase : (prev?.phase ?? null),
	};
	writeFileSync(STATUS_PATH, `${JSON.stringify(next, null, 2)}\n`);
}

function buildCar(id: string, prompt: string, attempt: number): boolean {
	console.info(`\n=== Batch car: ${id} (attempt ${attempt}) ===`);
	const quality =
		(process.env.FLYBALL_TRELLIS_QUALITY as "standard" | "high" | "ultra" | undefined) ??
		"high";
	const refImage = resolve(ROOT, "public/assets/cars/.work", `${id}_ref.png`);
	const args = ["vite-node", "scripts/trellis/pipelineCar.ts", "--id", id, "--quality", quality];
	if (existsSync(refImage)) {
		console.info(`Image-to-3D: ${refImage}`);
		args.push("--image", refImage);
	} else {
		args.push("--prompt", prompt);
	}
	const r = spawnSync("npx", args, { stdio: "inherit", cwd: ROOT });
	if (r.status !== 0) return false;
	return hasValidGlb(id);
}

function parseOnlyIds(): Set<string> | null {
	const idx = process.argv.indexOf("--only");
	if (idx < 0) return null;
	const raw = process.argv[idx + 1];
	if (!raw || raw.startsWith("--")) {
		throw new Error("Użycie: --only sleek,hatch,truck");
	}
	return new Set(
		raw
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean),
	);
}

async function main(): Promise<void> {
	const missingOnly = process.argv.includes("--missing-only");
	const regenAll = process.argv.includes("--regen-all");
	const onlyIds = parseOnlyIds();
	const designPath = resolve(ROOT, "data/content/cars.design.json");
	const design = JSON.parse(readFileSync(designPath, "utf8")) as {
		cars: CarDesign[];
	};

	const queue = design.cars.filter((c) => {
		if (c.defaultUnlocked) return false;
		if (onlyIds) return onlyIds.has(c.id);
		if (regenAll) return true;
		if (missingOnly && hasValidGlb(c.id)) {
			console.info(`SKIP ${c.id} — GLB OK`);
			return false;
		}
		return true;
	});
	if (onlyIds) {
		const known = new Set(design.cars.map((c) => c.id));
		for (const id of onlyIds) {
			if (!known.has(id)) console.warn(`WARN --only: nieznane id „${id}”`);
		}
	}

	if (queue.length === 0) {
		console.info("Batch: brak aut do wygenerowania.");
		return;
	}

	writeBatchStatus({ queue: queue.map((c) => c.id), done: [], failed: [], current: null });
	console.info(`Batch log: ${LOG_PATH}`);
	console.info(`Batch status: ${STATUS_PATH}`);
	console.info(`Trellis UI: http://127.0.0.1:8004/`);

	let failed = 0;
	const done: string[] = [];
	const failedIds: string[] = [];
	for (const car of queue) {
		writeBatchStatus({ current: car.id, phase: "Trellis generate…" });
		if (!(await trellisHealth())) {
			console.warn("Trellis offline przed batch — czekam…");
			try {
				await trellisWaitForHealthy();
			} catch {
				console.error("Trellis niedostępny — przerywam batch.");
				process.exit(1);
			}
		}
		let ok = false;
		for (let attempt = 1; attempt <= 2; attempt++) {
			ok = buildCar(car.id, promptForEmptyWheelWells(car.trellisPrompt), attempt);
			if (ok) break;
			console.warn(`Retry ${car.id} po błędzie Trellis…`);
		}
		if (!ok) {
			failed++;
			failedIds.push(car.id);
			writeBatchStatus({ failed: [...failedIds], current: null, phase: "failed" });
			console.error(`Batch failed for ${car.id}`);
		} else {
			done.push(car.id);
			writeBatchStatus({ done: [...done], current: null, phase: "done" });
		}
	}

	writeBatchStatus({ current: null, phase: failed > 0 ? "finished with errors" : "finished" });

	if (failed > 0) {
		console.error(`Batch: ${failed} aut nie udało się — uruchom ponownie npm run trellis:batch`);
		process.exit(1);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
