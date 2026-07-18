import * as THREE from "three";
import { getEquippedCarId, PlayerInventory } from "../meta/PlayerInventory";
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
import { snapCosmeticWheelsIfMounted } from "../visual/cosmeticGlb";
import {
	getEquippedCarLoadout,
	type CarCosmeticLoadout,
} from "../visual/carCosmetics";
import { showcaseDof } from "../visual/garagePresentationPolicy";
import {
	disableShowcaseShadowReceiving,
	hideShowcaseGhostMeshes,
	logShowcaseSceneAudit,
	restoreShowcaseEnvironment,
	type ShowcaseEnvironmentSnapshot,
} from "../visual/showcaseSceneAudit";
import { sanitizeCarVisuals } from "../visual/sanitizeCar";
import { MenuCinematicCamera } from "../visual/menuCinematicCamera";
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
			node.geometry?.dispose();
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
	private readonly menuFocusScratch = new THREE.Vector3();
	private envSnap: ShowcaseEnvironmentSnapshot | null = null;

	constructor(scene: Scene, renderer: Renderer) {
		this.scene = scene;
		this.renderer = renderer;
		this.root.name = "menuShowcase";
	}

	private setupCarEmissive(mesh: THREE.Object3D): void {
		const intensity = this.garageMode ? 0.06 : 0;
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
			// Showcase — bez castShadow (ruchomy cień = „drugie auto” pod spodem).
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
			const next = srcMats.map((mat) => {
				if (!mat) return mat;
				/** Additive „poświaty” z GLB — gasimy materiał (+ mesh gdy same additive). */
				if (
					!this.garageMode &&
					(mat as THREE.Material).blending === THREE.AdditiveBlending
				) {
					const clone = mat.clone();
					if ("opacity" in clone) {
						(clone as THREE.Material & { opacity: number }).opacity = 0;
						(clone as THREE.Material).transparent = true;
					}
					if (
						clone instanceof THREE.MeshStandardMaterial ||
						clone instanceof THREE.MeshBasicMaterial
					) {
						if ("emissiveIntensity" in clone) {
							(clone as THREE.MeshStandardMaterial).emissiveIntensity = 0;
							(clone as THREE.MeshStandardMaterial).emissive?.set(0, 0, 0);
						}
					}
					return clone;
				}
				if (!(mat instanceof THREE.MeshStandardMaterial)) return mat;
				const clone = mat.clone();
				clone.emissive.set(0, 0, 0);
				clone.emissiveIntensity = intensity;
				clone.emissiveMap = null;
				if (!this.garageMode) {
					clone.envMapIntensity = 0;
					clone.metalness = Math.min(clone.metalness, 0.38);
					clone.roughness = Math.max(clone.roughness, 0.42);
					clone.blending = THREE.NormalBlending;
					clone.transparent = clone.opacity < 0.99;
				}
				if (clone instanceof THREE.MeshPhysicalMaterial && !this.garageMode) {
					clone.clearcoat = 0;
					clone.clearcoatRoughness = 1;
					clone.sheen = 0;
					clone.iridescence = 0;
					clone.transmission = 0;
					clone.specularIntensity = Math.min(
						clone.specularIntensity ?? 1,
						0.35,
					);
				}
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
		this.syncHeroShadowCasting();
		return heroPivot;
	}

	async init(): Promise<void> {
		const equipped = PlayerInventory.getEquippedCarId();
		const paintId = PlayerInventory.getEquippedPaintId("car");
		const template = await loadCarModel(equipped, "blue", paintId);

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
		this.dust.getObject().visible = false;
		this.scene.threeJSScene.add(this.dust.getObject());

		/** Corner spoty + jupitery — orbita menu (bez snopów / dronów = anty-glow). */
		setStadiumShowcaseLighting(this.scene.lighting, true, {
			stadiumOrbit: true,
		});
		this.scene.lensFlares.setEnabled(false);
		this.renderer.setLensFlares([]);
		setStadiumAtmosphereVisible(true);
		setSkyDronesEnabled(false);
		this.dimMatchVfxForMenu(true);
		setNeonWallMenuCalm(false);
		/** IBL jak w meczu — wcześniej ×0.28 robiło „mdłe” tło. */
		if (!this.envSnap) {
			this.envSnap = {
				environment: this.scene.threeJSScene.environment,
				intensity: this.scene.threeJSScene.environmentIntensity ?? 1,
			};
			this.scene.threeJSScene.environmentIntensity = Math.min(
				this.envSnap.intensity * 0.92,
				1.05,
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
		const base = this.garageMode ? 0.06 : 0;
		for (const mat of this.emissiveMats) {
			mat.emissiveIntensity = base;
		}
	}

	setGarageMode(on: boolean): void {
		this.garageMode = on;
		this.menuCamera.setGarageMode(on);
		this.renderer.setGaragePresentation(on);
		this.syncHeroShadowCasting();
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
			this.updateHeroGroundPos(0);
			this.renderer.refreshGarageShadowMaps();
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
		const template = await loadCarModel(carId, "blue", paintId, loadout);
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
		carMesh.scale.setScalar(this.heroScale);
		snapCosmeticWheelsIfMounted(carMesh);
		const pivotY = resolveShowcasePivotYStable(this.heroCar, carMesh);
		this.heroCar.position.set(0, pivotY + hover, 0);
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
				0.12,
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
				const baseRate = this.garageMode ? 0.28 : 0.12;
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

		const pulseCap = this.garageMode ? 0.08 : 0;
		const pulse = motionFrozen
			? pulseCap * 0.92
			: (0.04 + Math.sin(this.idlePhase * 2.4) * 0.02) *
				(1 - garageBlend * 0.35);
		for (const mat of this.emissiveMats) {
			mat.emissiveIntensity = Math.min(pulse, pulseCap);
		}

		if (this.dust?.getObject().visible) {
			this.dust.update(dt, nowSec);
		}

		if (this.heroCar && this.garageMode) {
			this.heroCar.getWorldPosition(this.menuFocusScratch);
			this.menuFocusScratch.y += 0.85;
			this.renderer.updateMenuShowcaseFx(
				this.menuFocusScratch,
				showcaseDof(),
			);
		}

		this.renderer.render(this.scene);
	}

	dispose(): void {
		this.renderer.setMenuBloomPresentation(false);
		this.renderer.clearMenuShowcaseFx();
		setStadiumShowcaseLighting(this.scene.lighting, false);
		setStadiumAtmosphereVisible(true);
		setSkyDronesEnabled(true);
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
