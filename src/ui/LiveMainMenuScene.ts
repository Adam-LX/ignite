import * as THREE from "three";

import type Renderer from "../Renderer";
import type Scene from "../Scene";
import { RL_BALL, RL_CAR } from "../util/rlConstants";
import { loadModel } from "../util/ThreeJSHelpers";
import { updateCyberpunkAmbience } from "../visual/arena";
import { cloneCarMesh, loadCarModel } from "../visual/carVisuals";
import { enhanceBall } from "../visual/materials";
import { MenuCinematicCamera } from "../visual/menuCinematicCamera";
import { setStadiumVolumetricsVisible } from "../visual/stadiumLighting";

const SHOWCASE_GROUND_Y = RL_CAR.hitboxHalfY;
const BLUE_POS = new THREE.Vector3(7.5, SHOWCASE_GROUND_Y, 3.5);
const ORANGE_POS = new THREE.Vector3(-7.5, SHOWCASE_GROUND_Y, -3.5);
const BLUE_YAW = 0.55;
const ORANGE_YAW = BLUE_YAW + Math.PI + 0.35;

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

/**
 * Live 3D main menu — dwa auta w konfrontacji, piłka, kinowa kamera.
 */
export class LiveMainMenuScene {
	private readonly root = new THREE.Group();
	private readonly scene: Scene;
	private readonly renderer: Renderer;
	private readonly menuCamera = new MenuCinematicCamera();
	private blueCar: THREE.Group | null = null;
	private orangeCar: THREE.Group | null = null;
	private ballMesh: THREE.Object3D | null = null;
	private showcaseLight: THREE.SpotLight | null = null;
	private spotTarget: THREE.Object3D | null = null;
	private idlePhase = 0;
	private readonly emissiveMats: THREE.MeshStandardMaterial[] = [];
	private wheelMeshes: THREE.Object3D[] = [];

	constructor(scene: Scene, renderer: Renderer) {
		this.scene = scene;
		this.renderer = renderer;
		this.root.name = "menuShowcase";
	}

	private setupCarEmissive(mesh: THREE.Group): void {
		mesh.traverse((node) => {
			if (!(node instanceof THREE.Mesh)) return;
			node.castShadow = true;
			node.receiveShadow = true;
			const name = node.name.toLowerCase();
			if (name.includes("wheel") || name.includes("tire")) {
				this.wheelMeshes.push(node);
			}
			const mats = Array.isArray(node.material)
				? node.material
				: [node.material];
			for (const mat of mats) {
				if (mat instanceof THREE.MeshStandardMaterial && mat.emissive) {
					const clone = mat.clone();
					clone.emissiveIntensity = 0.55;
					node.material = clone;
					this.emissiveMats.push(clone);
				}
			}
		});
	}

	async init(): Promise<void> {
		const [blueTemplate, orangeTemplate, ballRaw] = await Promise.all([
			loadCarModel("blue"),
			loadCarModel("orange"),
			loadModel("/assets/models/rocketLeagueBall.glb"),
		]);

		this.blueCar = cloneCarMesh(blueTemplate);
		this.blueCar.name = "menuShowcaseCarBlue";
		this.blueCar.position.copy(BLUE_POS);
		this.blueCar.rotation.y = BLUE_YAW;
		this.setupCarEmissive(this.blueCar);
		this.root.add(this.blueCar);

		this.orangeCar = cloneCarMesh(orangeTemplate);
		this.orangeCar.name = "menuShowcaseCarOrange";
		this.orangeCar.position.copy(ORANGE_POS);
		this.orangeCar.rotation.y = ORANGE_YAW;
		this.setupCarEmissive(this.orangeCar);
		this.root.add(this.orangeCar);

		const ball = ballRaw as THREE.Mesh;
		enhanceBall(ball);
		ball.scale.setScalar((RL_BALL.radius * 2) / 1.8);
		ball.name = "menuShowcaseBall";
		ball.position.set(0, RL_BALL.radius + 1.2, 0);
		this.ballMesh = ball;
		this.root.add(ball);

		this.scene.threeJSScene.add(this.root);

		this.spotTarget = new THREE.Object3D();
		this.spotTarget.name = "menuSpotTarget";
		this.spotTarget.position.set(0, 1.5, 0);
		this.root.add(this.spotTarget);

		const spot = new THREE.SpotLight(0xc8e8ff, 28, 55, Math.PI / 4.5, 0.32, 1);
		spot.name = "menuShowcaseSpot";
		spot.castShadow = true;
		spot.shadow.mapSize.set(1024, 1024);
		spot.shadow.bias = -0.0002;
		spot.position.set(6, 14, 10);
		spot.target = this.spotTarget;
		this.scene.threeJSScene.add(spot);
		this.showcaseLight = spot;

		const rimBlue = new THREE.PointLight(0x4488ff, 4.5, 22);
		rimBlue.name = "menuShowcaseRimBlue";
		rimBlue.position.set(9, 3, 5);
		this.root.add(rimBlue);

		const rimOrange = new THREE.PointLight(0xff8844, 4.5, 22);
		rimOrange.name = "menuShowcaseRimOrange";
		rimOrange.position.set(-9, 3, -5);
		this.root.add(rimOrange);

		setStadiumVolumetricsVisible(this.scene.lighting, true);
		this.menuCamera.update(this.renderer.threeJSCamera, 0);
	}

	getMenuCameraPose(): { position: THREE.Vector3; lookAt: THREE.Vector3 } {
		return this.menuCamera.getPose();
	}

	update(dt: number, nowSec: number): void {
		updateCyberpunkAmbience(
			nowSec,
			dt,
			this.scene.lighting,
			this.scene.threeJSScene,
		);
		this.menuCamera.update(this.renderer.threeJSCamera, dt);

		this.idlePhase += dt;
		const hover = Math.sin(this.idlePhase * 1.6) * 0.022;

		if (this.blueCar) {
			this.blueCar.rotation.y =
				BLUE_YAW + Math.sin(this.idlePhase * 0.4) * 0.05;
			this.blueCar.position.y = BLUE_POS.y + hover;
		}
		if (this.orangeCar) {
			this.orangeCar.rotation.y =
				ORANGE_YAW - Math.sin(this.idlePhase * 0.38) * 0.05;
			this.orangeCar.position.y = ORANGE_POS.y + hover;
		}
		if (this.ballMesh) {
			this.ballMesh.position.y =
				RL_BALL.radius + 1.2 + Math.sin(this.idlePhase * 2.2) * 0.45;
			this.ballMesh.rotation.y += dt * 0.9;
			this.ballMesh.rotation.x = Math.sin(this.idlePhase * 1.4) * 0.12;
		}

		const pulse = 0.45 + Math.sin(this.idlePhase * 2.8) * 0.35;
		for (const mat of this.emissiveMats) {
			mat.emissiveIntensity = pulse;
		}

		if (this.showcaseLight) {
			this.showcaseLight.intensity = 24 + Math.sin(this.idlePhase * 2.1) * 5;
		}

		const spin = dt * 3.2;
		for (const wheel of this.wheelMeshes) {
			wheel.rotation.x += spin;
		}

		this.renderer.render(this.scene);
	}

	dispose(): void {
		if (this.showcaseLight) {
			this.scene.threeJSScene.remove(this.showcaseLight);
			this.showcaseLight.dispose();
			this.showcaseLight = null;
		}

		for (const car of [this.blueCar, this.orangeCar, this.ballMesh]) {
			if (!car) continue;
			car.removeFromParent();
			disposeObject3D(car);
		}
		this.blueCar = null;
		this.orangeCar = null;
		this.ballMesh = null;

		this.scene.threeJSScene.remove(this.root);
		this.spotTarget = null;
		this.emissiveMats.length = 0;
		this.wheelMeshes.length = 0;

		this.scene.purgeMenuDecorations();
	}
}
