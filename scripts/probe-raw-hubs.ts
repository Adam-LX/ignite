/**
 * Gdzie siedzą huby w surowym GLB (bez axes) względem body AABB.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { FileLoader } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const publicDir = join(import.meta.dirname, "../public");
(globalThis as unknown as { self: typeof globalThis }).self ??= globalThis;
(globalThis as unknown as { Image: unknown }).Image ??= class {
	width = 1;
	height = 1;
	onload: (() => void) | null = null;
	set src(_v: string) {
		queueMicrotask(() => this.onload?.());
	}
};
const orig = FileLoader.prototype.load;
FileLoader.prototype.load = function (url, onLoad, onProgress, onError) {
	if (typeof url === "string" && url.startsWith("/")) {
		try {
			const buf = readFileSync(join(publicDir, url.replace(/^\//, "")));
			onLoad?.(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
		} catch (e) {
			onError?.(e);
		}
		return this;
	}
	return orig.call(this, url, onLoad, onProgress, onError);
};

function rename(root: THREE.Object3D) {
	const m: Record<string, string> = {
		wheel_fl: "wheel_FL",
		wheel_fr: "wheel_FR",
		wheel_rl: "wheel_RL",
		wheel_rr: "wheel_RR",
	};
	root.traverse((o) => {
		const n = m[o.name.toLowerCase()];
		if (n) o.name = n;
	});
}

const loader = new GLTFLoader();
const W = ["wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR"] as const;

for (const id of ["muscle", "truck", "buggy", "hatch", "bruiser", "blade"]) {
	const buf = readFileSync(join(publicDir, `assets/cars/${id}.glb`));
	const root = (
		await loader.parseAsync(
			buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
			"",
		)
	).scene;
	rename(root);
	root.updateMatrixWorld(true);
	const body = root.getObjectByName("body");
	const bb = new THREE.Box3().setFromObject(body ?? root);
	const size = bb.getSize(new THREE.Vector3());
	const p = new THREE.Vector3();
	const hubs: { name: string; x: number; y: number; z: number }[] = [];
	for (const name of W) {
		const h = root.getObjectByName(name);
		if (!h) continue;
		h.getWorldPosition(p);
		hubs.push({
			name,
			x: +p.x.toFixed(3),
			y: +p.y.toFixed(3),
			z: +p.z.toFixed(3),
		});
	}
	const mid = {
		x: (bb.min.x + bb.max.x) / 2,
		y: (bb.min.y + bb.max.y) / 2,
		z: (bb.min.z + bb.max.z) / 2,
	};
	const avg = hubs.reduce(
		(a, h) => ({ x: a.x + h.x, y: a.y + h.y, z: a.z + h.z }),
		{ x: 0, y: 0, z: 0 },
	);
	if (hubs.length) {
		avg.x /= hubs.length;
		avg.y /= hubs.length;
		avg.z /= hubs.length;
	}
	/** Która oś jest długością (max size)? */
	const dims = [
		["x", size.x],
		["y", size.y],
		["z", size.z],
	] as const;
	dims.sort((a, b) => b[1] - a[1]);
	console.log(
		JSON.stringify({
			id,
			bodyMin: [+bb.min.x.toFixed(2), +bb.min.y.toFixed(2), +bb.min.z.toFixed(2)],
			bodyMax: [+bb.max.x.toFixed(2), +bb.max.y.toFixed(2), +bb.max.z.toFixed(2)],
			size: [+size.x.toFixed(2), +size.y.toFixed(2), +size.z.toFixed(2)],
			longest: dims[0][0],
			hubAvg: {
				x: +avg.x.toFixed(3),
				y: +avg.y.toFixed(3),
				z: +avg.z.toFixed(3),
			},
			hubVsMid: {
				x: +(avg.x - mid.x).toFixed(3),
				y: +(avg.y - mid.y).toFixed(3),
				z: +(avg.z - mid.z).toFixed(3),
			},
			hubs,
		}),
	);
}
