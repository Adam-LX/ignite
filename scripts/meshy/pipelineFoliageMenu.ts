/**
 * Meshy → trawa 3D + kafel menu + piłka cyber (batch)
 *   npm run meshy:build-foliage-menu
 *   npm run meshy:build-foliage-menu -- --force
 */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { MESHY_ROOT } from "./client.js";

function run(script: string, force: boolean): void {
	const args = ["vite-node", script];
	if (force) args.push("--", "--force");
	const r = spawnSync("npx", args, { cwd: MESHY_ROOT, stdio: "inherit" });
	if (r.status !== 0) process.exit(r.status ?? 1);
}

async function main(): Promise<void> {
	const force = process.argv.includes("--force");
	run(resolve(MESHY_ROOT, "scripts/meshy/pipelineGrassTuft.ts"), force);
	run(resolve(MESHY_ROOT, "scripts/meshy/pipelineMenuTile.ts"), force);
	run(resolve(MESHY_ROOT, "scripts/meshy/pipelineBall.ts"), force);
	console.info("\n✓ Foliate + menu + piłka — batch zakończony");
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
