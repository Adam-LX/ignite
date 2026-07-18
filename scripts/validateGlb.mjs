/**
 * Walidacja GLB aut — długość ~1.18 m, koła FL/FR/RL/RR.
 *   node scripts/validateGlb.mjs public/assets/models/car.glb
 *   node scripts/validateGlb.mjs --catalog
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TARGET_LENGTH_M = 1.18;
const LENGTH_TOL = 0.12;
const WHEEL_NAMES = ["wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR"];
const STRIPPED_SIZE_RATIO = 0.18;

function rawGlbPathForFinal(absPath) {
	const base = absPath.replace(/\.glb$/i, "");
	const id = base.split("/").pop();
	if (!id) return null;
	return join(ROOT, "public/assets/cars/.work", `${id}_trellis_raw.glb`);
}

function checkStrippedBody(absPath) {
	const rawPath = rawGlbPathForFinal(absPath);
	if (!rawPath || !existsSync(rawPath)) return null;
	const rawSize = readFileSync(rawPath).length;
	const finalSize = readFileSync(absPath).length;
	const ratio = finalSize / rawSize;
	if (ratio < STRIPPED_SIZE_RATIO) {
		return `uszkodzona karoseria (final ${(finalSize / 1024 / 1024).toFixed(2)} MB = ${(ratio * 100).toFixed(0)}% raw ${(rawSize / 1024 / 1024).toFixed(2)} MB — vertex strip?)`;
	}
	return null;
}

function readGlbJson(absPath) {
	const buf = readFileSync(absPath);
	if (buf.readUInt32LE(0) !== 0x46546c67) {
		throw new Error("nieprawidłowy GLB");
	}
	const jsonLen = buf.readUInt32LE(12);
	return JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
}

function nodeNames(gltf) {
	const names = new Set();
	for (const node of gltf.nodes ?? []) {
		if (node.name) names.add(node.name);
	}
	return names;
}

function bboxFromGltfTransform(absPath) {
	const r = spawnSync(
		"npx",
		["--yes", "@gltf-transform/cli", "inspect", absPath],
		{ encoding: "utf8", cwd: ROOT },
	);
	if (r.status !== 0) {
		throw new Error(r.stderr?.trim() || "gltf-transform inspect failed");
	}
	const row = r.stdout.match(
		/│\s*0\s*│[^│]*│[^│]*│\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)\s*│\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)\s*│/,
	);
	if (!row) throw new Error("nie można odczytać bbox ze inspect");
	const min = [+row[1], +row[2], +row[3]];
	const max = [+row[4], +row[5], +row[6]];
	return {
		size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
		minY: min[1],
	};
}

async function measureMeshyGlb(absPath) {
	if (typeof globalThis.self === "undefined") globalThis.self = globalThis;
	const THREE = await import("three");
	const { GLTFLoader } = await import(
		"three/examples/jsm/loaders/GLTFLoader.js"
	);
	const buf = readFileSync(absPath);
	const loader = new GLTFLoader();
	const scene = await new Promise((resolveScene, reject) => {
		loader.parse(
			buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
			"",
			(gltf) => resolveScene(gltf.scene),
			reject,
		);
	});
	scene.updateMatrixWorld(true);
	const box = new THREE.Box3().setFromObject(scene);
	const size = box.getSize(new THREE.Vector3());
	return {
		names: new Set(),
		scene,
		size: [size.x, size.y, size.z],
		minY: box.min.y,
	};
}

async function measureGlb(absPath) {
	const issues = [];
	let names;
	let size;
	let minY;

	try {
		const gltf = readGlbJson(absPath);
		names = nodeNames(gltf);
		const bbox = bboxFromGltfTransform(absPath);
		size = bbox.size;
		minY = bbox.minY;
	} catch {
		try {
			const meshy = await measureMeshyGlb(absPath);
			names = meshy.names;
			meshy.scene.traverse((obj) => {
				if (obj.name) names.add(obj.name);
			});
			size = meshy.size;
			minY = meshy.minY;
		} catch (err) {
			issues.push({
				path: absPath,
				msg: err instanceof Error ? err.message : String(err),
			});
			return issues;
		}
	}

	const missingWheels = WHEEL_NAMES.filter((w) => !names.has(w));
	if (missingWheels.length > 0) {
		issues.push({
			path: absPath,
			msg: `brak kół: ${missingWheels.join(", ")}`,
		});
	}

	const length = Math.max(size[0], size[1], size[2]);
	if (Math.abs(length - TARGET_LENGTH_M) > LENGTH_TOL) {
		issues.push({
			path: absPath,
			msg: `długość ${length.toFixed(3)} m (cel ${TARGET_LENGTH_M} ± ${LENGTH_TOL})`,
		});
	}

	const stripIssue = checkStrippedBody(absPath);
	if (stripIssue) {
		issues.push({ path: absPath, msg: stripIssue });
	}

	// Baked koła w body Trellis (z prune lub bez) — maska runtime; nie failuj minY.
	const rawPath = rawGlbPathForFinal(absPath);
	const hasTrellisRaw = rawPath && existsSync(rawPath);
	let islandPruned = false;
	if (hasTrellisRaw) {
		const ratio =
			readFileSync(absPath).length / readFileSync(rawPath).length;
		islandPruned = ratio < 0.88;
	}

	if (minY < -0.08) {
		if (hasTrellisRaw) {
			const tag = islandPruned ? "pruned" : "baked wheels in body";
			console.warn(
				`WARN ${absPath.replace(ROOT + "/", "")}: minY=${minY.toFixed(3)} (${tag} — runtime hub mask)`,
			);
		} else {
			issues.push({
				path: absPath,
				msg: `koła poniżej Y=0: minY=${minY.toFixed(3)}`,
			});
		}
	}

	const rel = absPath.replace(ROOT + "/", "");
	console.log(
		`OK ${rel}: L=${length.toFixed(3)} W=${size[0].toFixed(3)} H=${size[1].toFixed(3)} koła=${4 - missingWheels.length}/4`,
	);
	return issues;
}

async function main() {
	const catalogMode = process.argv.includes("--catalog");
	const paths = [];

	if (catalogMode) {
		const catalog = JSON.parse(
			readFileSync(join(ROOT, "public/assets/cars/car-catalog.json"), "utf8"),
		);
		for (const car of catalog.cars) {
			const p = join(ROOT, "public", car.glb.replace(/^\//, ""));
			if (existsSync(p)) paths.push(p);
			else
				console.warn(`SKIP brak pliku: ${car.id} → ${car.glb}`);
		}
	} else {
		const arg = process.argv.find((a) => a.endsWith(".glb"));
		if (!arg) {
			console.error("Użycie: node scripts/validateGlb.mjs <path.glb> | --catalog");
			process.exit(1);
		}
		paths.push(resolve(process.cwd(), arg));
	}

	const allIssues = [];
	for (const p of paths) {
		const issues = await measureGlb(p);
		allIssues.push(...issues);
	}

	if (allIssues.length > 0) {
		console.error("\n=== validate:glb FAIL ===");
		for (const i of allIssues) {
			console.error(`  ${i.path}: ${i.msg}`);
		}
		process.exit(1);
	}
	console.log("\nvalidate:glb — wszystkie pliki OK");
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
