import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

import type Scene from "./Scene";
import type Player from "./util/Player";
import {
	BASE_FOV,
	type ChaseCameraState,
	createChaseCameraState,
	horizontalFovToVertical,
	sampleChaseCameraTargets,
	updateChaseCamera,
} from "./visual/cameraFollow";

class Renderer {
	threeJSRenderer: THREE.WebGLRenderer;
	threeJSCamera: THREE.PerspectiveCamera;
	cameraForward: THREE.Vector3;
	composer: EffectComposer;
	renderPass: RenderPass;
	bloomPass: UnrealBloomPass;

	private readonly baseHorizontalFov = BASE_FOV;
	private readonly chaseState: ChaseCameraState;
	/** Kamera startuje w Ball Cam; Spacja przełącza Car Cam. */
	private isBallCam = true;

	constructor(container: HTMLElement = document.body) {
		this.chaseState = createChaseCameraState(BASE_FOV);
		this.threeJSRenderer = new THREE.WebGLRenderer({
			antialias: true,
			powerPreference: "high-performance",
			failIfMajorPerformanceCaveat: false,
		});
		if (!this.threeJSRenderer.capabilities.isWebGL2) {
			console.warn("FlyBall: WebGL2 niedostępne, używam WebGL1");
		}
		this.threeJSRenderer.shadowMap.enabled = true;
		this.threeJSRenderer.shadowMap.autoUpdate = true;
		this.threeJSRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
		// ACES Filmic — kinowe mapowanie tonów (jak UE); chroni neony przed wash-out.
		this.threeJSRenderer.toneMapping = THREE.ACESFilmicToneMapping;
		this.threeJSRenderer.toneMappingExposure = 1.0;
		this.threeJSRenderer.outputColorSpace = THREE.SRGBColorSpace;
		container.appendChild(this.threeJSRenderer.domElement);
		this.threeJSRenderer.domElement.tabIndex = 0;
		this.threeJSRenderer.domElement.style.outline = "none";

		const aspect = window.innerWidth / window.innerHeight;
		this.threeJSCamera = new THREE.PerspectiveCamera(
			horizontalFovToVertical(this.baseHorizontalFov, aspect),
			aspect,
			0.1,
			2500,
		);
		this.cameraForward = new THREE.Vector3(0, 0, -1);

		this.renderPass = new RenderPass(new THREE.Scene(), this.threeJSCamera);
		this.composer = new EffectComposer(this.threeJSRenderer);
		this.composer.addPass(this.renderPass);

		this.bloomPass = new UnrealBloomPass(
			new THREE.Vector2(window.innerWidth, window.innerHeight),
			0.12,
			0.42,
			0.94,
		);
		this.composer.addPass(this.bloomPass);
		this.composer.addPass(new OutputPass());

		window.addEventListener("resize", () =>
			this.setSize(window.innerWidth, window.innerHeight),
		);
		this.setSize(window.innerWidth, window.innerHeight);
	}

	render(scene: Scene) {
		this.renderPass.scene = scene.threeJSScene;
		this.renderPass.camera = this.threeJSCamera;
		this.composer.render();
	}

	setSize(width: number, height: number) {
		this.threeJSRenderer.setSize(width, height, false);
		this.composer.setSize(width, height);
		this.threeJSCamera.aspect = width / height;
		this.threeJSCamera.fov = horizontalFovToVertical(
			this.chaseState.currentHorizontalFov,
			this.threeJSCamera.aspect,
		);
		this.threeJSCamera.updateProjectionMatrix();
	}

	private readonly baseBloomStrength = 0.12;
	private goalFovBoost = 0;

	applyGoalPresentation(bloom: number, fovBoost: number, shake: number): void {
		this.bloomPass.strength = this.baseBloomStrength + bloom * 0.52;
		this.goalFovBoost = fovBoost;
		if (shake > 0.01) {
			this.addCameraShake(shake);
		}
	}

	resetGoalPresentation(): void {
		this.bloomPass.strength = this.baseBloomStrength;
		this.goalFovBoost = 0;
	}

	addCameraShake(intensity: number): void {
		this.chaseState.shakeIntensity = Math.min(
			1.2,
			Math.max(this.chaseState.shakeIntensity, intensity),
		);
	}

	toggleBallCam(): void {
		this.isBallCam = !this.isBallCam;
	}

	setBallCamEnabled(enabled: boolean): void {
		this.isBallCam = enabled;
	}

	isBallCamEnabled(): boolean {
		return this.isBallCam;
	}

	focusCanvas(): void {
		this.threeJSRenderer.domElement.focus({ preventScroll: true });
	}

	getChaseOrbitForward(): THREE.Vector3 {
		return this.chaseState.lastFlatForward;
	}

	resetChaseCamera(carQuat: THREE.Quaternion): void {
		this.chaseState.initialized = false;
		this.chaseState.shakeIntensity = 0;
		const flat = new THREE.Vector3(0, 0, 1).applyQuaternion(carQuat);
		this.chaseState.lastFlatForward.set(flat.x, 0, flat.z);
		if (this.chaseState.lastFlatForward.lengthSq() > 1e-6) {
			this.chaseState.lastFlatForward.normalize();
		} else {
			this.chaseState.lastFlatForward.set(0, 0, 1);
		}
	}

	/** Natychmiastowy TPP za autem (linia piłka→auto) — kickoff / intro / reset po golu. */
	snapChaseCamera(player: Player, ballPos: THREE.Vector3): void {
		if (!player?.rapierRigidBody) return;

		const carPos = player.getPosition();
		if (
			!Number.isFinite(carPos.x) ||
			!Number.isFinite(carPos.y) ||
			!Number.isFinite(carPos.z)
		) {
			return;
		}

		const rot = player.rapierRigidBody.rotation();
		const carQuat = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
		this.resetChaseCamera(carQuat);

		const { targetPos, lookAt } = sampleChaseCameraTargets(
			carPos,
			this.chaseState.lastFlatForward,
			ballPos,
			this.isBallCam,
		);

		this.chaseState.shakeIntensity = 0;
		this.chaseState.initialized = true;
		this.threeJSCamera.position.copy(targetPos);
		this.threeJSCamera.up.set(0, 1, 0);
		this.threeJSCamera.lookAt(lookAt);

		const verticalFov = horizontalFovToVertical(
			this.baseHorizontalFov,
			this.threeJSCamera.aspect,
		);
		if (Math.abs(this.threeJSCamera.fov - verticalFov) > 0.02) {
			this.threeJSCamera.fov = verticalFov;
			this.chaseState.currentHorizontalFov = this.baseHorizontalFov;
			this.threeJSCamera.updateProjectionMatrix();
		}
	}

	/** Kamera za autem (quaternion) — lookAt na środek auta / piłkę z bezpiecznikiem NDC. */
	followPlayer(
		player: Player,
		dt: number,
		boosting = false,
		ballPos: THREE.Vector3,
	) {
		if (!player?.rapierRigidBody) return;

		const carPos = player.getPosition();
		if (
			!Number.isFinite(carPos.x) ||
			!Number.isFinite(carPos.y) ||
			!Number.isFinite(carPos.z)
		) {
			return;
		}

		const velocity = player.getVelocity();
		const speed = velocity.length();
		const speedXZ = Math.hypot(velocity.x, velocity.z);
		const wheelsGrounded = player.getWheelsGroundedCount();
		const rot = player.rapierRigidBody.rotation();
		const carQuat = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);

		updateChaseCamera(
			this.threeJSCamera,
			carPos,
			carQuat,
			ballPos,
			this.isBallCam,
			dt,
			boosting,
			speed,
			this.chaseState,
			this.baseHorizontalFov,
			speedXZ,
			wheelsGrounded,
			this.goalFovBoost,
			player.isFlipping(),
		);
	}

	private readonly _replayCamPos = new THREE.Vector3();
	private readonly _replayLook = new THREE.Vector3();
	private readonly _replayDir = new THREE.Vector3();

	/** Kamera cinematic podczas powtórki — szerszy kąt, za piłką w kierunku lotu. */
	followReplayBall(
		ballPos: THREE.Vector3,
		ballVel: THREE.Vector3,
		dt: number,
	): void {
		const speed = ballVel.length();
		if (speed > 0.35) {
			this._replayDir.copy(ballVel).multiplyScalar(1 / speed);
		} else {
			this._replayDir.set(
				0,
				0,
				this.chaseState.lastFlatForward.z >= 0 ? 1 : -1,
			);
		}

		this._replayCamPos
			.copy(ballPos)
			.addScaledVector(this._replayDir, -8.5)
			.add(new THREE.Vector3(0, 3.2, 0));

		this._replayLook.copy(ballPos).addScaledVector(this._replayDir, 3.5);
		this._replayLook.y += 0.25;

		const lerp = 1 - Math.exp(-12 * dt);
		this.threeJSCamera.position.lerp(this._replayCamPos, lerp);
		this.threeJSCamera.up.set(0, 1, 0);
		this.threeJSCamera.lookAt(this._replayLook);
		if (this.goalFovBoost > 0.05) {
			const boosted = horizontalFovToVertical(
				this.baseHorizontalFov + this.goalFovBoost,
				this.threeJSCamera.aspect,
			);
			this.threeJSCamera.fov = boosted;
			this.threeJSCamera.updateProjectionMatrix();
		}
		this.chaseState.shakeIntensity = THREE.MathUtils.lerp(
			this.chaseState.shakeIntensity,
			0,
			0.12,
		);
	}
}

export default Renderer;
