/**
 * Boost pady — look bliższy Rocket League:
 * płaski pierścień + chevrony (małe), energia-orb + obracające się pierścienie (duże).
 * Delikatny idle spin / pulse — bez żółtych „krążków-placeholdera” i bez wash bloom.
 */
import * as THREE from "three";
import { resolveArenaNeonHex } from "../../arena/arenaNeonAccent";
import type { BoostPadPickupEvent } from "../../arena/BoostPadManager";
import { resolveBoostPadLayout } from "../../arena/boostPadLayout";

type PadMesh = {
	root: THREE.Group;
	spinGroup: THREE.Group;
	/** Big: orb + elipsy (pivoty). */
	orbRig: THREE.Group | null;
	plate: THREE.Mesh;
	face: THREE.Mesh;
	ring: THREE.Mesh;
	glow: THREE.Mesh;
	shadow: THREE.Mesh;
	orb: THREE.Mesh | null;
	orbShade: THREE.Mesh | null;
	rings: THREE.Mesh[];
	/** Pivoty elips — obrót Y = widoczny spin obręczy. */
	ringPivots: THREE.Group[];
	light: THREE.PointLight | null;
	big: boolean;
	pulse: number;
	spinSpeed: number;
	padR: number;
	orbR: number;
	orbY: number;
};

const _discGeo = new THREE.CircleGeometry(1, 48);
const _ringGeo = new THREE.RingGeometry(0.72, 1.0, 48);
const _plateGeo = new THREE.CylinderGeometry(1, 1.02, 1, 40, 1, false);
const _orbGeo = new THREE.SphereGeometry(1, 28, 20);
const _torusGeo = new THREE.TorusGeometry(1, 0.045, 8, 48);

let sharedPadMap: THREE.Texture | null = null;
let sharedPadMapBig: THREE.Texture | null = null;

/** RL-ish: ciemny pad + pomarańczowe strzałki w pierścieniu. */
function makePadFaceTexture(big: boolean): THREE.Texture {
	const size = big ? 512 : 256;
	if (typeof document === "undefined") {
		const data = new Uint8Array(4);
		data[0] = 255;
		data[1] = 154;
		data[2] = 24;
		data[3] = 255;
		const tex = new THREE.DataTexture(data, 1, 1);
		tex.needsUpdate = true;
		return tex;
	}
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext("2d")!;
	const cx = size / 2;
	const cy = size / 2;

	ctx.clearRect(0, 0, size, size);
	/** Ciemny metaliczny spód. */
	const bg = ctx.createRadialGradient(cx, cy, size * 0.08, cx, cy, size * 0.5);
	bg.addColorStop(0, "#3a2810");
	bg.addColorStop(0.55, "#1a1208");
	bg.addColorStop(1, "#0a0704");
	ctx.fillStyle = bg;
	ctx.beginPath();
	ctx.arc(cx, cy, size * 0.48, 0, Math.PI * 2);
	ctx.fill();

	/** Zewnętrzny pierścień. */
	ctx.strokeStyle = "#ffb020";
	ctx.lineWidth = size * (big ? 0.028 : 0.034);
	ctx.beginPath();
	ctx.arc(cx, cy, size * 0.42, 0, Math.PI * 2);
	ctx.stroke();
	ctx.strokeStyle = "rgba(255, 200, 60, 0.35)";
	ctx.lineWidth = size * 0.012;
	ctx.beginPath();
	ctx.arc(cx, cy, size * 0.36, 0, Math.PI * 2);
	ctx.stroke();

	/** Chevrony / strzałki wokół (jak RL pad). */
	const n = big ? 8 : 6;
	for (let i = 0; i < n; i++) {
		const a = (i / n) * Math.PI * 2 - Math.PI / 2;
		const r0 = size * 0.16;
		const r1 = size * 0.32;
		ctx.save();
		ctx.translate(cx, cy);
		ctx.rotate(a);
		ctx.beginPath();
		ctx.moveTo(0, -r1);
		ctx.lineTo(size * 0.055, -r0);
		ctx.lineTo(size * 0.018, -r0);
		ctx.lineTo(size * 0.018, -r0 * 0.55);
		ctx.lineTo(-size * 0.018, -r0 * 0.55);
		ctx.lineTo(-size * 0.018, -r0);
		ctx.lineTo(-size * 0.055, -r0);
		ctx.closePath();
		const grad = ctx.createLinearGradient(0, -r1, 0, -r0 * 0.4);
		grad.addColorStop(0, "#ffe080");
		grad.addColorStop(0.45, "#ff9a18");
		grad.addColorStop(1, "#c86800");
		ctx.fillStyle = grad;
		ctx.fill();
		ctx.restore();
	}

	/** Centrum — mały glow. */
	const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.12);
	core.addColorStop(0, "rgba(255, 220, 100, 0.85)");
	core.addColorStop(0.6, "rgba(255, 140, 20, 0.35)");
	core.addColorStop(1, "rgba(0,0,0,0)");
	ctx.fillStyle = core;
	ctx.beginPath();
	ctx.arc(cx, cy, size * 0.12, 0, Math.PI * 2);
	ctx.fill();

	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.anisotropy = 8;
	tex.needsUpdate = true;
	return tex;
}

function padFaceMap(big: boolean): THREE.Texture {
	if (big) {
		sharedPadMapBig ??= makePadFaceTexture(true);
		return sharedPadMapBig;
	}
	sharedPadMap ??= makePadFaceTexture(false);
	return sharedPadMap;
}

export class BoostPadVfx {
	private readonly root = new THREE.Group();
	private readonly pads: PadMesh[] = [];
	private readonly pickupBursts: {
		mesh: THREE.Mesh;
		life: number;
		maxLife: number;
	}[] = [];

	constructor(scene: THREE.Scene) {
		this.root.name = "boostPads";
		scene.add(this.root);

		const amber = new THREE.Color(0xff9a18);
		const amberHot = new THREE.Color(0xffd060);
		const plateDark = new THREE.Color(0x14100a);

		for (const spec of resolveBoostPadLayout()) {
			const group = new THREE.Group();
			group.position.set(spec.x, 0, spec.z);
			group.name = spec.big ? "boostPadBig" : "boostPadSmall";

			const padR = spec.big ? 1.55 : 0.58;
			const plateH = spec.big ? 0.07 : 0.045;
			const plateTopY = spec.big ? 0.12 : 0.09;
			const orbR = spec.big ? 0.72 : 0;
			const orbY = plateTopY + (spec.big ? orbR + 0.55 : 0);

			const shadow = new THREE.Mesh(
				_discGeo,
				new THREE.MeshBasicMaterial({
					color: 0x000000,
					transparent: true,
					opacity: spec.big ? 0.22 : 0.14,
					depthWrite: false,
				}),
			);
			shadow.rotation.x = -Math.PI / 2;
			shadow.position.y = 0.022;
			shadow.scale.setScalar(padR * 1.08);
			shadow.renderOrder = 1;

			/** Lokalny glow — mały, żeby nie myć murawy bloomem. */
			const glow = new THREE.Mesh(
				_discGeo,
				new THREE.MeshBasicMaterial({
					color: amberHot,
					transparent: true,
					opacity: spec.big ? 0.28 : 0.2,
					depthWrite: false,
					blending: THREE.AdditiveBlending,
					toneMapped: false,
				}),
			);
			glow.rotation.x = -Math.PI / 2;
			glow.position.y = 0.035;
			glow.scale.setScalar(padR * (spec.big ? 1.55 : 1.4));
			glow.renderOrder = 0;

			const plate = new THREE.Mesh(
				_plateGeo,
				new THREE.MeshStandardMaterial({
					color: plateDark,
					emissive: amber,
					emissiveIntensity: 0.35,
					metalness: 0.75,
					roughness: 0.4,
					toneMapped: true,
				}),
			);
			plate.position.y = plateTopY - plateH * 0.5;
			plate.scale.set(padR, plateH, padR);
			plate.receiveShadow = true;

			const face = new THREE.Mesh(
				_discGeo,
				new THREE.MeshStandardMaterial({
					map: padFaceMap(spec.big),
					color: 0xffffff,
					emissive: amber,
					emissiveIntensity: 0.55,
					emissiveMap: padFaceMap(spec.big),
					metalness: 0.35,
					roughness: 0.45,
					toneMapped: true,
				}),
			);
			face.rotation.x = -Math.PI / 2;
			face.position.y = plateTopY + 0.004;
			face.scale.setScalar(padR * 0.92);
			face.receiveShadow = true;

			const ring = new THREE.Mesh(
				_ringGeo,
				new THREE.MeshStandardMaterial({
					color: 0x1a1006,
					emissive: amberHot,
					emissiveIntensity: 0.85,
					metalness: 0.55,
					roughness: 0.3,
					side: THREE.DoubleSide,
					toneMapped: true,
				}),
			);
			ring.rotation.x = -Math.PI / 2;
			ring.position.y = plateTopY + 0.01;
			ring.scale.setScalar(padR);

			const orbRig = new THREE.Group();
			orbRig.position.y = orbY;

			let orb: THREE.Mesh | null = null;
			let orbShade: THREE.Mesh | null = null;
			const rings: THREE.Mesh[] = [];
			const ringPivots: THREE.Group[] = [];
			let light: THREE.PointLight | null = null;

			if (spec.big) {
				orb = new THREE.Mesh(
					_orbGeo,
					new THREE.MeshStandardMaterial({
						color: amberHot,
						emissive: amber,
						emissiveIntensity: 1.15,
						metalness: 0.08,
						roughness: 0.22,
						transparent: true,
						opacity: 0.88,
						toneMapped: true,
					}),
				);
				orb.scale.setScalar(orbR);

				orbShade = new THREE.Mesh(
					_orbGeo,
					new THREE.MeshBasicMaterial({
						color: amberHot,
						transparent: true,
						opacity: 0.22,
						depthWrite: false,
						blending: THREE.AdditiveBlending,
						toneMapped: false,
						side: THREE.BackSide,
					}),
				);
				orbShade.scale.setScalar(orbR * 1.18);

				/** 3 elipsy pod różnymi kątami — każda w pivocie, żeby spin był czytelny. */
				for (let i = 0; i < 3; i++) {
					const pivot = new THREE.Group();
					pivot.rotation.x = 0.55 + i * 0.48;
					pivot.rotation.z = i * ((Math.PI * 2) / 3) * 0.35;
					const torus = new THREE.Mesh(
						_torusGeo,
						new THREE.MeshBasicMaterial({
							color: amberHot,
							transparent: true,
							opacity: 0.62 - i * 0.08,
							depthWrite: false,
							blending: THREE.AdditiveBlending,
							toneMapped: false,
						}),
					);
					torus.scale.setScalar(orbR * (1.22 + i * 0.1));
					pivot.add(torus);
					orbRig.add(pivot);
					ringPivots.push(pivot);
					rings.push(torus);
				}

				light = new THREE.PointLight(0xffb040, 1.15, 9, 2.2);
				light.castShadow = false;
				orbRig.add(orbShade, orb, light);
			}

			/** Face — delikatny obrót strzałek. */
			const faceSpin = new THREE.Group();
			faceSpin.add(face);
			faceSpin.position.y = 0;

			group.add(shadow, glow, plate, ring, faceSpin, orbRig);
			this.root.add(group);

			this.pads.push({
				root: group,
				spinGroup: faceSpin,
				orbRig: spec.big ? orbRig : null,
				plate,
				face,
				ring,
				glow,
				shadow,
				orb,
				orbShade,
				rings,
				ringPivots,
				light,
				big: spec.big,
				pulse: Math.random() * Math.PI * 2,
				spinSpeed: spec.big ? 0.65 : 0.95,
				padR,
				orbR,
				orbY,
			});
		}

		const burstGeo = new THREE.SphereGeometry(1, 12, 8);
		for (let i = 0; i < 8; i++) {
			const mesh = new THREE.Mesh(
				burstGeo,
				new THREE.MeshBasicMaterial({
					color: 0xffcc55,
					transparent: true,
					opacity: 0,
					depthWrite: false,
					blending: THREE.AdditiveBlending,
				}),
			);
			mesh.visible = false;
			this.root.add(mesh);
			this.pickupBursts.push({ mesh, life: 0, maxLife: 0 });
		}
	}

	setArenaAccent(accent?: string): void {
		const accentColor = new THREE.Color(resolveArenaNeonHex(accent));
		const amber = new THREE.Color(0xff9a18);
		const tint = amber.clone().lerp(accentColor, 0.12);
		const hot = tint.clone().lerp(new THREE.Color(0xffd060), 0.5);
		for (const pad of this.pads) {
			if (pad.orb) {
				const m = pad.orb.material as THREE.MeshStandardMaterial;
				m.color.copy(hot);
				m.emissive.copy(tint);
			}
			const plateMat = pad.plate.material as THREE.MeshStandardMaterial;
			const faceMat = pad.face.material as THREE.MeshStandardMaterial;
			const ringMat = pad.ring.material as THREE.MeshStandardMaterial;
			const glowMat = pad.glow.material as THREE.MeshBasicMaterial;
			plateMat.emissive.copy(tint);
			faceMat.emissive.copy(tint);
			ringMat.emissive.copy(hot);
			glowMat.color.copy(hot);
			if (pad.light) pad.light.color.copy(hot);
			if (pad.orbShade) {
				(pad.orbShade.material as THREE.MeshBasicMaterial).color.copy(hot);
			}
			for (const r of pad.rings) {
				(r.material as THREE.MeshBasicMaterial).color.copy(hot);
			}
		}
	}

	triggerPickup(event: BoostPadPickupEvent): void {
		const slot = this.pickupBursts.find((b) => b.life <= 0);
		if (!slot) return;
		slot.life = event.big ? 0.7 : 0.45;
		slot.maxLife = slot.life;
		slot.mesh.position.set(
			event.position.x,
			event.big ? 1.55 : 0.45,
			event.position.z,
		);
		slot.mesh.scale.setScalar(event.big ? 1.2 : 0.42);
		slot.mesh.visible = true;
		(slot.mesh.material as THREE.MeshBasicMaterial).color.set(
			event.big ? 0xffe8a0 : 0xffc050,
		);
		(slot.mesh.material as THREE.MeshBasicMaterial).opacity = event.big
			? 0.75
			: 0.6;
	}

	update(
		dt: number,
		states: ReadonlyArray<{
			index: number;
			active: boolean;
			respawnRatio: number;
		}>,
	): void {
		for (const state of states) {
			const pad = this.pads[state.index];
			if (!pad) continue;
			pad.pulse += dt * (pad.big ? 1.85 : 2.55);
			const wave = 0.5 + 0.5 * Math.sin(pad.pulse);
			const breathe = 0.94 + wave * 0.09;

			/** Strzałki na padzie — wolny spin + lekki pulse skali. */
			pad.spinGroup.rotation.y += dt * pad.spinSpeed;
			pad.spinGroup.scale.setScalar(0.97 + wave * 0.06);

			if (pad.orbRig) {
				pad.orbRig.position.y = pad.orbY + Math.sin(pad.pulse * 0.85) * 0.07;
				pad.orbRig.rotation.y += dt * 0.45;
				/** Elipsy — wyraźny obrót wokół osi pivota. */
				for (let i = 0; i < pad.ringPivots.length; i++) {
					const pivot = pad.ringPivots[i]!;
					const dir = i % 2 === 0 ? 1 : -1;
					pivot.rotation.y += dt * (2.1 + i * 0.55) * dir;
				}
				if (pad.orb) pad.orb.rotation.y += dt * 0.5;
			}

			const plateMat = pad.plate.material as THREE.MeshStandardMaterial;
			const faceMat = pad.face.material as THREE.MeshStandardMaterial;
			const ringMat = pad.ring.material as THREE.MeshStandardMaterial;
			const glowMat = pad.glow.material as THREE.MeshBasicMaterial;
			const shadowMat = pad.shadow.material as THREE.MeshBasicMaterial;

			if (state.active) {
				if (pad.orb && pad.orbShade) {
					const orbMat = pad.orb.material as THREE.MeshStandardMaterial;
					const shadeMat = pad.orbShade.material as THREE.MeshBasicMaterial;
					pad.orb.scale.setScalar(pad.orbR * breathe);
					pad.orbShade.scale.setScalar(pad.orbR * 1.18 * breathe);
					orbMat.emissiveIntensity = 0.95 + wave * 0.45;
					shadeMat.opacity = 0.16 + wave * 0.14;
					for (let i = 0; i < pad.rings.length; i++) {
						const r = pad.rings[i]!;
						const rm = r.material as THREE.MeshBasicMaterial;
						r.scale.setScalar(
							pad.orbR * (1.22 + i * 0.1) * (0.96 + wave * 0.08),
						);
						rm.opacity = 0.42 + wave * 0.28 - i * 0.06;
					}
				}
				/** Ground ring + glow pulse (małe i duże). */
				pad.ring.scale.setScalar(pad.padR * (0.97 + wave * 0.08));
				pad.glow.scale.setScalar(
					pad.padR * (pad.big ? 1.42 : 1.28) * (0.92 + wave * 0.18),
				);
				plateMat.emissiveIntensity = 0.28 + wave * 0.22;
				faceMat.emissiveIntensity = 0.42 + wave * 0.38;
				ringMat.emissiveIntensity = 0.7 + wave * 0.45;
				glowMat.opacity = (pad.big ? 0.22 : 0.15) + wave * 0.14;
				shadowMat.opacity = pad.big ? 0.22 : 0.14;
				if (pad.light) {
					pad.light.intensity = 0.95 + wave * 0.4;
					pad.light.visible = true;
				}
				pad.root.visible = true;
				pad.spinGroup.visible = true;
				pad.plate.visible = true;
				pad.face.visible = true;
				pad.ring.visible = true;
				if (pad.orbRig) pad.orbRig.visible = true;
			} else {
				const t = state.respawnRatio;
				const s = 0.35 + t * 0.65;
				pad.spinGroup.scale.setScalar(s);
				if (pad.orb && pad.orbShade && pad.orbRig) {
					const orbMat = pad.orb.material as THREE.MeshStandardMaterial;
					const shadeMat = pad.orbShade.material as THREE.MeshBasicMaterial;
					pad.orb.scale.setScalar(pad.orbR * s);
					pad.orbShade.scale.setScalar(pad.orbR * 1.18 * s);
					orbMat.emissiveIntensity = t * 1.05;
					shadeMat.opacity = t * 0.2;
					pad.orbRig.visible = t > 0.1;
					for (let i = 0; i < pad.rings.length; i++) {
						const r = pad.rings[i]!;
						r.scale.setScalar(pad.orbR * (1.22 + i * 0.1) * s);
						(r.material as THREE.MeshBasicMaterial).opacity =
							t * (0.55 - i * 0.08);
					}
				}
				pad.ring.scale.setScalar(pad.padR * s);
				pad.glow.scale.setScalar(pad.padR * 1.2 * t);
				plateMat.emissiveIntensity = t * 0.32;
				faceMat.emissiveIntensity = t * 0.5;
				ringMat.emissiveIntensity = t * 0.8;
				glowMat.opacity = t * (pad.big ? 0.24 : 0.16);
				shadowMat.opacity = 0.05 + t * 0.14;
				if (pad.light) {
					pad.light.intensity = t * 1.05;
					pad.light.visible = t > 0.25;
				}
				pad.root.visible = t > 0.02;
				pad.spinGroup.visible = t > 0.08;
				pad.plate.visible = t > 0.04;
				pad.face.visible = t > 0.04;
				pad.ring.visible = t > 0.04;
			}
		}

		for (const burst of this.pickupBursts) {
			if (burst.life <= 0) {
				burst.mesh.visible = false;
				continue;
			}
			burst.life -= dt;
			const u = 1 - burst.life / burst.maxLife;
			burst.mesh.scale.multiplyScalar(1 + dt * 4.2);
			(burst.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(
				0,
				(1 - u) * (1 - u) * 0.85,
			);
		}
	}

	dispose(): void {
		for (const pad of this.pads) {
			if (pad.orb) (pad.orb.material as THREE.Material).dispose();
			if (pad.orbShade) (pad.orbShade.material as THREE.Material).dispose();
			for (const r of pad.rings) (r.material as THREE.Material).dispose();
			(pad.plate.material as THREE.Material).dispose();
			(pad.face.material as THREE.Material).dispose();
			(pad.ring.material as THREE.Material).dispose();
			(pad.glow.material as THREE.Material).dispose();
			(pad.shadow.material as THREE.Material).dispose();
		}
		for (const burst of this.pickupBursts) {
			(burst.mesh.material as THREE.Material).dispose();
			burst.mesh.geometry.dispose();
		}
		this.root.removeFromParent();
	}
}
