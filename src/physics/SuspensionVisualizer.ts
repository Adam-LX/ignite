import * as THREE from "three";

import { RL_HOVER } from "../util/rlConstants";

export type SuspensionRayDebug = {
	origin: THREE.Vector3;
	end: THREE.Vector3;
	hit: boolean;
};

const GREEN = 0x22ff66;
const RED = 0xff2244;

/** 4 linie raycastów zawieszenia — zielona = trafienie, czerwona = brak. */
export class SuspensionVisualizer {
	private readonly root = new THREE.Group();
	private readonly lines: THREE.Line[] = [];
	private readonly materials: THREE.LineBasicMaterial[] = [];

	constructor(scene: THREE.Scene) {
		this.root.name = "suspensionDebug";
		scene.add(this.root);

		for (let i = 0; i < 4; i++) {
			const mat = new THREE.LineBasicMaterial({
				color: RED,
				depthTest: false,
				transparent: true,
				opacity: 0.95,
			});
			const geo = new THREE.BufferGeometry().setFromPoints([
				new THREE.Vector3(),
				new THREE.Vector3(0, -RL_HOVER.suspensionMaxLength, 0),
			]);
			const line = new THREE.Line(geo, mat);
			line.frustumCulled = false;
			line.renderOrder = 9999;
			this.lines.push(line);
			this.materials.push(mat);
			this.root.add(line);
		}
	}

	update(rays: SuspensionRayDebug[]): void {
		for (let i = 0; i < this.lines.length; i++) {
			const ray = rays[i];
			const line = this.lines[i]!;
			const mat = this.materials[i]!;
			if (!ray) {
				mat.color.setHex(RED);
				continue;
			}
			mat.color.setHex(ray.hit ? GREEN : RED);
			const pos = line.geometry.getAttribute(
				"position",
			) as THREE.BufferAttribute;
			pos.setXYZ(0, ray.origin.x, ray.origin.y, ray.origin.z);
			pos.setXYZ(1, ray.end.x, ray.end.y, ray.end.z);
			pos.needsUpdate = true;
			line.geometry.computeBoundingSphere();
		}
	}

	dispose(): void {
		for (const line of this.lines) {
			line.geometry.dispose();
		}
		for (const mat of this.materials) {
			mat.dispose();
		}
		this.root.removeFromParent();
	}
}
