#!/usr/bin/env node
/** Inspekcja GLB felg — bbox przed/po orientWheelInstanceForHub */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
	measureWheelItemDiameterM,
	orientWheelInstanceOnHub,
} from "../src/visual/wheelMount.ts";

const ROOT = join(import.meta.dirname, "..");
const loader = new GLTFLoader();

async function inspect(file: string) {
	const buf = readFileSync(join(ROOT, "public/assets/items/wheels", file));
	const gltf = await new Promise<{
		scene: THREE.Group;
	}>((res, rej) =>
		loader.parse(
			buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
			"",
			res,
			rej,
		),
	);
	const m = gltf.scene.clone(true);
	m.updateMatrixWorld(true);
	const before = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3());
	orientWheelInstanceForHub(m, "+X");
	m.updateMatrixWorld(true);
	const after = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3());
	const ref = measureWheelItemDiameterM(gltf.scene.clone(true));
	console.log(
		JSON.stringify({
			file,
			before: { x: +before.x.toFixed(3), y: +before.y.toFixed(3), z: +before.z.toFixed(3) },
			after: { x: +after.x.toFixed(3), y: +after.y.toFixed(3), z: +after.z.toFixed(3) },
			refD: +ref.toFixed(3),
			rotDeg: m.rotation.toArray().map((r) => Math.round((r * 180) / Math.PI)),
		}),
	);
}

for (const f of process.argv.slice(2)) {
	await inspect(f);
}
