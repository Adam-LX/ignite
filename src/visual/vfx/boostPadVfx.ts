/**
 * Boost pady — look bliższy Rocket League:
 * płaski pierścień + chevrony (małe), energia-orb + aura blasku dookoła sfery.
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
	/** Aura / blask wokół sfery (albo nad małym padem). */
	rayRig: THREE.Group;
	shafts: THREE.Mesh[];
	corona: THREE.Mesh;
	halo: THREE.Mesh | null;
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
	rayBaseOpacity: number;
};

const _discGeo = new THREE.CircleGeometry(1, 64);
const _ringGeo = new THREE.RingGeometry(0.72, 1.0, 48);
const _plateGeo = new THREE.CylinderGeometry(1, 1.02, 1, 40, 1, false);
const _orbGeo = new THREE.SphereGeometry(1, 28, 20);
const _torusGeo = new THREE.TorusGeometry(1, 0.045, 8, 48);
/** Spike od środka sfery — UV.y: 0 = core, 1 = tip. */
const _spikeGeo = new THREE.PlaneGeometry(1, 1, 1, 6);
_spikeGeo.translate(0, 0.5, 0);

let sharedPadMap: THREE.Texture | null = null;
let sharedPadMapBig: THREE.Texture | null = null;
let sharedSunburstMap: THREE.Texture | null = null;

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

/** Soft sunburst — blask z modulacją promieni, nie twarde kliny. */
function makeSunburstTexture(): THREE.Texture {
	if (sharedSunburstMap) return sharedSunburstMap;
	const size = 512;
	if (typeof document === "undefined") {
		const data = new Uint8Array(4);
		data[0] = 255;
		data[1] = 200;
		data[2] = 90;
		data[3] = 200;
		const tex = new THREE.DataTexture(data, 1, 1);
		tex.needsUpdate = true;
		sharedSunburstMap = tex;
		return tex;
	}
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext("2d")!;
	const cx = size / 2;
	const cy = size / 2;
	const img = ctx.createImageData(size, size);
	const rays = 28;
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const dx = x + 0.5 - cx;
			const dy = y + 0.5 - cy;
			const r = Math.hypot(dx, dy) / (size * 0.5);
			const ang = Math.atan2(dy, dx);
			/** Miękka modulacja promieni wokół pełnego koła. */
			const ray =
				0.55 +
				0.45 *
					Math.pow(
						0.5 + 0.5 * Math.cos(ang * rays),
						2.4,
					);
			const fall = Math.max(0, 1 - r);
			const soft = fall * fall * (0.35 + 0.65 * ray);
			const a = Math.round(255 * Math.min(1, soft * 1.15));
			const i = (y * size + x) * 4;
			img.data[i] = 255;
			img.data[i + 1] = 210;
			img.data[i + 2] = 120;
			img.data[i + 3] = a;
		}
	}
	ctx.putImageData(img, 0, 0);
	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.needsUpdate = true;
	sharedSunburstMap = tex;
	return tex;
}

/** Spike blasku od środka sfery — szeroki, miękki (nie kreska). */
function createOrbSpikeMaterial(
	color: THREE.Color,
	opacity: number,
): THREE.ShaderMaterial {
	return new THREE.ShaderMaterial({
		transparent: true,
		depthWrite: false,
		depthTest: true,
		blending: THREE.AdditiveBlending,
		side: THREE.DoubleSide,
		fog: false,
		toneMapped: false,
		uniforms: {
			uColor: { value: color.clone() },
			uOpacity: { value: opacity },
		},
		vertexShader: /* glsl */ `
			varying vec2 vUv;
			void main() {
				vUv = uv;
				gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
			}
		`,
		fragmentShader: /* glsl */ `
			uniform vec3 uColor;
			uniform float uOpacity;
			varying vec2 vUv;
			void main() {
				float edge = abs(vUv.x - 0.5) * 2.0;
				/** Szeroki lobe — blask, nie igła. */
				float lobe = pow(1.0 - clamp(edge, 0.0, 1.0), 1.65);
				float along = pow(1.0 - vUv.y, 1.8) * smoothstep(0.0, 0.08, vUv.y);
				float alpha = uOpacity * lobe * along;
				if (alpha < 0.008) discard;
				vec3 lit = uColor * (0.65 + 0.35 * lobe);
				gl_FragColor = vec4(lit, alpha);
			}
		`,
	});
}

const _fibDir = new THREE.Vector3();
const _fibUp = new THREE.Vector3(0, 1, 0);

/** Aura wokół sfery: soft halo + przecinające sunbursty + spike’i 360°. */
function buildPadRayRig(
	big: boolean,
	padR: number,
	orbR: number,
	color: THREE.Color,
): {
	rig: THREE.Group;
	shafts: THREE.Mesh[];
	corona: THREE.Mesh;
	halo: THREE.Mesh | null;
	baseOpacity: number;
} {
	const rig = new THREE.Group();
	rig.name = "boostPadAura";
	const shafts: THREE.Mesh[] = [];
	const baseOpacity = big ? 0.42 : 0.32;
	const burstMap = makeSunburstTexture();

	let halo: THREE.Mesh | null = null;
	if (big && orbR > 0.01) {
		halo = new THREE.Mesh(
			_orbGeo,
			new THREE.MeshBasicMaterial({
				color,
				transparent: true,
				opacity: 0.22,
				depthWrite: false,
				blending: THREE.AdditiveBlending,
				toneMapped: false,
				side: THREE.BackSide,
			}),
		);
		halo.scale.setScalar(orbR * 2.35);
		halo.renderOrder = 2;
		halo.frustumCulled = false;
		rig.add(halo);
	}

	/**
	 * Sunburst discs przez środek sfery — blask widoczny ze wszystkich stron,
	 * nie tylko „w górę”.
	 */
	const discRots: THREE.Euler[] = big
		? [
				new THREE.Euler(0, 0, 0),
				new THREE.Euler(Math.PI / 2, 0, 0),
				new THREE.Euler(0, 0, Math.PI / 2),
				new THREE.Euler(Math.PI / 4, Math.PI / 5, Math.PI / 6),
				new THREE.Euler(-Math.PI / 5, Math.PI / 3, -Math.PI / 7),
			]
		: [new THREE.Euler(-Math.PI / 2, 0, 0)];

	let corona: THREE.Mesh | null = null;
	for (let i = 0; i < discRots.length; i++) {
		const disc = new THREE.Mesh(
			_discGeo,
			new THREE.MeshBasicMaterial({
				map: burstMap,
				color,
				transparent: true,
				opacity: big ? 0.38 - i * 0.04 : 0.45,
				depthWrite: false,
				blending: THREE.AdditiveBlending,
				toneMapped: false,
				side: THREE.DoubleSide,
			}),
		);
		disc.rotation.copy(discRots[i]!);
		disc.scale.setScalar(
			big ? orbR * (3.4 + i * 0.15) : padR * 2.35,
		);
		disc.renderOrder = 3;
		disc.frustumCulled = false;
		rig.add(disc);
		if (i === 0) corona = disc;
	}
	if (!corona) {
		corona = new THREE.Mesh(
			_discGeo,
			new THREE.MeshBasicMaterial({
				map: burstMap,
				color,
				transparent: true,
				opacity: 0.4,
				depthWrite: false,
				blending: THREE.AdditiveBlending,
				toneMapped: false,
				side: THREE.DoubleSide,
			}),
		);
		rig.add(corona);
	}

	/** Spike’i fibonacci — pełna sfera wokół orba (big) / półsfera nad padem (small). */
	const spikeCount = big ? 22 : 10;
	const spikeLen = big ? orbR * 3.8 : padR * 2.2;
	const spikeW = big ? orbR * 1.15 : padR * 0.85;
	const golden = Math.PI * (3 - Math.sqrt(5));

	for (let i = 0; i < spikeCount; i++) {
		let y: number;
		let radius: number;
		if (big) {
			y = 1 - (i / (spikeCount - 1)) * 2;
			radius = Math.sqrt(Math.max(0, 1 - y * y));
		} else {
			/** Mały pad: tylko górna półsfera blasku. */
			y = 0.15 + (i / (spikeCount - 1)) * 0.85;
			radius = Math.sqrt(Math.max(0, 1 - y * y));
		}
		const theta = golden * i;
		_fibDir.set(
			Math.cos(theta) * radius,
			y,
			Math.sin(theta) * radius,
		).normalize();

		const mat = createOrbSpikeMaterial(
			color,
			baseOpacity * (0.55 + (i % 4) * 0.1),
		);
		const mesh = new THREE.Mesh(_spikeGeo, mat);
		mesh.frustumCulled = false;
		mesh.renderOrder = 4;
		/** Spike geo idzie w +Y — obróć w kierunku fibonacci. */
		if (_fibDir.y < -0.999) {
			mesh.rotation.x = Math.PI;
		} else {
			mesh.quaternion.setFromUnitVectors(_fibUp, _fibDir);
		}
		mesh.scale.set(
			spikeW * (0.7 + (i % 3) * 0.18),
			spikeLen * (0.75 + (i % 5) * 0.08),
			1,
		);
		rig.add(mesh);
		shafts.push(mesh);
	}

	return { rig, shafts, corona, halo, baseOpacity };
}

export class BoostPadVfx {
	private readonly root = new THREE.Group();
	private readonly pads: PadMesh[] = [];
	private readonly pickupBursts: {
		mesh: THREE.Mesh;
		life: number;
		maxLife: number;
	}[] = [];
	/** Big-pad orb recharge (RL white→gold) — NIE na plate/face (to robiło białe dyski). */
	private readonly rechargeWhite = new THREE.Color(0xf4f7ff);
	private readonly rechargeGold = new THREE.Color(0xffc040);
	private readonly orbTintScratch = new THREE.Color();
	private readonly plateTintScratch = new THREE.Color();
	private readonly padAmber = new THREE.Color(0xff9a18);
	private readonly padAmberHot = new THREE.Color(0xffd060);
	private readonly padAmberDim = new THREE.Color(0x4a2e0c);

	constructor(scene: THREE.Scene) {
		this.root.name = "boostPads";
		scene.add(this.root);

		const amber = this.padAmber;
		const amberHot = this.padAmberHot;
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

			/** Lokalny glow na murawie — miękki, corona robi flary. */
			const glow = new THREE.Mesh(
				_discGeo,
				new THREE.MeshBasicMaterial({
					color: amberHot,
					transparent: true,
					opacity: spec.big ? 0.32 : 0.24,
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
					emissiveIntensity: 0.55,
					metalness: 0.7,
					roughness: 0.36,
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
					emissiveIntensity: 0.9,
					emissiveMap: padFaceMap(spec.big),
					metalness: 0.28,
					roughness: 0.38,
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
					emissiveIntensity: 1.05,
					metalness: 0.5,
					roughness: 0.26,
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
						emissiveIntensity: 1.55,
						metalness: 0.06,
						roughness: 0.18,
						transparent: true,
						opacity: 0.92,
						toneMapped: true,
					}),
				);
				orb.scale.setScalar(orbR);

				orbShade = new THREE.Mesh(
					_orbGeo,
					new THREE.MeshBasicMaterial({
						color: amberHot,
						transparent: true,
						opacity: 0.32,
						depthWrite: false,
						blending: THREE.AdditiveBlending,
						toneMapped: false,
						side: THREE.BackSide,
					}),
				);
				orbShade.scale.setScalar(orbR * 1.28);

				for (let i = 0; i < 3; i++) {
					const pivot = new THREE.Group();
					pivot.rotation.x = 0.55 + i * 0.48;
					pivot.rotation.z = i * ((Math.PI * 2) / 3) * 0.35;
					const torus = new THREE.Mesh(
						_torusGeo,
						new THREE.MeshBasicMaterial({
							color: amberHot,
							transparent: true,
							opacity: 0.7 - i * 0.1,
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

				/** Lekki fill na murawę — flary robią look, nie PointLight wash. */
				light = new THREE.PointLight(0xffb040, 0.55, 8.0, 2.1);
				light.castShadow = false;
				light.position.y = 0.15;
				orbRig.add(orbShade, orb, light);
			} else {
				light = new THREE.PointLight(0xffa028, 0.28, 4.2, 2.2);
				light.castShadow = false;
				light.position.y = plateTopY + 0.35;
				group.add(light);
			}

			const rays = buildPadRayRig(spec.big, padR, orbR, amberHot);
			if (spec.big) {
				/** Aura siedzi w środku orba — blask dookoła sfery. */
				orbRig.add(rays.rig);
			} else {
				rays.rig.position.y = plateTopY + 0.12;
				group.add(rays.rig);
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
				rayRig: rays.rig,
				shafts: rays.shafts,
				corona: rays.corona,
				halo: rays.halo,
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
				rayBaseOpacity: rays.baseOpacity,
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
			const coronaMat = pad.corona.material as THREE.MeshBasicMaterial;
			plateMat.emissive.copy(tint);
			faceMat.emissive.copy(tint);
			ringMat.emissive.copy(hot);
			glowMat.color.copy(hot);
			coronaMat.color.copy(hot);
			if (pad.halo) {
				(pad.halo.material as THREE.MeshBasicMaterial).color.copy(hot);
			}
			if (pad.light) pad.light.color.copy(hot);
			if (pad.orbShade) {
				(pad.orbShade.material as THREE.MeshBasicMaterial).color.copy(hot);
			}
			for (const r of pad.rings) {
				(r.material as THREE.MeshBasicMaterial).color.copy(hot);
			}
			for (const shaft of pad.shafts) {
				const sm = shaft.material as THREE.ShaderMaterial;
				(sm.uniforms.uColor!.value as THREE.Color).copy(hot);
			}
		}
	}

	triggerPickup(event: BoostPadPickupEvent): void {
		const slot = this.pickupBursts.find((b) => b.life <= 0);
		if (!slot) return;
		/** RL: krótki jasny flash — big pad głośniejszy, small pad tylko „tick”. */
		slot.life = event.big ? 0.42 : 0.24;
		slot.maxLife = slot.life;
		slot.mesh.position.set(
			event.position.x,
			event.big ? 1.55 : 0.45,
			event.position.z,
		);
		slot.mesh.scale.setScalar(event.big ? 0.92 : 0.32);
		slot.mesh.visible = true;
		(slot.mesh.material as THREE.MeshBasicMaterial).color.set(
			event.big ? 0xfff6d8 : 0xffe090,
		);
		(slot.mesh.material as THREE.MeshBasicMaterial).opacity = event.big
			? 0.72
			: 0.55;
	}

	update(
		dt: number,
		states: ReadonlyArray<{
			index: number;
			active: boolean;
			respawnRatio: number;
		}>,
		cameraPos?: THREE.Vector3,
	): void {
		for (const state of states) {
			const pad = this.pads[state.index];
			if (!pad) continue;
			/** Distance-based attenuation to avoid far-pad “overbloom”. */
			const camMul = cameraPos
				? THREE.MathUtils.clamp(
						1 / (1 + Math.hypot(
							cameraPos.x - pad.root.position.x,
							cameraPos.y - pad.root.position.y,
							cameraPos.z - pad.root.position.z,
						) / 95),
						0.45,
						1,
					)
				: 1;

			pad.pulse += dt * (pad.big ? 1.85 : 2.55);
			const wave = 0.5 + 0.5 * Math.sin(pad.pulse);
			const breathe = 0.94 + wave * 0.09;

			/** Strzałki na padzie — wolny spin + lekki pulse skali. */
			pad.spinGroup.rotation.y += dt * pad.spinSpeed;
			pad.spinGroup.scale.setScalar(0.97 + wave * 0.06);

			/** Aura — wolny spin wokół sfery. */
			pad.rayRig.rotation.y += dt * (pad.big ? 0.22 : 0.35);
			pad.rayRig.rotation.x = pad.big
				? Math.sin(pad.pulse * 0.35) * 0.12
				: 0;
			pad.corona.rotation.z -= dt * (pad.big ? 0.15 : 0.22);

			if (pad.orbRig) {
				pad.orbRig.position.y = pad.orbY + Math.sin(pad.pulse * 0.85) * 0.07;
				pad.orbRig.rotation.y += dt * 0.45;
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
			const coronaMat = pad.corona.material as THREE.MeshBasicMaterial;

			if (state.active) {
				/** Przywróć amber po recharge (wcześniej white emissive zostawał → biała podstawa). */
				plateMat.emissive.copy(this.padAmber);
				faceMat.emissive.copy(this.padAmber);
				ringMat.emissive.copy(this.padAmberHot);
				glowMat.color.copy(this.padAmberHot);
				coronaMat.color.copy(this.padAmberHot);
				if (pad.orb && pad.orbShade) {
					const orbMat = pad.orb.material as THREE.MeshStandardMaterial;
					const shadeMat = pad.orbShade.material as THREE.MeshBasicMaterial;
					orbMat.emissive.copy(this.padAmber);
					orbMat.color.copy(this.padAmberHot);
					shadeMat.color.copy(this.padAmberHot);
					pad.orb.scale.setScalar(pad.orbR * breathe);
					pad.orbShade.scale.setScalar(pad.orbR * 1.28 * breathe);
					orbMat.emissiveIntensity = (1.35 + wave * 0.5) * camMul;
					shadeMat.opacity = (0.24 + wave * 0.14) * camMul;
					for (let i = 0; i < pad.rings.length; i++) {
						const r = pad.rings[i]!;
						const rm = r.material as THREE.MeshBasicMaterial;
						r.scale.setScalar(
							pad.orbR * (1.22 + i * 0.1) * (0.96 + wave * 0.08),
						);
						rm.opacity = (0.5 + wave * 0.25 - i * 0.08) * camMul;
						rm.color.copy(this.padAmberHot);
					}
				}
				pad.ring.scale.setScalar(pad.padR * (0.97 + wave * 0.08));
				pad.glow.scale.setScalar(
					pad.padR * (pad.big ? 1.5 : 1.35) * (0.92 + wave * 0.16),
				);
				const burstR = pad.big
					? pad.orbR * 3.5 * (0.94 + wave * 0.1)
					: pad.padR * 2.2 * (0.94 + wave * 0.1);
				pad.corona.scale.setScalar(burstR);
				if (pad.halo) {
					pad.halo.scale.setScalar(pad.orbR * 2.35 * (0.96 + wave * 0.1));
					(pad.halo.material as THREE.MeshBasicMaterial).opacity =
						0.16 + wave * 0.12;
					(pad.halo.material as THREE.MeshBasicMaterial).color.copy(
						this.padAmberHot,
					);
				}
				plateMat.emissiveIntensity = (0.32 + wave * 0.18) * camMul;
				faceMat.emissiveIntensity = (0.55 + wave * 0.28) * camMul;
				ringMat.emissiveIntensity = (0.72 + wave * 0.32) * camMul;
				glowMat.opacity = ((pad.big ? 0.16 : 0.1) + wave * 0.08) * camMul;
				coronaMat.opacity = ((pad.big ? 0.36 : 0.4) + wave * 0.16) * camMul;
				shadowMat.opacity = (pad.big ? 0.22 : 0.14) * camMul;
				for (let i = 0; i < pad.shafts.length; i++) {
					const shaft = pad.shafts[i]!;
					const sm = shaft.material as THREE.ShaderMaterial;
					const mul = 0.55 + (i % 4) * 0.1;
					sm.uniforms.uOpacity!.value =
						pad.rayBaseOpacity * mul * (0.75 + wave * 0.4) * camMul;
					(sm.uniforms.uColor!.value as THREE.Color).copy(this.padAmberHot);
					shaft.visible = true;
				}
				pad.rayRig.visible = true;
				if (pad.light) {
					pad.light.color.copy(this.padAmberHot);
					pad.light.intensity = pad.big
						? (0.7 + wave * 0.35) * camMul
						: (0.35 + wave * 0.2) * camMul;
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
				/**
				 * Orb: white→gold (RL). Plate/face: ciemny amber→gold — nigdy białe dyski na murawie.
				 */
				const orbTint = pad.big
					? this.orbTintScratch
							.copy(this.rechargeWhite)
							.lerp(this.rechargeGold, t)
					: null;
				const plateTint = this.plateTintScratch
					.copy(this.padAmberDim)
					.lerp(this.rechargeGold, THREE.MathUtils.smoothstep(t, 0.15, 1));
				pad.spinGroup.scale.setScalar(s);
				if (pad.orb && pad.orbShade && pad.orbRig) {
					const orbMat = pad.orb.material as THREE.MeshStandardMaterial;
					const shadeMat = pad.orbShade.material as THREE.MeshBasicMaterial;
					pad.orb.scale.setScalar(pad.orbR * s);
					pad.orbShade.scale.setScalar(pad.orbR * 1.28 * s);
					orbMat.emissiveIntensity = t * 1.4 * camMul;
					shadeMat.opacity = t * 0.28 * camMul;
					if (orbTint) {
						orbMat.emissive.copy(orbTint);
						shadeMat.color.copy(orbTint);
					}
					pad.orbRig.visible = t > 0.1;
					for (let i = 0; i < pad.rings.length; i++) {
						const r = pad.rings[i]!;
						r.scale.setScalar(pad.orbR * (1.22 + i * 0.1) * s);
						const rm = r.material as THREE.MeshBasicMaterial;
						rm.opacity = t * (0.65 - i * 0.1) * camMul;
						if (orbTint) rm.color.copy(orbTint);
					}
				}
				pad.ring.scale.setScalar(pad.padR * s);
				pad.glow.scale.setScalar(pad.padR * 1.3 * t);
				pad.corona.scale.setScalar(
					pad.big ? pad.orbR * 3.4 * t : pad.padR * 2.1 * t,
				);
				if (pad.halo) {
					pad.halo.scale.setScalar(pad.orbR * 2.2 * t);
					(pad.halo.material as THREE.MeshBasicMaterial).opacity = t * 0.2;
					if (orbTint) {
						(pad.halo.material as THREE.MeshBasicMaterial).color.copy(orbTint);
					}
				}
				plateMat.emissive.copy(plateTint);
				faceMat.emissive.copy(plateTint);
				ringMat.emissive.copy(plateTint);
				glowMat.color.copy(plateTint);
				coronaMat.color.copy(plateTint);
				plateMat.emissiveIntensity = t * 0.45 * camMul;
				faceMat.emissiveIntensity = t * 0.8 * camMul;
				ringMat.emissiveIntensity = t * 1.05 * camMul;
				glowMat.opacity = t * (pad.big ? 0.24 : 0.16) * camMul;
				coronaMat.opacity = t * (pad.big ? 0.4 : 0.36) * camMul;
				shadowMat.opacity = (0.05 + t * 0.14) * camMul;
				for (const shaft of pad.shafts) {
					const sm = shaft.material as THREE.ShaderMaterial;
					sm.uniforms.uOpacity!.value =
						pad.rayBaseOpacity * t * 0.9 * camMul;
					(sm.uniforms.uColor!.value as THREE.Color).copy(plateTint);
					shaft.visible = t > 0.15;
				}
				pad.rayRig.visible = t > 0.12;
				if (pad.light) {
					pad.light.color.copy(plateTint);
					pad.light.intensity = t * (pad.big ? 0.8 : 0.4) * camMul;
					pad.light.visible = t > 0.2;
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
			for (const shaft of pad.shafts) {
				(shaft.material as THREE.Material).dispose();
			}
			(pad.corona.material as THREE.Material).dispose();
			if (pad.halo) (pad.halo.material as THREE.Material).dispose();
			(pad.plate.material as THREE.Material).dispose();
			(pad.face.material as THREE.Material).dispose();
			(pad.ring.material as THREE.Material).dispose();
			(pad.glow.material as THREE.Material).dispose();
			(pad.shadow.material as THREE.Material).dispose();
			if (pad.light) {
				pad.light.removeFromParent();
				pad.light.dispose();
			}
		}
		for (const burst of this.pickupBursts) {
			(burst.mesh.material as THREE.Material).dispose();
			burst.mesh.geometry.dispose();
		}
		this.root.removeFromParent();
	}
}
