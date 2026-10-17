import * as THREE from "three";
import type { ScoringTeam } from "../game/modes";
import type { PowerUpHudState } from "../modes/IgnitionManager";
import type Player from "../util/Player";
import { loadCarModel as loadCarGlb } from "./CarModel";
import { reconcileMountedCosmeticWheels } from "./cosmeticGlb";
import { refreshBodyWheelWellMaskIfMounted } from "./bodyWheelWellMask";
import { applyAllCarCosmetics, getEquippedCarLoadout, type CarCosmeticLoadout } from "./carCosmetics";
import { applyPaintToCar } from "./applyPaintCosmetic";
import { getEquippedPaintId } from "../meta/PlayerInventory";
import { carIsLicensedPreview } from "../meta/CarCatalog";
import { CarNameTag } from "./CarNameTag";
import { CarContactShadow } from "./carContactShadow";
import { mountCarNeonUnderglow } from "./carNeonUnderglow";
import { fitCarVisualToHitbox } from "./CarGrounding";
import {
	applyCarWheelMotion,
	type CarWheelNode,
	resolveCarWheels,
} from "./carWheelController";
import {
	purgeStrayWheelMeshesFromCar,
	suppressStockWheelVisuals,
} from "./wheelMount";
import { AirRollVfx } from "./vfx/airRollVfx";
import { BoostExhaustVfx } from "./vfx/boostExhaustVfx";
import { BoostTrail } from "./vfx/boostTrail";
import { syncTireRubberWetness } from "./materials/tireRubberMaterial";
import { CarAfterimageVfx } from "./vfx/carAfterimageVfx";
import { CarStreakVfx } from "./vfx/carStreakVfx";
import { DodgeFlipVfx } from "./vfx/dodgeFlipVfx";
import { FreestyleTrailVfx } from "./vfx/freestyleTrailVfx";
import { GrassWearVfx } from "./vfx/grassWearVfx";
import { LandingPuffVfx } from "./vfx/landingPuffVfx";
import { PowerUpCarVfx } from "./vfx/powerUpCarVfx";
import { SkidMarksVfx } from "./vfx/skidMarksVfx";
import { SupersonicShockwave } from "./vfx/supersonicShockwave";
import { WallRideSparksVfx } from "./vfx/wallRideSparksVfx";
import { createHeadlightBeamMaterial } from "./volumetricBeam";

/** Po kosmetykach / neonie / clone — dno opony na linii hitboxa. */
export function realignCarVisualToHitbox(root: THREE.Object3D): void {
	fitCarVisualToHitbox(root);
}

const HEADLIGHT_COLOR = 0xffffff;
/** Niżej + finite distance — bez białej plamy na murawie (distance 0 = ∞). */
const HEADLIGHT_INTENSITY = 1.25;
const HEADLIGHT_DISTANCE = 18;
const HEADLIGHT_ANGLE = Math.PI / 5.5;
const HEADLIGHT_PENUMBRA = 0.86;
const HEADLIGHT_AIM_DISTANCE = 18;
const HEADLIGHT_BOOST_MUL = 1.22;
const BEAM_LENGTH = HEADLIGHT_AIM_DISTANCE;
const _headlightWorld = new THREE.Vector3();

export { CAR_VISUAL_SCALE } from "./octaneCarMesh";

/** car.glb (Khronos CarConcept) — chrome + cyan underglow. */
export async function buildCarMesh(
	carId: string,
	team: "blue" | "orange" = "blue",
	/** `undefined` = blue bierze equipped paint, orange zostaje tint drużyny. */
	paintId?: string | null,
	loadout?: CarCosmeticLoadout,
	opts?: { showcase?: boolean },
): Promise<THREE.Group> {
	const car = await loadCarGlb(carId, team, { showcase: opts?.showcase === true });
	/** Licensed preview: stock GLB only — paint/wheels Octane rozrywają model. */
	if (carIsLicensedPreview(carId) || car.userData.licensedPreview) {
		mountCarNeonUnderglow(car);
		realignCarVisualToHitbox(car);
		return car;
	}
	const paint =
		paintId !== undefined
			? paintId
			: team === "blue"
				? getEquippedPaintId("car")
				: null;
	if (paint) applyPaintToCar(car, paint, team);
	mountCarNeonUnderglow(car);
	const cosmeticLoadout =
		loadout ??
		({
			...getEquippedCarLoadout(carId),
			paint: { ...getEquippedCarLoadout(carId).paint, car: paint },
		} satisfies CarCosmeticLoadout);
	await applyAllCarCosmetics(car, cosmeticLoadout, carId);
	realignCarVisualToHitbox(car);
	return car;
}

export async function loadCarModel(
	carId: string,
	team: "blue" | "orange" = "blue",
	paintId?: string | null,
	loadout?: CarCosmeticLoadout,
	opts?: { showcase?: boolean },
): Promise<THREE.Group> {
	return buildCarMesh(carId, team, paintId, loadout, opts);
}

/** Głęboki klon — osobne materiały; geometria klonowana tylko dla lekkich body. */
export function cloneCarMesh(source: THREE.Group): THREE.Group {
	const licensed =
		source.userData?.licensedPreview === true ||
		carIsLicensedPreview(
			typeof source.userData?.carId === "string" ? source.userData.carId : null,
		);
	const root = source.clone(true);
	root.traverse((node) => {
		if (node instanceof THREE.Mesh) {
			node.frustumCulled = false;
			/**
			 * Licensed = 150–317 meshów. geometry.clone() = multi-second FREEZE
			 * na starcie meczu. Template dispose NIE zwalnia geo (domyślnie).
			 */
			if (!licensed && node.geometry) node.geometry = node.geometry.clone();
			if (Array.isArray(node.material)) {
				node.material = node.material.map((m) => resetHubMaskOnClone(m.clone()));
			} else if (node.material) {
				node.material = resetHubMaskOnClone(node.material.clone());
			}
		}
	});
	reconcileMountedCosmeticWheels(root);
	/**
	 * Tylko gdy są felgi kosmetyczne — inaczej stock Octane traci koła
	 * (purge kasuje huby `wheel_*`, suppress je ukrywa).
	 */
	if (root.getObjectByName("cosmetic_rim_wheel_FL")) {
		suppressStockWheelVisuals(root);
		purgeStrayWheelMeshesFromCar(root);
	}
	refreshBodyWheelWellMaskIfMounted(root);
	fitCarVisualToHitbox(root);
	return root;
}

/** userData.hubMaskState jest płytko współdzielone po Material.clone — reset albo maska zjada body. */
function resetHubMaskOnClone(mat: THREE.Material): THREE.Material {
	if (mat.userData.hubMaskState) {
		delete mat.userData.hubMaskState;
	}
	return mat;
}

/**
 * Zwalnia zasoby auta.
 * Geometria domyślnie NIE — `Object3D.clone` / cache GLB współdzielą BufferGeometry;
 * dispose po `cloneCarMesh` bez klonowania geo zabija hero i wywala Electron GPU.
 */
export function disposeCarMeshGroup(
	root: THREE.Group,
	options?: { disposeMaterials?: boolean; disposeGeometry?: boolean },
): void {
	const disposeMaterials = options?.disposeMaterials ?? false;
	const disposeGeometry = options?.disposeGeometry ?? false;
	root.traverse((node) => {
		if (node instanceof THREE.Mesh) {
			if (disposeGeometry) node.geometry?.dispose();
			if (!disposeMaterials) return;
			const mats = Array.isArray(node.material)
				? node.material
				: [node.material];
			for (const mat of mats) {
				mat?.dispose();
			}
		}
	});
}

function createHeadlight(): THREE.SpotLight {
	const light = new THREE.SpotLight(
		HEADLIGHT_COLOR,
		HEADLIGHT_INTENSITY,
		HEADLIGHT_DISTANCE,
		HEADLIGHT_ANGLE,
		HEADLIGHT_PENUMBRA,
		1,
	);
	light.castShadow = false;
	light.decay = 1;
	return light;
}

export class CarVisuals {
	private readonly physicsRoot: THREE.Object3D;
	private readonly visualRoot: THREE.Object3D;
	private readonly scene: THREE.Scene;
	private readonly boostTrail: BoostTrail;
	private readonly boostExhaust: BoostExhaustVfx;
	private readonly supersonicShockwave: SupersonicShockwave;
	private readonly landingPuff: LandingPuffVfx;
	private readonly carStreak: CarStreakVfx;
	private readonly wallSparks: WallRideSparksVfx;
	private readonly skidMarks: SkidMarksVfx;
	private readonly dodgeFlip: DodgeFlipVfx;
	private readonly afterimage: CarAfterimageVfx;
	private readonly freestyleTrail: FreestyleTrailVfx;
	private readonly airRoll: AirRollVfx;
	private readonly grassWear: GrassWearVfx;
	private readonly powerUpVfx: PowerUpCarVfx;
	private readonly nameTag: CarNameTag | null;
	private readonly contactShadow: CarContactShadow;
	private readonly leftLight: THREE.SpotLight;
	private readonly rightLight: THREE.SpotLight;
	private readonly leftBeam: THREE.Mesh;
	private readonly rightBeam: THREE.Mesh;
	private readonly wheelSpinByName = new Map<string, number>();
	private carWheels: CarWheelNode[] | null = null;
	private demolishFlashLife = 0;
	private demolishFlashK = 0;
	private readonly demolishMeshes: THREE.Mesh[] = [];
	private readonly demolishEmissiveBackup = new Map<
		THREE.MeshStandardMaterial,
		{ color: THREE.Color; intensity: number }
	>();
	private paintMats: THREE.MeshStandardMaterial[] | null = null;
	private lastPaintBoost = false;
	private wasFlipping = false;
	private antennaBob: THREE.Object3D | null = null;
	private readonly _flipAxis = new THREE.Vector3();
	private readonly _tmpQuat = new THREE.Quaternion();
	private antennaPhase = Math.random() * Math.PI * 2;

	constructor(
		physicsRoot: THREE.Object3D,
		visualRoot: THREE.Object3D,
		scene: THREE.Scene,
		team: ScoringTeam,
		displayName: string,
		isHuman: boolean,
	) {
		this.physicsRoot = physicsRoot;
		this.visualRoot = visualRoot;
		this.scene = scene;

		this.leftLight = createHeadlight();
		this.rightLight = createHeadlight();

		this.visualRoot.add(this.leftLight);
		this.visualRoot.add(this.rightLight);
		this.visualRoot.add(this.leftLight.target);
		this.visualRoot.add(this.rightLight.target);

		const beamGeo = new THREE.CylinderGeometry(
			0.12,
			3.2,
			BEAM_LENGTH,
			10,
			1,
			true,
		);
		const beamMat = createHeadlightBeamMaterial(0xe8f8ff);
		this.leftBeam = new THREE.Mesh(beamGeo, beamMat);
		this.leftBeam.name = "headlightBeam_L";
		this.rightBeam = new THREE.Mesh(beamGeo.clone(), beamMat.clone());
		this.rightBeam.name = "headlightBeam_R";
		for (const beam of [this.leftBeam, this.rightBeam]) {
			beam.rotation.x = Math.PI / 2;
			beam.position.z = BEAM_LENGTH * 0.5;
			beam.renderOrder = 6;
			beam.frustumCulled = false;
			beam.visible = false;
			this.visualRoot.add(beam);
		}

		this.boostTrail = new BoostTrail(scene);
		this.boostExhaust = new BoostExhaustVfx(visualRoot, scene, team);
		this.supersonicShockwave = new SupersonicShockwave(scene);
		this.landingPuff = new LandingPuffVfx(scene, team);
		this.carStreak = new CarStreakVfx(visualRoot, team);
		this.wallSparks = new WallRideSparksVfx(scene);
		this.skidMarks = new SkidMarksVfx(scene);
		this.dodgeFlip = new DodgeFlipVfx(scene);
		this.afterimage = new CarAfterimageVfx(scene);
		this.freestyleTrail = new FreestyleTrailVfx(scene);
		this.airRoll = new AirRollVfx(visualRoot);
		this.grassWear = new GrassWearVfx(scene);
		this.powerUpVfx = new PowerUpCarVfx(visualRoot, scene);
		/** Lokalny gracz — bez plakietki YOU (i tak wiesz, którym jedziesz). */
		this.nameTag = isHuman
			? null
			: new CarNameTag(scene, displayName, team, false);
		this.contactShadow = new CarContactShadow(1.25);
		this.scene.add(this.contactShadow.mesh);
	}

	setGoalStreak(streak: number): void {
		this.carStreak.setStreak(streak);
	}

	setPodiumTitle(title: string | null): void {
		this.nameTag?.setPodiumTitle(title);
	}

	burstSupersonic(worldPos: THREE.Vector3): void {
		this.supersonicShockwave.trigger(worldPos);
	}

	triggerLanding(worldPos: THREE.Vector3, intensity: number): void {
		this.landingPuff.trigger(worldPos, intensity);
	}

	/** Biały emissive flash przy demolish — bez PointLight. */
	triggerDemolishFlash(intensity: number): void {
		this.demolishFlashLife = 0.16;
		this.demolishFlashK = THREE.MathUtils.clamp(intensity / 16, 0.45, 1.35);
		if (this.demolishMeshes.length === 0) {
			this.visualRoot.traverse((node) => {
				if (!(node instanceof THREE.Mesh)) return;
				const mats = Array.isArray(node.material)
					? node.material
					: [node.material];
				for (const mat of mats) {
					if (mat instanceof THREE.MeshStandardMaterial) {
						this.demolishMeshes.push(node);
						if (!this.demolishEmissiveBackup.has(mat)) {
							this.demolishEmissiveBackup.set(mat, {
								color: mat.emissive.clone(),
								intensity: mat.emissiveIntensity,
							});
						}
					}
				}
			});
		}
	}

	private updateDemolishFlash(dt: number): void {
		if (this.demolishFlashLife <= 0) return;
		this.demolishFlashLife = Math.max(0, this.demolishFlashLife - dt);
		const t = this.demolishFlashLife / 0.16;
		const burst = this.demolishFlashK * t * t;
		for (const mesh of this.demolishMeshes) {
			const mats = Array.isArray(mesh.material)
				? mesh.material
				: [mesh.material];
			for (const mat of mats) {
				if (!(mat instanceof THREE.MeshStandardMaterial)) continue;
				const base = this.demolishEmissiveBackup.get(mat);
				if (!base) continue;
				mat.emissive.setRGB(
					base.color.r + burst * (1 - base.color.r),
					base.color.g + burst * (0.95 - base.color.g),
					base.color.b + burst * (0.7 - base.color.b),
				);
				mat.emissiveIntensity = base.intensity + burst * 4.2;
			}
		}
		if (this.demolishFlashLife <= 0) {
			for (const [mat, base] of this.demolishEmissiveBackup) {
				mat.emissive.copy(base.color);
				mat.emissiveIntensity = base.intensity;
			}
		}
	}

	private syncLightFromSocket(
		light: THREE.SpotLight,
		beam: THREE.Mesh,
		socketName: string,
		defaultX: number,
	): void {
		const socket = this.visualRoot.getObjectByName(socketName);
		if (socket) {
			socket.getWorldPosition(_headlightWorld);
			this.visualRoot.worldToLocal(_headlightWorld);
			light.position.copy(_headlightWorld);
		} else {
			_headlightWorld.set(defaultX, 0.27, 0.6);
			light.position.copy(_headlightWorld);
		}

		/** Cel w lokalnym +Z visualRoot (= fizyczny przód), nie w układzie child mesh. */
		light.target.position.set(
			light.position.x,
			light.position.y,
			light.position.z + HEADLIGHT_AIM_DISTANCE,
		);
		/** Cylinder wzdłuż +Z: środek belki = socket + half length. */
		beam.position.set(
			light.position.x,
			light.position.y,
			light.position.z + BEAM_LENGTH * 0.5,
		);
	}

	private updateHeadlights(): void {
		this.physicsRoot.updateMatrixWorld(true);

		this.syncLightFromSocket(
			this.leftLight,
			this.leftBeam,
			"headlight_L",
			-0.3,
		);
		this.syncLightFromSocket(
			this.rightLight,
			this.rightBeam,
			"headlight_R",
			0.3,
		);
	}

	private updateWheels(speed: number, steer: number, dt: number): void {
		const hasRim =
			this.visualRoot.getObjectByName("cosmetic_rim_wheel_FL") != null;
		const cachedRim = this.carWheels?.[0]?.rim != null;
		if (
			!this.carWheels ||
			this.carWheels.length === 0 ||
			hasRim !== cachedRim
		) {
			this.carWheels = resolveCarWheels(this.visualRoot);
		}
		if (this.carWheels.length === 0) return;

		const spinDelta = (speed / 0.125) * dt;
		const steerY = THREE.MathUtils.clamp(steer, -1, 1) * 0.38;
		let spin = this.wheelSpinByName.get("_total") ?? 0;
		spin += spinDelta;
		this.wheelSpinByName.set("_total", spin);
		applyCarWheelMotion(this.carWheels, spin, steerY);
	}

	update(
		player: Player,
		boosting: boolean,
		dt: number,
		camera?: THREE.Camera,
	): void {
		this.updateHeadlights();

		const speed = player.getVelocity().length();
		const av = player.rapierRigidBody.angvel();
		const angSpin =
			Math.hypot(av.x, av.y, av.z) * (player.isFlipping() ? 0.14 : 0.06);
		this.updateWheels(speed + angSpin, player.getSteerInput(), dt);
		syncTireRubberWetness(this.visualRoot);

		const fuel = player.getBoostFuel();
		const active = boosting && fuel > 0;
		this.boostTrail.update(player, active, dt, camera);
		this.boostExhaust.update(player, active, dt, camera);
		this.supersonicShockwave.update(dt);
		this.landingPuff.update(dt);
		this.updateDemolishFlash(dt);
		this.carStreak.update(dt);
		this.wallSparks.update(dt);
		this.dodgeFlip.update(dt);
		this.skidMarks.update(dt);
		this.grassWear.update(dt);
		if (player.isOnWallOrRamp() && speed > 7) {
			this.wallSparks.emit(
				player.getPosition(),
				speed,
				dt,
				player.getSurfaceNormal(),
				player.getVelocity(),
			);
		}

		const worldPos = player.getPosition();
		const onGround = player.isOnGround();
		const flipping = player.isFlipping();
		if (flipping && !this.wasFlipping) {
			const av = player.rapierRigidBody.angvel();
			this._flipAxis.set(av.x, av.y, av.z);
			if (this._flipAxis.lengthSq() < 1e-4) {
				this._flipAxis.copy(player.getSideward());
			}
			this.dodgeFlip.trigger(worldPos, this._flipAxis);
		}
		this.wasFlipping = flipping;

		this.skidMarks.emit(
			worldPos,
			player.getForward(),
			player.getDriftBlend(),
			speed,
			dt,
			onGround,
		);
		this.grassWear.emit(worldPos, speed, onGround, dt, player.getDriftBlend());

		this._tmpQuat.copy(player.rapierRigidBody.rotation() as THREE.Quaternion);
		this.afterimage.updateFromCar(
			worldPos,
			this._tmpQuat,
			speed,
			active,
			dt,
			player.getVelocity(),
			camera,
		);
		this.freestyleTrail.update(
			worldPos,
			player.getSideward(),
			!onGround,
			active,
			speed,
			dt,
			player.getRollInput(),
			camera,
		);
		this.airRoll.update(player.getRollInput(), !onGround, dt);
		this.updateAntennaBob(speed, dt);

		const headIntensity = active
			? HEADLIGHT_INTENSITY * HEADLIGHT_BOOST_MUL
			: HEADLIGHT_INTENSITY;
		this.leftLight.intensity = headIntensity;
		this.rightLight.intensity = headIntensity;

		if (active !== this.lastPaintBoost) {
			this.lastPaintBoost = active;
			if (!this.paintMats) {
				this.paintMats = [];
				this.visualRoot.traverse((obj) => {
					if (!(obj instanceof THREE.Mesh)) return;
					const mats = Array.isArray(obj.material)
						? obj.material
						: [obj.material];
					for (const mat of mats) {
						if (
							mat instanceof THREE.MeshStandardMaterial ||
							mat instanceof THREE.MeshPhysicalMaterial
						) {
							mat.userData.igniteEnvBase = mat.envMapIntensity;
							this.paintMats!.push(mat);
						}
					}
				});
			}
			const punch = active ? 1.28 : 1;
			for (const mat of this.paintMats) {
				const base = (mat.userData.igniteEnvBase as number) ?? 1;
				mat.envMapIntensity = base * punch;
			}
		}

		const beamOpacity = active ? 0.1 : 0.025;
		const beamScale = active ? 1 : 0.85;
		(this.leftBeam.material as THREE.ShaderMaterial).uniforms.uOpacity.value =
			beamOpacity;
		(this.rightBeam.material as THREE.ShaderMaterial).uniforms.uOpacity.value =
			beamOpacity;
		this.leftBeam.scale.set(beamScale, beamScale, beamScale);
		this.rightBeam.scale.set(beamScale, beamScale, beamScale);
		this.leftBeam.visible = true;
		this.rightBeam.visible = true;

		if (camera) {
			this.nameTag?.sync(this.visualRoot, camera);
		}

		this.contactShadow.update(worldPos, onGround);
	}

	private updateAntennaBob(speed: number, dt: number): void {
		if (!this.antennaBob || !this.antennaBob.parent) {
			this.antennaBob =
				this.visualRoot.getObjectByName("antenna_bob_root") ?? null;
			if (!this.antennaBob) return;
		}
		this.antennaPhase += dt * (3.2 + Math.min(4, speed * 0.12));
		const lean = Math.min(0.22, speed * 0.008);
		this.antennaBob.rotation.z = Math.sin(this.antennaPhase) * (0.1 + lean);
		this.antennaBob.rotation.x = Math.cos(this.antennaPhase * 0.7) * 0.06;
	}

	updatePowerUp(
		state: PowerUpHudState | null,
		ballPos: THREE.Vector3 | null,
		dt: number,
	): void {
		this.powerUpVfx.update(
			state,
			this.physicsRoot.getWorldPosition(_powerUpWorldPos),
			ballPos,
			dt,
		);
	}

	dispose(): void {
		this.scene.remove(this.boostTrail.root);
		this.boostExhaust.dispose();
		this.supersonicShockwave.dispose();
		this.landingPuff.dispose();
		this.carStreak.dispose();
		this.wallSparks.dispose();
		this.skidMarks.dispose();
		this.dodgeFlip.dispose();
		this.afterimage.dispose();
		this.freestyleTrail.dispose();
		this.airRoll.dispose();
		this.grassWear.dispose();
		this.powerUpVfx.dispose();
		this.nameTag?.dispose();
		this.contactShadow.dispose();
		this.visualRoot.remove(this.leftLight);
		this.visualRoot.remove(this.rightLight);
		this.visualRoot.remove(this.leftLight.target);
		this.visualRoot.remove(this.rightLight.target);
		this.leftLight.dispose();
		this.rightLight.dispose();
		this.leftBeam.geometry.dispose();
		this.rightBeam.geometry.dispose();
		(this.leftBeam.material as THREE.Material).dispose();
		(this.rightBeam.material as THREE.Material).dispose();
		let streakGeoDisposed = false;
		for (const p of this.boostTrail.root.children) {
			if (p instanceof THREE.Sprite) {
				p.material.dispose();
			} else if (p instanceof THREE.Mesh) {
				(p.material as THREE.Material).dispose();
				if (!streakGeoDisposed) {
					p.geometry.dispose();
					streakGeoDisposed = true;
				}
			}
		}
	}
}

const _powerUpWorldPos = new THREE.Vector3();
