import * as THREE from "three";
import {
	getEquippedCarId,
	PlayerInventory,
} from "../meta/PlayerInventory";
import type Renderer from "../Renderer";
import type Scene from "../Scene";
import {
	setSkyDronesEnabled,
	updateCyberpunkAmbience,
} from "../visual/arena";
import { resolveShowcasePivotYStable } from "../visual/carWheelGround";
import {
	cloneCarMesh,
	disposeCarMeshGroup,
	loadCarModel,
} from "../visual/carVisuals";
import {
	getEquippedCarLoadout,
	type CarCosmeticLoadout,
} from "../visual/carCosmetics";
import { showcaseDof } from "../visual/garagePresentationPolicy";
import {
	GARAGE_HERO_X,
	MenuCinematicCamera,
} from "../visual/menuCinematicCamera";
import {
	disableShowcaseShadowReceiving,
	hideShowcaseGhostMeshes,
	logShowcaseSceneAudit,
	restoreShowcaseEnvironment,
	type ShowcaseEnvironmentSnapshot,
} from "../visual/showcaseSceneAudit";
import {
	applyBodyWheelWellMaskForEmptyHubs,
	refreshBodyWheelWellMaskIfMounted,
} from "../visual/bodyWheelWellMask";
import { carUsesEmptyWheelWells } from "../meta/CarCatalog";
import { sanitizeCarVisuals } from "../visual/sanitizeCar";
import { CarContactShadow } from "../visual/carContactShadow";
import { MenuDustParticles } from "../visual/menuDustParticles";
import { setNeonWallMenuCalm } from "../visual/neonWallMaterial";
import { setStadiumAtmosphereVisible } from "../visual/stadiumAtmosphere";
import { setStadiumShowcaseLighting } from "../visual/stadiumLighting";

/** Auto na środku boiska — widoczne podczas orbity kamery. */
const HERO_SCALE = 2.05;
const GARAGE_HERO_SCALE = 2.45;
const HERO_YAW = Math.PI * 0.25;
/** @deprecated blend wyłączony — snap kamery; zostaje dla probe hide(). */
export const GARAGE_UI_BLEND_THRESHOLD = 0.995;
/** Statyczny kadr po wejściu zanim ruszy obrót auta. */
export const GARAGE_SPIN_HOLD_SEC = 0.85;
/** Wolny start obrotu po holdzie. */
export const GARAGE_SPIN_RAMP_SEC = 1.4;
/** Klatki compositora przed/po DOM garażu. */
export const GARAGE_COMPOSITOR_WARM_FRAMES = 6;
/** Klatki po snap kamery — bez ruchu, zanim pokażemy UI. */
export const GARAGE_TRANSITION_SETTLE_FRAMES = 4;

function disposeObject3D(root: THREE.Object3D): void {
	root.traverse((node) => {
		if (node instanceof THREE.Mesh) {
			/**
			 * NIE dispose geometry — cloneCarMesh klonuje geo, ale stare ścieżki
			 * / shared refs potrafią wskazać na cache GLB; dispose zabija następne auta.
			 */
			const mats = Array.isArray(node.material)
				? node.material
				: [node.material];
			for (const mat of mats) {
				mat?.dispose();
			}
		}
	});
}

/** Tło menu — arena + auto (bez interaktywnych hologramów). */
export class LiveMainMenuScene {
	private readonly root = new THREE.Group();
	private readonly scene: Scene;
	private readonly renderer: Renderer;
	private readonly menuCamera = new MenuCinematicCamera();
	private heroCar: THREE.Group | null = null;
	private heroReloadGen = 0;
	private idlePhase = 0;
	private equipSpin = 0;
	private showcaseSettleSec = 2.25;
	private garageMode = false;
	private garageMotionRamp = 1;
	private garageIntroSec = 0;
	private wasGarageTransitioning = false;
	private heroScale = HERO_SCALE;
	private lastPivotScale = -1;
	private readonly emissiveMats: THREE.MeshStandardMaterial[] = [];
	private dust: MenuDustParticles | null = null;
	private contactShadow: CarContactShadow | null = null;
	private readonly menuFocusScratch = new THREE.Vector3();
	private envSnap: ShowcaseEnvironmentSnapshot | null = null;

	constructor(scene: Scene, renderer: Renderer) {
		this.scene = scene;
		this.renderer = renderer;
		this.root.name = "menuShowcase";
	}

	private setupCarEmissive(mesh: THREE.Object3D): void {
		this.emissiveMats.length = 0;
		mesh.traverse((node) => {
			if (node instanceof THREE.Light) {
				node.visible = false;
				node.intensity = 0;
				return;
			}
			if (node instanceof THREE.Sprite) {
				if (!this.garageMode) node.visible = false;
				return;
			}
			if (!(node instanceof THREE.Mesh)) return;
			node.castShadow = false;
			node.receiveShadow = true;

			const srcMats = Array.isArray(node.material)
				? node.material
				: [node.material];
			const allAdditive =
				!this.garageMode &&
				srcMats.length > 0 &&
				srcMats.every(
					(m) =>
						!!m &&
						(m as THREE.Material).blending === THREE.AdditiveBlending,
				);
			if (allAdditive) {
				node.visible = false;
			}
			const isWheelMat =
				node.name.startsWith("wheel") ||
				node.name.includes("cosmetic_rim") ||
				(node.parent?.name?.startsWith("cosmetic_rim_") ?? false) ||
				(node.parent?.name?.startsWith("wheel_") ?? false);
			const next = srcMats.map((mat) => {
				if (!mat) return mat;
				if (
					!this.garageMode &&
					(mat as THREE.Material).blending === THREE.AdditiveBlending
				) {
					const clone = mat.clone();
					if ("opacity" in clone) {
						(clone as THREE.Material & { opacity: number }).opacity = 0;
						(clone as THREE.Material).transparent = true;
					}
					return clone;
				}
				if (!(mat instanceof THREE.MeshStandardMaterial)) return mat;
				const clone = mat.clone();
				/** Material.clone współdzieli userData.hubMaskState — bez resetu maska nie instaluje się na klonie. */
				if (clone.userData.hubMaskState) {
					delete clone.userData.hubMaskState;
				}
				if (isWheelMat) {
					/** Felgi — nie zjadaj map, przyciemnij żeby nie były białymi klocami. */
					clone.metalness = Math.min(clone.metalness, 0.45);
					clone.roughness = Math.max(clone.roughness, 0.35);
					clone.envMapIntensity = Math.min(clone.envMapIntensity || 1, 0.9);
					if (!clone.map) clone.color.multiplyScalar(0.55);
					clone.emissiveIntensity = Math.min(clone.emissiveIntensity, 0.05);
					clone.userData.menuEmissiveBase = clone.emissiveIntensity;
					this.emissiveMats.push(clone);
					return clone;
				}
				/**
				 * Showcase body: nie miażdż lakieru — nocny env + clamp = znowu czerń.
				 */
				if (node.name === "body") {
					clone.metalnessMap = null;
					clone.metalness = Math.min(clone.metalness, 0.08);
					clone.roughness = Math.max(clone.roughness, 0.42);
					clone.envMapIntensity = Math.max(clone.envMapIntensity || 1, 1.15);
					clone.emissiveIntensity = Math.max(clone.emissiveIntensity, 0.2);
					clone.fog = false;
					clone.toneMapped = false;
					/** Zachowaj lifted albedo — nie wracaj do czarnej mapy / solid-only. */
					if (clone instanceof THREE.MeshPhysicalMaterial) {
						clone.iridescence = 0;
						clone.transmission = 0;
						clone.clearcoat = 0;
					}
					clone.userData.menuEmissiveBase = clone.emissiveIntensity;
					this.emissiveMats.push(clone);
					return clone;
				}
				clone.metalnessMap = null;
				clone.metalness = Math.min(clone.metalness, 0.12);
				clone.roughness = Math.max(clone.roughness, 0.4);
				clone.envMapIntensity = THREE.MathUtils.clamp(
					clone.envMapIntensity || 0.75,
					0.55,
					0.85,
				);
				if (!this.garageMode) {
					/** Menu orbit — przygaś emissive, zostaw kolor. */
					clone.emissiveIntensity = Math.min(clone.emissiveIntensity, 0.06);
					clone.blending = THREE.NormalBlending;
					clone.transparent = clone.opacity < 0.99;
				}
				/** Garaż: nie podbijaj emissive — inaczej „neonowy blob”. */
				if (clone instanceof THREE.MeshPhysicalMaterial) {
					clone.iridescence = 0;
					clone.transmission = 0;
					clone.clearcoat = Math.min(clone.clearcoat || 0, 0.35);
				}
				clone.userData.menuEmissiveBase = clone.emissiveIntensity;
				this.emissiveMats.push(clone);
				return clone;
			});
			node.material = next.length === 1 ? next[0]! : next;
		});
	}

	private syncHeroShadowCasting(): void {
		if (!this.heroCar) return;
		this.heroCar.traverse((node) => {
			if (node instanceof THREE.Mesh) node.castShadow = false;
		});
	}

	private ensureGarageKeyLight(): void {
		let key = this.root.getObjectByName("garageHeroKey");
		if (!(key instanceof THREE.DirectionalLight)) {
			const light = new THREE.DirectionalLight(0xfff2e0, 0);
			light.name = "garageHeroKey";
			light.position.set(4.5, 7.5, 3.5);
			light.target.position.set(0, 0.6, 0);
			this.root.add(light);
			this.root.add(light.target);
		}
		const fill = this.root.getObjectByName("garageHeroFill");
		if (!(fill instanceof THREE.DirectionalLight)) {
			const f = new THREE.DirectionalLight(0xb0c8e8, 0);
			f.name = "garageHeroFill";
			f.position.set(-5, 4, -2);
			this.root.add(f);
		}
	}

	private setGarageKeyLight(on: boolean): void {
		this.ensureGarageKeyLight();
		const key = this.root.getObjectByName("garageHeroKey");
		const fill = this.root.getObjectByName("garageHeroFill");
		if (key instanceof THREE.DirectionalLight) {
			key.intensity = on ? 1.35 : 0;
			key.visible = on;
		}
		if (fill instanceof THREE.DirectionalLight) {
			fill.intensity = on ? 0.55 : 0;
			fill.visible = on;
		}
	}

	private getHeroSpin(): THREE.Group | null {
		const spin = this.heroCar?.getObjectByName("menuHeroSpin");
		return spin instanceof THREE.Group ? spin : null;
	}

	private getHeroCarMesh(): THREE.Group | null {
		const mesh = this.getHeroSpin()?.children[0];
		return mesh instanceof THREE.Group ? mesh : null;
	}

	private mountHeroCar(template: THREE.Group, previewKey: string): THREE.Group {
		const heroPivot = new THREE.Group();
		heroPivot.name = "menuHeroCar";
		heroPivot.userData.previewCarId = previewKey;
		heroPivot.position.set(0, 0, 0);

		const spin = new THREE.Group();
		spin.name = "menuHeroSpin";
		spin.rotation.y = HERO_YAW;

		const carMesh = cloneCarMesh(template);
		carMesh.scale.setScalar(HERO_SCALE);
		sanitizeCarVisuals(carMesh);
		hideShowcaseGhostMeshes(carMesh);
		disableShowcaseShadowReceiving(carMesh);
		spin.add(carMesh);
		heroPivot.add(spin);
		this.setupCarEmissive(carMesh);
		/** setupCarEmissive klonuje materiały — maska hubów musi wrócić. */
		refreshBodyWheelWellMaskIfMounted(carMesh);
		const carId =
			typeof carMesh.userData.carId === "string"
				? carMesh.userData.carId
				: typeof template.userData.carId === "string"
					? template.userData.carId
					: null;
		if (
			carId &&
			carUsesEmptyWheelWells(carId) &&
			!carMesh.getObjectByName("cosmetic_rim_wheel_FL")
		) {
			applyBodyWheelWellMaskForEmptyHubs(carMesh, carId);
		}
		this.syncHeroShadowCasting();
		return heroPivot;
	}

	async init(): Promise<void> {
		const equipped = PlayerInventory.getEquippedCarId();
		const paintId = PlayerInventory.getEquippedPaintId("car");
		const template = await loadCarModel(equipped, "blue", paintId, undefined, {
			showcase: true,
		});

		const heroPivot = this.mountHeroCar(
			template,
			this.previewLoadoutKey(equipped, paintId),
		);
		this.heroCar = heroPivot;
		this.lastPivotScale = -1;
		this.root.add(heroPivot);
		this.updateHeroGroundPos();
		disposeCarMeshGroup(template);

		this.scene.threeJSScene.add(this.root);

		this.dust = new MenuDustParticles();
		this.dust.getObject().visible = true;
		this.scene.threeJSScene.add(this.dust.getObject());

		/** Soft disc — hero ma castShadow=false (lewitacja bez SM). */
		this.contactShadow = new CarContactShadow(2.45);
		this.scene.threeJSScene.add(this.contactShadow.mesh);

		/** Corner spoty + jupitery — orbita menu (bez snopów / dronów = anty-glow). */
		setStadiumShowcaseLighting(this.scene.lighting, true, {
			stadiumOrbit: true,
		});
		/** Soft flares — premium stack łapie jupiter/pylony bez washoutu orbity. */
		this.scene.lensFlares.setEnabled(true);
		this.scene.lensFlares.setDriveIntensity(0.48);
		this.renderer.setLensFlares(
			this.scene.lensFlares.collectLights(this.renderer.threeJSCamera),
			0.38,
		);
		setStadiumAtmosphereVisible(true);
		setSkyDronesEnabled(false);
		this.dimMatchVfxForMenu(true);
		setNeonWallMenuCalm(false);
		/** IBL jak w meczu — parity night film (lekki dim orbity). */
		if (!this.envSnap) {
			this.envSnap = {
				environment: this.scene.threeJSScene.environment,
				intensity: this.scene.threeJSScene.environmentIntensity ?? 1,
			};
			this.scene.threeJSScene.environmentIntensity = Math.min(
				this.envSnap.intensity * 0.98,
				1.1,
			);
		}

		this.menuCamera.setShowcaseCalm(true);
		if (new URLSearchParams(location.search).get("showcaseAudit") === "1") {
			logShowcaseSceneAudit(this.scene.threeJSScene, heroPivot);
		}

		this.renderer.setMenuBloomPresentation(true);
		this.renderer.refreshGarageShadowMaps();
		this.menuCamera.reset();
		this.menuCamera.update(this.renderer.threeJSCamera, 0);
	}

	private dimMatchVfxForMenu(dim: boolean): void {
		const scene = this.scene.threeJSScene;
		for (const name of ["goalGlow_blue", "goalGlow_orange"] as const) {
			const light = scene.getObjectByName(name);
			if (light instanceof THREE.PointLight) {
				if (dim) {
					if (light.userData.menuBaseIntensity == null) {
						light.userData.menuBaseIntensity = light.intensity;
					}
					light.intensity =
						(light.userData.menuBaseIntensity as number) * 0.85;
				} else if (typeof light.userData.menuBaseIntensity === "number") {
					light.intensity = light.userData.menuBaseIntensity;
					delete light.userData.menuBaseIntensity;
				}
			}
		}
		for (const name of [
			"ballFloorIndicator",
			"powerUpActivationBurst",
			"ballMotionStreak",
		]) {
			const obj = scene.getObjectByName(name);
			if (obj) obj.visible = !dim ? obj.visible : false;
		}
	}

	getMenuCameraPose(): { position: THREE.Vector3; lookAt: THREE.Vector3 } {
		return this.menuCamera.getPose();
	}

	setPointerNorm(x: number, y: number): void {
		if (document.body.classList.contains("showcase-frozen")) return;
		this.menuCamera.setPointerNorm(x, y);
		this.dust?.setPointerNorm(x, y);
	}

	setMenuAccent(_accent: string): void {
		/* Accent lights removed — mode pulse FX still via pulseModeSwitchFx. */
	}

	/** Drop reveal: szybsza orbita jak w pełnym menu cinematic. */
	setCrateBackdropMode(on: boolean): void {
		this.menuCamera.setShowcaseCalm(!on);
	}

	/** Promo capture: czytelny spin kamery w menu (~2× pełna orbita). */
	setPromoOrbitBoost(on: boolean): void {
		this.menuCamera.setShowcaseCalm(!on);
		this.menuCamera.setOrbitSpeedScale(on ? 2.35 : 1);
	}

	/** Chromatic burst + tint grade przy przełączeniu trybu. */
	pulseModeSwitchFx(accent: string): void {
		this.renderer.pulseChromaticAberration(1.25);
		this.renderer.pulseCinematicFx(0.55);
		this.renderer.pulseMenuDofFocus(0.58);
		switch (accent) {
			case "duel":
				this.renderer.pulseCoolGrade(0.72);
				break;
			case "team":
				this.renderer.pulseCoolGrade(0.52);
				break;
			case "chaos":
				this.renderer.pulseCoolGrade(0.38);
				this.renderer.pulseWarmGrade(0.22);
				break;
			case "ignition":
				this.renderer.pulseWarmGrade(0.92);
				break;
			default:
				break;
		}
	}

	triggerEquipSpin(): void {
		this.equipSpin = 1;
		this.menuCamera.triggerEquipSpin();
	}

	private syncEmissiveForShowcase(): void {
		for (const mat of this.emissiveMats) {
			const base =
				typeof mat.userData.menuEmissiveBase === "number"
					? (mat.userData.menuEmissiveBase as number)
					: mat.emissiveIntensity;
			mat.emissiveIntensity = this.garageMode
				? THREE.MathUtils.clamp(base, 0.02, 0.1)
				: Math.min(base, 0.06);
		}
	}

	setGarageMode(on: boolean): void {
		this.garageMode = on;
		this.menuCamera.setGarageMode(on);
		this.renderer.setGaragePresentation(on);
		this.syncHeroShadowCasting();
		this.setGarageKeyLight(on);
		if (this.dust) {
			this.dust.getObject().visible = !on;
		}
		if (on) {
			setStadiumShowcaseLighting(this.scene.lighting, true, {
				stadiumOrbit: false,
			});
			setStadiumAtmosphereVisible(false);
			setSkyDronesEnabled(false);
			this.dimMatchVfxForMenu(true);
			setNeonWallMenuCalm(true);
			this.menuCamera.snapToGarage();
			this.heroScale = GARAGE_HERO_SCALE;
			this.garageMotionRamp = 0;
			this.garageIntroSec = GARAGE_SPIN_HOLD_SEC;
			this.menuCamera.setGarageIntroActive(true);
			/** Nie reloadHeroCar tu — wyścig z setPreviewCar (garaż/audit) kasował model. */
			const mesh = this.getHeroCarMesh();
			if (mesh) {
				this.emissiveMats.length = 0;
				this.setupCarEmissive(mesh);
				refreshBodyWheelWellMaskIfMounted(mesh);
				const carId =
					typeof mesh.userData.carId === "string"
						? mesh.userData.carId
						: null;
				if (
					carId &&
					carUsesEmptyWheelWells(carId) &&
					!mesh.getObjectByName("cosmetic_rim_wheel_FL")
				) {
					applyBodyWheelWellMaskForEmptyHubs(mesh, carId);
				}
			}
			this.updateHeroGroundPos(0);
			this.renderer.refreshGarageShadowMaps();
			if (this.scene.threeJSScene.environment) {
				this.scene.threeJSScene.environmentIntensity = Math.max(
					this.scene.threeJSScene.environmentIntensity ?? 1,
					1.0,
				);
			}
		} else {
			setStadiumShowcaseLighting(this.scene.lighting, true, {
				stadiumOrbit: true,
			});
			setStadiumAtmosphereVisible(true);
			setSkyDronesEnabled(false);
			this.dimMatchVfxForMenu(true);
			setNeonWallMenuCalm(false);
			this.menuCamera.snapToMenu();
			this.heroScale = HERO_SCALE;
			this.garageIntroSec = 0;
			this.garageMotionRamp = 1;
			this.menuCamera.setGarageIntroActive(false);
			this.showcaseSettleSec = 2.25;
			this.updateHeroGroundPos(0);
		}
		this.menuCamera.applyHeldPose(this.renderer.threeJSCamera);
		this.syncEmissiveForShowcase();
		this.renderer.resetShowcaseBlitSurface();
	}

	getGarageBlend(): number {
		return this.menuCamera.getGarageBlend();
	}

	isGarageTransitioning(): boolean {
		return this.menuCamera.isGarageTransitioning();
	}

	/** Wywołane gdy HTML garażu wchodzi na ekran. */
	notifyGarageUiOpened(): void {
		this.garageMotionRamp = 0;
	}

	isGarageMode(): boolean {
		return this.garageMode;
	}

	isGarageIntroActive(): boolean {
		return this.garageMode && this.garageIntroSec > 0;
	}

	private isGarageMotionFrozen(): boolean {
		return (
			document.body.classList.contains("showcase-frozen") ||
			document.body.classList.contains("garage-entering") ||
			this.showcaseSettleSec > 0 ||
			this.isGarageIntroActive()
		);
	}

	async reloadHeroCar(previewLoadout?: CarCosmeticLoadout): Promise<void> {
		/** Menu / po garażu — zawsze model z aktywnego auta meczowego. */
		const carId = getEquippedCarId();
		const paintId = PlayerInventory.getEquippedPaintId("car");
		await this.setPreviewCar(
			carId,
			paintId,
			previewLoadout ?? getEquippedCarLoadout(carId),
		);
	}

	private previewLoadoutKey(
		carId: string,
		paintId: string | null,
		loadout?: CarCosmeticLoadout,
	): string {
		const L = loadout ?? getEquippedCarLoadout(carId);
		const p = L.paint;
		return [
			carId,
			paintId ?? "",
			L.wheelId ?? "",
			L.topperId ?? "",
			L.decalId ?? "",
			p.wheel ?? "",
			p.topper ?? "",
			p.decal ?? "",
		].join(":");
	}

	/** Podgląd auta w menu/garażu — `force` omija cache klucza (po kliku karoserii). */
	async setPreviewCar(
		carId: string,
		paintId: string | null = PlayerInventory.getEquippedPaintId("car"),
		previewLoadout?: CarCosmeticLoadout,
		force = false,
	): Promise<void> {
		const loadout = previewLoadout ?? getEquippedCarLoadout(carId);
		const previewKey = this.previewLoadoutKey(carId, paintId, loadout);
		if (
			!force &&
			this.heroCar?.userData.previewCarId === previewKey
		) {
			return;
		}

		const gen = ++this.heroReloadGen;

		if (this.heroCar) {
			this.heroCar.removeFromParent();
			disposeObject3D(this.heroCar);
			this.heroCar = null;
		}
		this.emissiveMats.length = 0;

		console.info(`[Ignite] Hero 3D → ${carId}`);
		const template = await loadCarModel(carId, "blue", paintId, loadout, {
			showcase: true,
		});
		if (gen !== this.heroReloadGen) {
			disposeCarMeshGroup(template);
			return;
		}
		const loadedId =
			typeof template.userData.carId === "string"
				? template.userData.carId
				: carId;
		if (loadedId !== carId) {
			console.warn(
				`[Ignite] Hero GLB fallback: chciano ${carId}, wczytano ${loadedId}`,
			);
		}
		const heroPivot = this.mountHeroCar(template, previewKey);
		this.heroCar = heroPivot;
		this.lastPivotScale = -1;
		this.root.add(heroPivot);
		this.updateHeroGroundPos();
		disposeCarMeshGroup(template);
		this.renderer.refreshGarageShadowMaps();
	}


	private updateHeroGroundPos(hover = 0): void {
		if (!this.heroCar) return;
		const carMesh = this.getHeroCarMesh();
		if (!carMesh) return;
		/**
		 * Zeruj pivot przed pomiarem — inaczej matrixWorld zawiera stary
		 * offset i resolveShowcasePivotY „dokłada” go drugi raz (auto unosi się).
		 *
		 * NIE snapuj felg do absolutnego surfaceContactY tutaj: przy pivot≠0
		 * huby odrywają się od body (koła na trawie, karoseria w powietrzu).
		 */
		this.heroCar.position.set(0, 0, 0);
		carMesh.scale.setScalar(this.heroScale);
		const pivotY = resolveShowcasePivotYStable(this.heroCar, carMesh);
		const x = this.garageMode ? GARAGE_HERO_X : 0;
		/** Lekki lift w garażu — FX Field Energy / swirl nie „zjada” opon. */
		const garageLift = this.garageMode ? 0.055 : 0;
		this.heroCar.position.set(x, pivotY + hover + garageLift, 0);
		refreshBodyWheelWellMaskIfMounted(carMesh);
		this.lastPivotScale = this.heroScale;
	}

	update(dt: number, nowSec: number): void {
		if (!this.isGarageIntroActive() && this.garageMode) {
			/** Lighting zostaje — flaga showcase w updateStadiumLighting nie przywraca pełnych spotów. */
			updateCyberpunkAmbience(
				nowSec,
				dt,
				this.scene.lighting,
				this.scene.threeJSScene,
				0.05,
			);
		}
		const settling = this.showcaseSettleSec > 0;
		if (settling) {
			this.showcaseSettleSec = Math.max(0, this.showcaseSettleSec - dt);
		}
		if (this.garageIntroSec > 0) {
			this.garageIntroSec = Math.max(0, this.garageIntroSec - dt);
			if (this.garageIntroSec <= 0) {
				this.menuCamera.setGarageIntroActive(false);
			}
		}
		const entering = document.body.classList.contains("garage-entering");
		const motionFrozen = this.isGarageMotionFrozen();
		const frozen =
			document.body.classList.contains("showcase-frozen") ||
			settling ||
			entering ||
			this.isGarageIntroActive();
		if (frozen) {
			this.menuCamera.applyHeldPose(this.renderer.threeJSCamera);
		} else {
			this.menuCamera.update(this.renderer.threeJSCamera, dt);
		}

		const garageBlend = this.menuCamera.getGarageBlend();

		if (!frozen && !motionFrozen) {
			this.idlePhase += dt;
		}
		if (!motionFrozen && this.garageMode && this.garageIntroSec <= 0) {
			this.garageMotionRamp = Math.min(
				1,
				this.garageMotionRamp + dt / GARAGE_SPIN_RAMP_SEC,
			);
		}

		const targetScale = THREE.MathUtils.lerp(
			HERO_SCALE,
			GARAGE_HERO_SCALE,
			garageBlend,
		);
		if (this.garageMode) {
			this.heroScale = GARAGE_HERO_SCALE;
		} else if (this.menuCamera.isGarageTransitioning()) {
			this.heroScale = targetScale;
		} else if (!frozen) {
			this.heroScale = THREE.MathUtils.lerp(
				this.heroScale,
				targetScale,
				1 - Math.exp(-6 * dt),
			);
			if (Math.abs(this.heroScale - targetScale) < 1e-4) {
				this.heroScale = targetScale;
			}
		}

		if (this.equipSpin > 0) {
			this.equipSpin = Math.max(0, this.equipSpin - dt * 2.4);
		}

		if (this.heroCar) {
			const carMesh = this.getHeroCarMesh();
			const scaleChanged =
				Math.abs(this.heroScale - this.lastPivotScale) > 1e-4;
			if (carMesh && scaleChanged) {
				carMesh.scale.setScalar(this.heroScale);
			}
			const spin = this.getHeroSpin();
			if (spin && !frozen && !motionFrozen) {
				const baseRate = this.garageMode ? 0.18 : 0.12;
				const spinRate = this.garageMode
					? baseRate * this.garageMotionRamp
					: baseRate;
				const spinBoost = this.equipSpin * dt * 14;
				spin.rotation.y =
					HERO_YAW + this.idlePhase * spinRate + spinBoost;
			}
			const transitioning = this.menuCamera.isGarageTransitioning();
			if (
				!transitioning &&
				(this.wasGarageTransitioning || scaleChanged)
			) {
				this.updateHeroGroundPos(0);
			}
			this.wasGarageTransitioning = transitioning;
		}

		/** Orbit też oddycha — słabiej niż garaż (bez neon-blobu). */
		const pulseCap = this.garageMode ? 0.03 : 0.022;
		const pulse = motionFrozen
			? pulseCap * 0.5
			: (0.02 + Math.sin(this.idlePhase * 2.4) * 0.015) *
				(1 - garageBlend * 0.35);
		for (const mat of this.emissiveMats) {
			const base =
				typeof mat.userData.menuEmissiveBase === "number"
					? (mat.userData.menuEmissiveBase as number)
					: 0.12;
			mat.emissiveIntensity = base + Math.min(pulse, pulseCap);
		}

		if (this.dust?.getObject().visible) {
			this.dust.update(dt, nowSec);
		}

		if (this.contactShadow && this.heroCar) {
			this.heroCar.getWorldPosition(this.menuFocusScratch);
			this.contactShadow.update(this.menuFocusScratch, true);
			const s = this.garageMode ? 1.38 : 1;
			this.contactShadow.mesh.scale.set(1.12 * s, 1, 1.28 * s);
		}

		if (!this.garageMode) {
			this.scene.lensFlares.setEnabled(true);
			this.scene.lensFlares.setDriveIntensity(0.48);
			this.renderer.setLensFlares(
				this.scene.lensFlares.collectLights(this.renderer.threeJSCamera),
				0.36 + Math.sin(this.idlePhase * 0.7) * 0.04,
			);
		} else {
			this.scene.lensFlares.setEnabled(false);
			this.renderer.setLensFlares([]);
		}

		if (this.heroCar) {
			this.heroCar.getWorldPosition(this.menuFocusScratch);
			this.menuFocusScratch.y += this.garageMode ? 0.85 : 0.55;
			this.renderer.updateMenuShowcaseFx(
				this.menuFocusScratch,
				showcaseDof() * (this.garageMode ? 1 : 1.35),
			);
		}

		this.renderer.render(this.scene, dt);
	}

	dispose(): void {
		this.renderer.setMenuBloomPresentation(false);
		this.renderer.clearMenuShowcaseFx();
		this.scene.lensFlares.setEnabled(false);
		this.renderer.setLensFlares([]);
		setStadiumShowcaseLighting(this.scene.lighting, false);
		setStadiumAtmosphereVisible(true);
		setSkyDronesEnabled(false);
		this.dimMatchVfxForMenu(false);
		setNeonWallMenuCalm(false);
		if (this.envSnap) {
			restoreShowcaseEnvironment(this.scene.threeJSScene, this.envSnap);
			this.envSnap = null;
		}
		if (this.dust) {
			this.scene.threeJSScene.remove(this.dust.getObject());
			this.dust.dispose();
			this.dust = null;
		}
		if (this.contactShadow) {
			this.contactShadow.dispose();
			this.contactShadow = null;
		}

		if (this.heroCar) {
			this.heroCar.removeFromParent();
			disposeObject3D(this.heroCar);
			this.heroCar = null;
		}

		this.scene.threeJSScene.remove(this.root);
		this.emissiveMats.length = 0;

		this.scene.purgeMenuDecorations();
	}
}
