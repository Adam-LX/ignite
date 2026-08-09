import * as THREE from "three";

import { resolveGraphicsSettings } from "../util/graphicsProfile";
import { PLAYFIELD_SURFACE_Y } from "./arenaConstants";

/**
 * Soft contact shadow pod autem — fill blisko kół.
 * High: SM niesie kształt; disc = miękki grounding (nie duża plama).
 */
export class CarContactShadow {
	readonly mesh: THREE.Mesh;
	private readonly baseRadius: number;

	constructor(radiusM = 1.25) {
		this.baseRadius = radiusM;
		const tex = buildContactShadowTexture();
		const mat = new THREE.MeshBasicMaterial({
			map: tex,
			transparent: true,
			opacity: 0.72,
			depthWrite: false,
			toneMapped: false,
		});
		this.mesh = new THREE.Mesh(
			new THREE.CircleGeometry(this.baseRadius, 48),
			mat,
		);
		this.mesh.name = "carContactShadow";
		this.mesh.rotation.x = -Math.PI / 2;
		this.mesh.position.y = PLAYFIELD_SURFACE_Y + 0.008;
		this.mesh.renderOrder = 2;
		this.mesh.frustumCulled = false;
		this.mesh.receiveShadow = false;
		this.mesh.castShadow = false;
		this.mesh.scale.set(1.18, 1, 1.36);
	}

	/** worldPos = środek auta; airborne → cień blednie i rośnie. */
	update(worldPos: THREE.Vector3, onGround: boolean): void {
		this.mesh.position.x = worldPos.x;
		this.mesh.position.z = worldPos.z;
		const height = Math.max(0, worldPos.y - PLAYFIELD_SURFACE_Y);
		const t = THREE.MathUtils.clamp(height / 6, 0, 1);
		const contact = onGround
			? 1
			: THREE.MathUtils.clamp(1 - height / 2.4, 0, 1);
		const scale = THREE.MathUtils.lerp(1.1, 0.65, t ** 0.9);
		this.mesh.scale.set(1.18 * scale, 1, 1.36 * scale);
		const mat = this.mesh.material as THREE.MeshBasicMaterial;
		const q = resolveGraphicsSettings().quality;
		/** High ma SM — contact i tak ma dokładać czytelny „grounding”. */
		const smMul = q === "high" ? 0.82 : q === "medium" ? 0.78 : 0.95;
		mat.opacity =
			THREE.MathUtils.lerp(0.38, 0.92, contact) *
			(0.88 + contact * 0.12) *
			smMul;
		this.mesh.visible = contact > 0.04 || height < 5;
	}

	dispose(): void {
		this.mesh.removeFromParent();
		this.mesh.geometry.dispose();
		const mat = this.mesh.material as THREE.MeshBasicMaterial;
		mat.map?.dispose();
		mat.dispose();
	}
}

function buildContactShadowTexture(): THREE.CanvasTexture {
	const size = 256;
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Canvas 2D unavailable");
	const g = ctx.createRadialGradient(
		size / 2,
		size / 2,
		0,
		size / 2,
		size / 2,
		size / 2,
	);
	/** Soft brim — grounding bez twardego owalu. */
	g.addColorStop(0, "rgba(0,0,0,0.78)");
	g.addColorStop(0.14, "rgba(0,0,0,0.48)");
	g.addColorStop(0.36, "rgba(0,0,0,0.2)");
	g.addColorStop(0.6, "rgba(0,0,0,0.07)");
	g.addColorStop(0.82, "rgba(0,0,0,0.02)");
	g.addColorStop(1, "rgba(0,0,0,0)");
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, size, size);
	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.NoColorSpace;
	tex.generateMipmaps = true;
	tex.minFilter = THREE.LinearMipmapLinearFilter;
	tex.magFilter = THREE.LinearFilter;
	return tex;
}
