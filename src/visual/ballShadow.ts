import * as THREE from "three";

import { resolveGraphicsSettings } from "../util/graphicsProfile";
import { isPathTraceLookEnabled } from "../util/presentationPrefs";
import { PLAYFIELD_SURFACE_Y } from "./arenaConstants";

/** RL-style „fake shadow” pod piłką — dual-lobe (core + soft penumbra). */
export class BallShadow {
	readonly mesh: THREE.Group;
	private readonly core: THREE.Mesh;
	private readonly penumbra: THREE.Mesh;
	private readonly baseRadius: number;
	private smoothedScaleContact = 1;
	private smoothedOpacity = 0.72;

	constructor(ballRadius: number) {
		this.baseRadius = ballRadius * 1.12;
		this.mesh = new THREE.Group();
		this.mesh.name = "ballShadow";

		const coreMat = new THREE.MeshBasicMaterial({
			map: buildShadowTexture(0.55),
			transparent: true,
			opacity: 0.42,
			depthWrite: false,
			toneMapped: false,
		});
		const penMat = new THREE.MeshBasicMaterial({
			map: buildShadowTexture(0.22),
			transparent: true,
			opacity: 0.18,
			depthWrite: false,
			toneMapped: false,
		});

		this.core = new THREE.Mesh(
			new THREE.CircleGeometry(this.baseRadius, 40),
			coreMat,
		);
		this.penumbra = new THREE.Mesh(
			new THREE.CircleGeometry(this.baseRadius * 1.65, 40),
			penMat,
		);
		for (const m of [this.core, this.penumbra]) {
			m.rotation.x = -Math.PI / 2;
			m.renderOrder = 3;
			m.frustumCulled = false;
		}
		this.penumbra.renderOrder = 2;
		this.mesh.add(this.penumbra, this.core);
	}

	/** Opacity cienia piłki — czytelniejszy kontakt z murawą. */
	update(ballPos: THREE.Vector3, floorY = PLAYFIELD_SURFACE_Y + 0.005): void {
		this.mesh.position.set(ballPos.x, 0, ballPos.z);
		this.core.position.y = floorY;
		this.penumbra.position.y = floorY - 0.001;

		const height = Math.max(0, ballPos.y - floorY);
		const t = THREE.MathUtils.clamp(height / 18, 0, 1);
		const contact = THREE.MathUtils.clamp(1 - height / 1.35, 0, 1);
		const scale = THREE.MathUtils.lerp(1, 0.55, t ** 0.85);
		const scaleContact = THREE.MathUtils.lerp(
			scale,
			scale * 0.68,
			contact * 0.72,
		);
		const opacity = THREE.MathUtils.lerp(0.55, 0.18, t ** 1.1);
		const opacityContact = THREE.MathUtils.lerp(opacity, 0.62, contact * 0.55);
		const q = resolveGraphicsSettings().quality;
		const smMul = q === "high" ? 1.14 : q === "medium" ? 1.1 : 1.12;
		const ptMul = isPathTraceLookEnabled() ? 0.72 : 0.78;

		const k = q === "high" ? 0.26 : 0.3;
		this.smoothedScaleContact = THREE.MathUtils.lerp(
			this.smoothedScaleContact,
			scaleContact,
			k,
		);
		this.smoothedOpacity = THREE.MathUtils.lerp(
			this.smoothedOpacity,
			opacityContact * smMul * ptMul,
			k,
		);

		this.core.scale.set(
			this.smoothedScaleContact,
			this.smoothedScaleContact,
			1,
		);
		this.penumbra.scale.set(
			this.smoothedScaleContact * 1.55,
			this.smoothedScaleContact * 1.55,
			1,
		);
		(this.core.material as THREE.MeshBasicMaterial).opacity =
			this.smoothedOpacity;
		(this.penumbra.material as THREE.MeshBasicMaterial).opacity =
			this.smoothedOpacity * 0.45;
	}
}

function buildShadowTexture(peak: number): THREE.CanvasTexture {
	const size = 128;
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
	g.addColorStop(0, `rgba(0,0,0,${peak})`);
	g.addColorStop(0.35, `rgba(0,0,0,${peak * 0.35})`);
	g.addColorStop(0.65, `rgba(0,0,0,${peak * 0.1})`);
	g.addColorStop(1, "rgba(0,0,0,0)");
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, size, size);

	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.NoColorSpace;
	return tex;
}
