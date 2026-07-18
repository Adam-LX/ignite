/**
 * Podgląd batcha Trellis (regen aut).
 *   npm run trellis:batch-status
 *   npm run trellis:batch-status -- --watch
 */

import { existsSync, readFileSync, statSync, watchFile } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const STATUS_PATH = resolve(ROOT, "public/assets/cars/.work/trellis-batch-status.json");
const LOG_PATHS = [
	resolve(ROOT, "public/assets/cars/.work/trellis-regen.log"),
	"/tmp/ignite-trellis-regen.log",
];

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

function readStatusFile(): BatchStatus | null {
	if (!existsSync(STATUS_PATH)) return null;
	try {
		return JSON.parse(readFileSync(STATUS_PATH, "utf8")) as BatchStatus;
	} catch {
		return null;
	}
}

function findLogPath(): string | null {
	for (const p of LOG_PATHS) {
		if (existsSync(p)) return p;
	}
	return null;
}

function parseLogTail(logPath: string): {
	lastTrellis: string | null;
	done: string[];
	failed: string[];
	current: string | null;
} {
	const text = readFileSync(logPath, "utf8");
	const lines = text.split("\n");
	let lastTrellis: string | null = null;
	const done: string[] = [];
	const failed: string[] = [];
	let current: string | null = null;

	for (const line of lines) {
		const batch = line.match(/=== Batch car: (\w+) \(attempt/);
		if (batch) current = batch[1]!;
		const doneMatch = line.match(/Done: .*\/(\w+)\.glb/);
		if (doneMatch) {
			done.push(doneMatch[1]!);
			if (current === doneMatch[1]) current = null;
		}
		if (line.includes("Batch failed for ")) {
			const f = line.match(/Batch failed for (\w+)/);
			if (f) failed.push(f[1]!);
		}
		if (line.includes("[Trellis]")) {
			const parts = line.replace(/\r/g, "\n").split("\n");
			for (let i = parts.length - 1; i >= 0; i--) {
				const clean = parts[i]!.trim();
				if (clean.startsWith("[Trellis]")) {
					lastTrellis = clean;
					break;
				}
			}
		}
	}

	return { lastTrellis, done: [...new Set(done)], failed: [...new Set(failed)], current };
}

function render(): void {
	console.clear();
	const now = new Date().toLocaleTimeString("pl-PL");
	const status = readStatusFile();
	const logPath = findLogPath();
	const log = logPath ? parseLogTail(logPath) : null;

	console.log(`\n  Forge3D batch — ${now}`);
	console.log(`  UI Trellis:  http://127.0.0.1:8004/`);
	if (logPath) {
		const age = Math.round((Date.now() - statSync(logPath).mtimeMs) / 1000);
		console.log(`  Log:         ${logPath}  (mtime ${age}s)`);
	} else {
		console.log(`  Log:         brak — uruchom: npm run trellis:regen-cars`);
	}

	const queue = status?.queue ?? [];
	const done = [...new Set([...(status?.done ?? []), ...(log?.done ?? [])])];
	const failed = [...new Set([...(status?.failed ?? []), ...(log?.failed ?? [])])];
	const current = status?.current ?? log?.current ?? null;
	const total = queue.length || 8;
	const phase = status?.phase ?? log?.lastTrellis ?? status?.phase ?? "—";

	console.log(`\n  Postęp: ${done.length}/${total} gotowych` + (failed.length ? `, ${failed.length} błędów` : ""));
	if (current) console.log(`  Teraz:  ${current}`);
	console.log(`  Trellis: ${phase}`);

	if (queue.length > 0) {
		console.log("\n  Kolejka:");
		for (const id of queue) {
			let mark = " ";
			if (done.includes(id)) mark = "✓";
			else if (failed.includes(id)) mark = "✗";
			else if (id === current) mark = "→";
			console.log(`    ${mark} ${id}`);
		}
	} else if (done.length > 0) {
		console.log("\n  Gotowe:", done.join(", "));
	}

	console.log("\n  tail -f " + (logPath ?? "/tmp/ignite-trellis-regen.log"));
	console.log("");
}

const watch = process.argv.includes("--watch");
if (watch) {
	render();
	const logPath = findLogPath();
	if (logPath) {
		watchFile(logPath, { interval: 1500 }, () => render());
	}
	if (existsSync(STATUS_PATH)) {
		watchFile(STATUS_PATH, { interval: 1500 }, () => render());
	}
	setInterval(render, 5000);
} else {
	render();
}
