import * as THREE from "three";

import { resolveGraphicsSettings } from "../util/graphicsProfile";
import { isPathTraceLookEnabled } from "../util/presentationPrefs";
import { PLAYFIELD_SURFACE_Y } from "./arenaConstants";

/**
 * Stały grounding disc pod autem (dual-lobe: core + penumbra) — zawsze widoczny.
 * Bez pop-in: opacity nie skacze z 0; tylko delikatnie blednie w powietrzu.
 * Bez mipmap (unikamy „rozmytej elipsy”).
 */
export class CarContactShadow {
	readonly mesh: THREE.Group;
	private readonly core: THREE.Mesh;
	private readonly penumbra: THREE.Mesh;
	private readonly baseRadius: number;
	private smoothedContact = 1;
	private smoothedHeight = 0;

	constructor(radiusM = 1.05) {
		this.baseRadius = radiusM;
		this.mesh = new THREE.Group();
		this.mesh.name = "carContactShadow";
		this.mesh.visible = true;

		const coreTex = buildContactShadowTexture(0.55);
		const penTex = buildContactShadowTexture(0.22);
		const coreMat = new THREE.MeshBasicMaterial({
			map: coreTex,
			transparent: true,
			opacity: 0.36,
			depthWrite: false,
			toneMapped: false,
		});
		const penMat = new THREE.MeshBasicMaterial({
			map: penTex,
			transparent: true,
			opacity: 0.14,
			depthWrite: false,
			toneMapped: false,
		});
		this.core = new THREE.Mesh(
			new THREE.CircleGeometry(this.baseRadius, 40),
			coreMat,
		);
		this.penumbra = new THREE.Mesh(
			new THREE.CircleGeometry(this.baseRadius * 1.35, 40),
			penMat,
		);
		for (const m of [this.core, this.penumbra]) {
			m.rotation.x = -Math.PI / 2;
			m.position.y = PLAYFIELD_SURFACE_Y + 0.009;
			m.renderOrder = 2;
			m.frustumCulled = false;
			m.receiveShadow = false;
			m.castShadow = false;
			m.visible = true;
		}
		this.penumbra.position.y = PLAYFIELD_SURFACE_Y + 0.007;
		this.penumbra.renderOrder = 1;
		this.core.scale.set(1.05, 1, 1.18);
		this.penumbra.scale.set(1.28, 1, 1.42);
		this.mesh.add(this.penumbra, this.core);
	}

	update(worldPos: THREE.Vector3, onGround: boolean): void {
		this.mesh.position.x = worldPos.x;
		this.mesh.position.z = worldPos.z;
		this.mesh.visible = true;

		const height = Math.max(0, worldPos.y - PLAYFIELD_SURFACE_Y);
		this.smoothedHeight = THREE.MathUtils.lerp(this.smoothedHeight, height, 0.35);
		const h = this.smoothedHeight;

		/** Kontakt: na ziemi zawsze ~1; w powietrzu płynnie w dół, nie do zera. */
		const contactRaw = onGround
			? 1
			: THREE.MathUtils.clamp(1 - h / 3.2, 0.35, 1);
		this.smoothedContact = THREE.MathUtils.lerp(
			this.smoothedContact,
			contactRaw,
			onGround ? 0.45 : 0.22,
		);
		const contact = this.smoothedContact;

		const t = THREE.MathUtils.clamp(h / 7, 0, 1);
		const scale = THREE.MathUtils.lerp(1.0, 1.18, t ** 0.85);
		this.core.scale.set(1.05 * scale, 1, 1.18 * scale);
		this.penumbra.scale.set(1.28 * scale, 1, 1.42 * scale);

		const q = resolveGraphicsSettings().quality;
		const smMul = q === "high" ? 1.0 : 1.05;
		const ptMul = isPathTraceLookEnabled() ? 0.7 : 0.62;
		const coreMat = this.core.material as THREE.MeshBasicMaterial;
		const penMat = this.penumbra.material as THREE.MeshBasicMaterial;
		/** Floor opacity — nigdy poniżej czytelnego minimum na boisku. */
		const coreFloor = 0.28;
		const penFloor = 0.1;
		coreMat.opacity =
			THREE.MathUtils.lerp(coreFloor, 0.48, contact) * smMul * ptMul;
		penMat.opacity =
			THREE.MathUtils.lerp(penFloor, 0.2, contact) * smMul * ptMul;
	}

	dispose(): void {
		this.mesh.removeFromParent();
		for (const m of [this.core, this.penumbra]) {
			m.geometry.dispose();
			const mat = m.material as THREE.MeshBasicMaterial;
			mat.map?.dispose();
			mat.dispose();
		}
	}
}

function buildContactShadowTexture(peak: number): THREE.CanvasTexture {
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
	g.addColorStop(0.25, `rgba(0,0,0,${peak * 0.4})`);
	g.addColorStop(0.55, `rgba(0,0,0,${peak * 0.12})`);
	g.addColorStop(0.82, `rgba(0,0,0,${peak * 0.03})`);
	g.addColorStop(1, "rgba(0,0,0,0)");
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, size, size);
	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.NoColorSpace;
	tex.generateMipmaps = false;
	tex.minFilter = THREE.LinearFilter;
	tex.magFilter = THREE.LinearFilter;
	return tex;
}
