/**
 * Distant atmosphere poza skorupą.
 * Miasto = equirect skybox (`cyberpunk_skybox.png`).
 * Tu tylko delikatny haze — zero geometrii budynków (klocki zasłaniały detal).
 */
import * as THREE from "three";

import { RL_ARENA } from "../arenaConstants";

export type ArenaParallax = {
	root: THREE.Group;
	layers: { mesh: THREE.Object3D; factor: number }[];
	origin: THREE.Vector3;
};

function makeHazeBand(
	radius: number,
	height: number,
	color: number,
	opacity: number,
): THREE.Mesh {
	const geo = new THREE.CylinderGeometry(
		radius,
		radius * 1.03,
		height,
		64,
		1,
		true,
	);
	const mat = new THREE.MeshBasicMaterial({
		color,
		transparent: true,
		opacity,
		side: THREE.BackSide,
		depthWrite: false,
		fog: false,
	});
	const mesh = new THREE.Mesh(geo, mat);
	mesh.position.y = height * 0.2;
	mesh.frustumCulled = false;
	mesh.castShadow = false;
	mesh.receiveShadow = false;
	return mesh;
}

export function createArenaParallax(parent: THREE.Object3D): ArenaParallax {
	const root = new THREE.Group();
	root.name = "arenaParallax";
	parent.add(root);

	const r0 = Math.hypot(RL_ARENA.HALF_WIDTH, RL_ARENA.HALF_LENGTH) + 32;

	/** Opacity ≤0.03 — zero mleka; miasto w skyboxie musi zostać. */
	const farHaze = makeHazeBand(r0 + 48, 55, 0x080412, 0.03);
	farHaze.name = "parallaxFarHaze";
	const midHaze = makeHazeBand(r0 + 22, 32, 0x040810, 0.02);
	midHaze.name = "parallaxMidHaze";

	root.add(farHaze, midHaze);

	return {
		root,
		layers: [
			{ mesh: farHaze, factor: 0.04 },
			{ mesh: midHaze, factor: 0.08 },
		],
		origin: new THREE.Vector3(0, 0, 0),
	};
}

const _camXZ = new THREE.Vector3();

export function updateArenaParallax(
	parallax: ArenaParallax,
	cameraPos: THREE.Vector3,
): void {
	_camXZ.set(cameraPos.x, 0, cameraPos.z);
	for (const layer of parallax.layers) {
		layer.mesh.position.x = _camXZ.x * layer.factor;
		layer.mesh.position.z = _camXZ.z * layer.factor;
	}
}
