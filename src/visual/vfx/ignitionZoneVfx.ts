import * as THREE from "three";

import type {
	IgnitionZoneKind,
	IgnitionZoneSpec,
} from "../../modes/IgnitionZones";

const KIND_COLOR: Record<IgnitionZoneKind, number> = {
	lowGrav: 0x66ffe0,
	magnetic: 0xb06cff,
};

type ZoneMesh = {
	spec: IgnitionZoneSpec;
	root: THREE.Group;
	ring: THREE.Mesh;
	inner: THREE.Mesh;
	glow: THREE.PointLight;
	pulse: number;
};

/** Pierścienie stref Ignition na murawie. */
export class IgnitionZoneVfx {
	private readonly root = new THREE.Group();
	private readonly meshes: ZoneMesh[] = [];

	constructor(scene: THREE.Scene) {
		this.root.name = "ignitionZones";
		scene.add(this.root);
	}

	setZones(zones: readonly IgnitionZoneSpec[]): void {
		this.clearMeshes();
		const ringGeo = new THREE.RingGeometry(0.82, 1, 48);
		const innerGeo = new THREE.CircleGeometry(0.72, 32);

		for (const spec of zones) {
			const color = KIND_COLOR[spec.kind];
			const group = new THREE.Group();
			group.position.set(spec.x, 0.07, spec.z);
			group.rotation.x = -Math.PI / 2;
			group.scale.setScalar(spec.radius);

			const ringMat = new THREE.MeshBasicMaterial({
				color,
				transparent: true,
				opacity: 0.72,
				depthWrite: false,
				blending: THREE.AdditiveBlending,
				side: THREE.DoubleSide,
			});
			const innerMat = new THREE.MeshBasicMaterial({
				color,
				transparent: true,
				opacity: 0.22,
				depthWrite: false,
				blending: THREE.AdditiveBlending,
				side: THREE.DoubleSide,
			});

			const ring = new THREE.Mesh(ringGeo, ringMat);
			const inner = new THREE.Mesh(innerGeo, innerMat);
			group.add(ring, inner);

			const glow = new THREE.PointLight(color, 0.55, spec.radius * 3.2);
			glow.position.set(0, 0.5, 0);
			group.add(glow);

			this.root.add(group);
			this.meshes.push({
				spec,
				root: group,
				ring,
				inner,
				glow,
				pulse: Math.random() * Math.PI * 2,
			});
		}
	}

	/** Podświetl strefę gdy ktoś ma aktywny buff tego typu. */
	update(dt: number, activeKinds: ReadonlySet<IgnitionZoneKind>): void {
		for (const mesh of this.meshes) {
			mesh.pulse += dt * (activeKinds.has(mesh.spec.kind) ? 4.2 : 2.1);
			const wave = 0.5 + 0.5 * Math.sin(mesh.pulse);
			const hot = activeKinds.has(mesh.spec.kind);
			const ringMat = mesh.ring.material as THREE.MeshBasicMaterial;
			const innerMat = mesh.inner.material as THREE.MeshBasicMaterial;
			ringMat.opacity = hot ? 0.55 + wave * 0.4 : 0.45 + wave * 0.2;
			innerMat.opacity = hot ? 0.18 + wave * 0.2 : 0.12 + wave * 0.08;
			mesh.glow.intensity = hot ? 0.9 + wave * 0.55 : 0.4 + wave * 0.2;
			const s = 1 + (hot ? wave * 0.06 : wave * 0.03);
			mesh.ring.scale.setScalar(s);
		}
	}

	dispose(): void {
		this.clearMeshes();
		this.root.removeFromParent();
	}

	private clearMeshes(): void {
		for (const mesh of this.meshes) {
			mesh.root.removeFromParent();
			mesh.ring.geometry.dispose();
			mesh.inner.geometry.dispose();
			(mesh.ring.material as THREE.Material).dispose();
			(mesh.inner.material as THREE.Material).dispose();
			mesh.glow.dispose();
		}
		this.meshes.length = 0;
	}
}
