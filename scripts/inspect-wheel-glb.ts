import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
	alignWheelInstanceOnHub,
	orientWheelInstanceForHub,
} from "../src/visual/wheelMount";

const ROOT = join(import.meta.dirname, "..");
const loader = new GLTFLoader();

async function loadGlb(rel: string) {
	const buf = readFileSync(join(ROOT, "public", rel.replace(/^\//, "")));
	return new Promise<THREE.Group>((res, rej) =>
		loader.parse(
			buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
			"",
			(gltf) => res(gltf.scene),
			rej,
		),
	);
}

for (const f of ["assets/items/wheels/factory.glb", "assets/items/wheels/dune.glb"]) {
	const m = await loadGlb(f);
	m.updateMatrixWorld(true);
	const before = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3());
	orientWheelInstanceForHub(m, "auto");
	m.updateMatrixWorld(true);
	const hub = new THREE.Group();
	const rim = m.clone(true);
	alignWheelInstanceOnHub(rim, hub, 0.28, 0.35, "auto");

	const car = new THREE.Group();
	car.rotation.y = Math.PI;
	const hub2 = new THREE.Group();
	hub2.position.set(0.2, 0.32, 0.35);
	car.add(hub2);
	car.updateMatrixWorld(true);
	const rim2 = m.clone(true);
	alignWheelInstanceOnHub(rim2, hub2, 0.28, 0.35, "auto");
	car.updateMatrixWorld(true);
	const world = new THREE.Vector3();
	rim2.getWorldPosition(world);

	console.log(
		f,
		"rimPos",
		rim.position.toArray().map((x) => +x.toFixed(3)),
		"rotY=PI world",
		world.toArray().map((x) => +x.toFixed(3)),
	);
}
