/**
 * Batch Trellis dla brakujących wheel/topper GLB z items.design.json
 *   npm run trellis:batch-items
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import design from "../../data/content/items.design.json" with { type: "json" };

const ROOT = resolve(import.meta.dirname, "../..");

function run(kind: "wheel" | "topper", id: string, prompt: string): void {
	const sub = kind === "wheel" ? "wheels" : "toppers";
	const dest = resolve(ROOT, `public/assets/items/${sub}/${id}.glb`);
	if (existsSync(dest)) {
		console.info(`skip ${kind}/${id} — exists`);
		return;
	}
	console.info(`build ${kind}/${id}…`);
	const r = spawnSync(
		"npm",
		["run", "trellis:build-item", "--", "--kind", kind, "--id", id, "--prompt", prompt],
		{ cwd: ROOT, stdio: "inherit", shell: true },
	);
	if (r.status !== 0) process.exit(r.status ?? 1);
}

for (const w of design.wheels) {
	if (w.defaultUnlocked || !w.trellisPrompt) continue;
	run("wheel", w.id, w.trellisPrompt);
}

for (const t of design.toppers) {
	if (t.defaultUnlocked || !t.trellisPrompt) continue;
	run("topper", t.id, t.trellisPrompt);
}

console.info("batch-items done");
