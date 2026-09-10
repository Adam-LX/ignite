import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { FileLoader } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";

import { getCarCatalogSync, loadCarCatalog } from "../../src/meta/CarCatalog";
import {
	ensureMeshyCarNosePlusZ,
	ensureMeshyGltfAxes,
	meshyRearEndScore,
	bakeCarRootTransform,
	flattenCarContentToRoot,
	centerCarOnHorizontalOrigin,
	meshyRearTowardPlusZ,
} from "../../src/visual/trellisCarOrientation";

const ROOT = join(import.meta.dirname, "../..");
const publicDir = join(ROOT, "public");

if (typeof globalThis.self === "undefined") {
	(globalThis as unknown as { self: typeof globalThis }).self = globalThis;
}
if (typeof globalThis.Image === "undefined") {
	(globalThis as unknown as { Image: unknown }).Image = class {
		width = 1;
		height = 1;
		onload: (() => void) | null = null;
		set src(_v: string) {
			queueMicrotask(() => this.onload?.());
		}
	};
}

const orig = FileLoader.prototype.load;
FileLoader.prototype.load = function (
	url: string,
	onLoad?: (r: unknown) => void,
	_onProgress?: (e: ProgressEvent) => void,
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
	return orig.call(this, url, onLoad, _onProgress, onError);
};

const FORCE_YAW_180 = new Set(["octane"]);

function bestRearAxis(root: THREE.Object3D): "x" | "z" {
	const ends = [
		{ axis: "z" as const, score: Math.max(meshyRearEndScore(root, "z", 1), meshyRearEndScore(root, "z", -1)) },
		{ axis: "x" as const, score: Math.max(meshyRearEndScore(root, "x", 1), meshyRearEndScore(root, "x", -1)) },
	];
	return ends[0]!.score >= ends[1]!.score ? ends[0]!.axis : ends[1]!.axis;
}

async function orientLikeCarModel(id: string): Promise<THREE.Object3D> {
	const path =
		id === "octane"
			? join(publicDir, "assets/models/car.glb")
			: join(publicDir, `assets/cars/${id}.glb`);
	const buf = readFileSync(path);
	const loader = new GLTFLoader();
	const root = (
		await loader.parseAsync(
			buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
			"",
		)
	).scene;
	root.traverse((obj) => {
		const map: Record<string, string> = {
			wheel_fl: "wheel_FL",
			wheel_fr: "wheel_FR",
			wheel_rl: "wheel_RL",
			wheel_rr: "wheel_RR",
		};
		const next = map[obj.name.toLowerCase()];
		if (next) obj.name = next;
	});
	ensureMeshyGltfAxes(root, id);
	if (FORCE_YAW_180.has(id)) {
		root.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), Math.PI);
	} else {
		ensureMeshyCarNosePlusZ(root);
	}
	bakeCarRootTransform(root);
	flattenCarContentToRoot(root);
	centerCarOnHorizontalOrigin(root);
	if (!FORCE_YAW_180.has(id) && meshyRearTowardPlusZ(root)) {
		root.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), Math.PI);
		bakeCarRootTransform(root);
	}
	centerCarOnHorizontalOrigin(root);
	return root;
}

describe("garage car orientation contract", () => {
	it("każdy model z katalogu ma tył wzdłuż Z (nie bokiem)", async () => {
		await loadCarCatalog();
		const ids = getCarCatalogSync()
			.cars.filter((c) => !c.garageHidden)
			.map((c) => c.id);
		const loader = new GLTFLoader();

		for (const id of ids) {
			const path =
				id === "octane"
					? join(publicDir, "assets/models/car.glb")
					: join(publicDir, `assets/cars/${id}.glb`);
			try {
				readFileSync(path);
			} catch {
				continue;
			}

			const root = await orientLikeCarModel(id);
			root.updateMatrixWorld(true);
			const body = root.getObjectByName("body");
			const box = new THREE.Box3().setFromObject(body ?? root);
			const size = box.getSize(new THREE.Vector3());
			expect(size.z, `${id}: długość powinna być na Z`).toBeGreaterThan(
				size.x * 0.92,
			);
			expect(bestRearAxis(root), `${id}: tył nie na osi X`).toBe("z");
			void loader;
		}
	});
});
