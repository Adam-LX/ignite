/**
 * Batch symulacja: loadCarModel + mountWheelGlb dla wszystkich aut Trellis (Node).
 * Uruchom: nix develop -c npm run cars:simulate-mount
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";

import { resolveWheelIdForCar } from "../src/meta/CarCatalog";
import { mountWheelGlb } from "../src/visual/cosmeticGlb";
import { cloneCarMesh, loadCarModel } from "../src/visual/carVisuals";
import {
	surfaceContactY,
	visibleWorldBounds,
} from "../src/visual/carWheelGround";

const ROOT = join(import.meta.dirname, "..");

if (typeof globalThis.self === "undefined") {
	globalThis.self = globalThis as typeof globalThis & Window;
}
if (typeof globalThis.Image === "undefined") {
	globalThis.Image = class {
		width = 1;
		height = 1;
		onload: (() => void) | null = null;
		onerror: ((err: unknown) => void) | null = null;
		set src(_value: string) {
			this.width = 1;
			this.height = 1;
			queueMicrotask(() => this.onload?.());
		}
	} as unknown as typeof Image;
}

/** Node: ładuj GLB z dysku zamiast fetch(/assets/…). */
const publicDir = join(ROOT, "public");
const origLoad = THREE.FileLoader.prototype.load;
THREE.FileLoader.prototype.load = function (
	url: string,
	onLoad: (data: unknown) => void,
	onProgress?: (event: ProgressEvent) => void,
	onError?: (event: unknown) => void,
) {
	let diskPath: string | null = null;
	if (url.startsWith("/assets/") || url.startsWith("assets/")) {
		diskPath = join(publicDir, url.replace(/^\//, ""));
	} else if (url.startsWith("/")) {
		diskPath = join(publicDir, url.slice(1));
	} else if (url.startsWith("file://")) {
		diskPath = url.replace(/^file:\/\//, "");
	}
	if (diskPath) {
		try {
			const buf = readFileSync(diskPath);
			onLoad(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
		} catch (err) {
			onError?.(err);
		}
		return this;
	}
	return origLoad.call(this, url, onLoad, onProgress, onError);
};

type Catalog = {
	cars: { id: string; wheelWellMode?: string; defaultWheelId?: string }[];
};

function rimContactY(display: THREE.Group, hubName: string): number | null {
	const hub = display.getObjectByName(hubName);
	const rim = hub?.getObjectByName(`cosmetic_rim_${hubName}`);
	if (!rim) return null;
	rim.updateMatrixWorld(true);
	const box = visibleWorldBounds(rim);
	return box?.min.y ?? null;
}

function bodyMaxY(display: THREE.Group): number {
	const body = display.getObjectByName("body");
	if (!body) return 0;
	body.updateMatrixWorld(true);
	return new THREE.Box3().setFromObject(body).max.y;
}

const catalog = JSON.parse(
	readFileSync(join(ROOT, "public/assets/cars/car-catalog.json"), "utf8"),
) as Catalog;

const trellis = catalog.cars.filter((c) => c.wheelWellMode === "empty");
let failed = 0;

for (const entry of trellis) {
	const wheelId = resolveWheelIdForCar(entry.id, entry.defaultWheelId ?? "default");
	const display = await loadCarModel(entry.id, "blue");
	const car = display.getObjectByName("octaneCar") ?? display.children[0];

	const mounted = await mountWheelGlb(display, wheelId, entry.id);
	if (!mounted) {
		console.error(`FAIL ${entry.id}: mountWheelGlb(${wheelId})`);
		failed++;
		continue;
	}

	const showcase = cloneCarMesh(display);
	showcase.scale.setScalar(2.45);
	showcase.updateMatrixWorld(true);

	const contact = rimContactY(showcase, "wheel_FL");
	const snap =
		car && typeof car.userData?.wheelSnapDelta === "number"
			? car.userData.wheelSnapDelta
			: null;
	const ok =
		contact != null && Math.abs(contact - surfaceContactY()) <= 0.015;

	console.log(
		JSON.stringify({
			carId: entry.id,
			wheelId,
			contactY: contact != null ? +contact.toFixed(4) : null,
			wheelSnapDelta: snap != null ? +snap.toFixed(4) : null,
			bodyMaxY: +bodyMaxY(showcase).toFixed(3),
			ok,
		}),
	);
	if (!ok) failed++;
}

if (failed > 0) {
	console.error(`\ncars:simulate-mount — ${failed} FAIL`);
	process.exit(1);
}
console.log(`\ncars:simulate-mount — ${trellis.length}/${trellis.length} OK`);
