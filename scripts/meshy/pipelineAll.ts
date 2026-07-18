/**
 * Pełny pipeline Meshy: auto + arena + piłka
 *
 *   npm run meshy:build-all
 *   npm run meshy:build-all -- --textures-only   # arena + piłka albedo, bez 3D
 *   npm run meshy:build-all -- --force   # pełny re-run (auto +retexture)
 */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { syncArenaManifestFromDisk } from "./client.js";

const MESHY_ROOT = resolve(import.meta.dirname, "../..");

function run(label: string, script: string, extraArgs: string[] = []): void {
	console.info(`\n═══ ${label} ═══\n`);
	const r = spawnSync(
		"npx",
		["vite-node", script, ...extraArgs],
		{ cwd: MESHY_ROOT, stdio: "inherit" },
	);
	if (r.status !== 0) {
		throw new Error(`${label} failed (exit ${r.status})`);
	}
}

function parseArgs(): {
	texturesOnly: boolean;
	skipCar: boolean;
	force: boolean;
} {
	const args = process.argv.slice(2);
	return {
		texturesOnly: args.includes("--textures-only"),
		skipCar: args.includes("--skip-car"),
		force: args.includes("--force"),
	};
}

function main(): void {
	const { texturesOnly, skipCar, force } = parseArgs();
	const forceArg = force ? ["--force"] : [];

	if (!skipCar && !texturesOnly) {
		const carArgs = force ? ["--retexture"] : [];
		run("Auto", "scripts/meshy/pipelineCar.ts", carArgs);
	}

	const arenaArgs = texturesOnly ? ["--", "--textures-only", ...forceArg] : forceArg;
	run("Arena", "scripts/meshy/pipelineArena.ts", arenaArgs);

	const ballArgs = texturesOnly
		? ["--", "--texture-only", ...forceArg]
		: forceArg;
	run("Piłka", "scripts/meshy/pipelineBall.ts", ballArgs);

	syncArenaManifestFromDisk();
	console.info("\n✓ Wszystkie assety Meshy gotowe");
}

main();
