/**
 * Pełna ścieżka loadCarModel — huby vs body po ground align.
 * nix develop -c npx vite-node scripts/probe-full-load-orient.ts
 */
import * as THREE from "three";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FileLoader } from "three";
import { loadCarModel } from "../src/visual/CarModel";
import { scoreUndercarriageDown } from "../src/visual/trellisCarOrientation";

const ROOT = join(import.meta.dirname, "..");
const publicDir = join(ROOT, "public");

(globalThis as unknown as { self: typeof globalThis }).self ??= globalThis;
(globalThis as unknown as { Image: unknown }).Image ??= class {
	onload: (() => void) | null = null;
	set src(_v: string) {
		queueMicrotask(() => this.onload?.());
	}
};

const orig = FileLoader.prototype.load;
FileLoader.prototype.load = function (
	url: string,
	onLoad?: (r: unknown) => void,
	onProgress?: (e: ProgressEvent) => void,
	onError?: (e: unknown) => void,
) {
	let disk: string | null = null;
	if (url.startsWith("/assets/") || url.startsWith("assets/")) {
		disk = join(publicDir, url.replace(/^\//, ""));
	} else if (url.startsWith("/")) {
		disk = join(publicDir, url.slice(1));
	}
	if (disk) {
		try {
			const buf = readFileSync(disk);
			onLoad?.(
				buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
			);
		} catch (e) {
			onError?.(e);
		}
		return this;
	}
	return orig.call(this, url, onLoad, onProgress, onError);
};

const W = ["wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR"] as const;
const ids =
	process.argv.slice(2).length > 0
		? process.argv.slice(2)
		: [
				"bruiserNeo",
				"bruiser",
				"muscle",
				"sleek",
				"hatch",
				"truck",
				"buggy",
				"blade",
				"phantom",
			];

for (const id of ids) {
	const g = await loadCarModel(id, "blue");
	g.updateMatrixWorld(true);
	const car = g.children[0] ?? g;
	const body = g.getObjectByName("body");
	const box = new THREE.Box3().setFromObject(body ?? g);
	const h = box.max.y - box.min.y;
	let hubSum = 0;
	let n = 0;
	let wheelMinY = Infinity;
	let wheelMaxY = -Infinity;
	for (const name of W) {
		const hub = g.getObjectByName(name);
		if (!hub) continue;
		const p = new THREE.Vector3();
		hub.getWorldPosition(p);
		hubSum += p.y;
		n++;
		const wb = new THREE.Box3().setFromObject(hub);
		wheelMinY = Math.min(wheelMinY, wb.min.y);
		wheelMaxY = Math.max(wheelMaxY, wb.max.y);
	}
	const avg = n ? hubSum / n : null;
	const rel = avg != null && h > 1e-8 ? (avg - box.min.y) / h : null;
	const under = scoreUndercarriageDown(car);
	car.rotation.x += Math.PI;
	car.updateMatrixWorld(true);
	const underFlip = scoreUndercarriageDown(car);
	car.rotation.x -= Math.PI;
	car.updateMatrixWorld(true);

	const verdict =
		rel != null && rel > 0.55
			? "HUBS_HIGH"
			: under < underFlip - 1e-6
				? "BODY_FLIP?"
				: "OK";

	console.log(
		`${verdict.padEnd(10)} ${id.padEnd(12)} hubRel=${rel?.toFixed(3) ?? "n/a"} under=${under.toFixed(3)} flip=${underFlip.toFixed(3)} bodyY=[${box.min.y.toFixed(2)},${box.max.y.toFixed(2)}] wheelsY=[${wheelMinY.toFixed(2)},${wheelMaxY.toFixed(2)}]`,
	);
}
