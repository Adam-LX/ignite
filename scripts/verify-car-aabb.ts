/**
 * Po pełnym loadCarThumbnailModel: auto musi być płaskie (Z > Y) —
 * wykrywa „stanie na nosie” które hub-snap ukrywa w starym diag.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { FileLoader } from "three";
import { loadCarThumbnailModel } from "../src/visual/CarModel";

const ROOT = join(import.meta.dirname, "..");
const publicDir = join(ROOT, "public");
const OUT = join(ROOT, "public/assets/cars/.work/diag");

(globalThis as unknown as { self: typeof globalThis }).self ??= globalThis;
(globalThis as unknown as { Image: unknown }).Image ??= class {
	width = 1;
	height = 1;
	onload: (() => void) | null = null;
	onerror: ((e: unknown) => void) | null = null;
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
			onLoad?.(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
		} catch (e) {
			onError?.(e);
		}
		return this;
	}
	return orig.call(this, url, onLoad, onProgress, onError);
};

const ids =
	process.argv.slice(2).length > 0
		? process.argv.slice(2)
		: [
				"muscle",
				"truck",
				"hatch",
				"buggy",
				"blade",
				"phantom",
				"bruiser",
				"sleek",
			];

mkdirSync(OUT, { recursive: true });
let failed = 0;
const rows = [];

for (const id of ids) {
	const thumb = await loadCarThumbnailModel(id);
	thumb.updateMatrixWorld(true);
	const box = new THREE.Box3().setFromObject(thumb);
	const size = box.getSize(new THREE.Vector3());
	const flat = size.z > size.y * 1.2 && size.z > size.x * 0.75;
	const noseUp = size.y > size.z * 1.05;
	const ok = flat && !noseUp;
	if (!ok) failed += 1;
	const row = {
		id,
		ok,
		size: [+size.x.toFixed(3), +size.y.toFixed(3), +size.z.toFixed(3)],
		flat,
		noseUp,
	};
	rows.push(row);
	console.log(
		`${ok ? "PASS" : "FAIL"} ${id} size=${row.size.join(",")} flat=${flat} noseUp=${noseUp}`,
	);
}

writeFileSync(join(OUT, "post-load-aabb.json"), `${JSON.stringify(rows, null, 2)}\n`);
if (failed) {
	console.error(`\npost-load AABB: ${failed}/${rows.length} FAIL`);
	process.exit(1);
}
console.info(`\npost-load AABB: ${rows.length}/${rows.length} PASS`);
