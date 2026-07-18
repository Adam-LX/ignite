import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";

import type { ScoringTeam } from "../game/modes";

/** Lekki odstęp nad dachem auta (m). */
export const CAR_NAME_TAG_LIFT = 0.42;

/** Odległość referencyjna — przy niej plakietka ma skalę 1.0. */
export const CAR_NAME_TAG_REF_DISTANCE = 15;

/** Skala min/max względem odległości kamery (bez skrajnego zoomu replay). */
export const CAR_NAME_TAG_SCALE_MIN = 0.8;
export const CAR_NAME_TAG_SCALE_MAX = 2.4;

const VFX_MESH_NAMES = new Set([
	"headlightBeam_L",
	"headlightBeam_R",
	"powerUpPickup",
	"powerUpSpikes",
]);

/** Skala ∝ 1/odległość — bliżej kamery = większa, dalej = mniejsza. */
export function carNameTagScaleFromDistance(dist: number): number {
	const safeDist = Math.max(dist, 1);
	return THREE.MathUtils.clamp(
		CAR_NAME_TAG_REF_DISTANCE / safeDist,
		CAR_NAME_TAG_SCALE_MIN,
		CAR_NAME_TAG_SCALE_MAX,
	);
}

/**
 * Bbox karoserii — bez reflektorów, snopów światła i VFX power-upów na visualRoot.
 */
export function computeCarNameTagAnchor(
	visualRoot: THREE.Object3D,
	outBox: THREE.Box3,
): void {
	visualRoot.updateMatrixWorld(true);

	const body = visualRoot.getObjectByName("body");
	if (body) {
		outBox.setFromObject(body);
		return;
	}

	outBox.makeEmpty();
	for (const child of visualRoot.children) {
		if (child instanceof THREE.Light) continue;
		if (VFX_MESH_NAMES.has(child.name)) continue;
		if (
			child instanceof THREE.Mesh &&
			child.geometry instanceof THREE.CylinderGeometry
		) {
			continue;
		}
		if (child instanceof THREE.Object3D) {
			outBox.expandByObject(child);
		}
	}

	if (!outBox.isEmpty()) return;
	outBox.setFromObject(visualRoot);
}

/** Półprzezroczysta plakietka nazwy gracza nad autem (RL-style). */
export class CarNameTag {
	readonly object: CSS2DObject;
	private readonly rootEl: HTMLElement;
	private readonly labelEl: HTMLElement;
	private readonly anchorBox = new THREE.Box3();
	private readonly anchorCenter = new THREE.Vector3();

	constructor(
		scene: THREE.Scene,
		name: string,
		team: ScoringTeam,
		isHuman: boolean,
	) {
		this.rootEl = document.createElement("div");
		this.rootEl.className = "car-name-tag";
		this.rootEl.dataset.team = team;
		if (isHuman) this.rootEl.dataset.human = "1";

		const stripe = document.createElement("span");
		stripe.className = "car-name-tag__stripe";
		stripe.setAttribute("aria-hidden", "true");
		this.rootEl.appendChild(stripe);

		this.labelEl = document.createElement("span");
		this.labelEl.className = "car-name-tag__label";
		this.labelEl.textContent = name;
		this.rootEl.appendChild(this.labelEl);

		this.object = new CSS2DObject(this.rootEl);
		this.object.frustumCulled = false;
		scene.add(this.object);
	}

	setName(name: string): void {
		this.labelEl.textContent = name;
	}

	sync(visualRoot: THREE.Object3D, camera: THREE.Camera): void {
		computeCarNameTagAnchor(visualRoot, this.anchorBox);
		this.anchorBox.getCenter(this.anchorCenter);

		this.object.position.set(
			this.anchorCenter.x,
			this.anchorBox.max.y + CAR_NAME_TAG_LIFT,
			this.anchorCenter.z,
		);

		const dist = camera.position.distanceTo(this.object.position);
		const scale = carNameTagScaleFromDistance(dist);
		this.rootEl.style.setProperty("--tag-scale", scale.toFixed(3));

		const opacity = THREE.MathUtils.clamp(1.05 - (dist - 38) * 0.012, 0.34, 1);
		this.rootEl.style.opacity = String(opacity);
	}

	dispose(): void {
		this.object.removeFromParent();
		this.rootEl.remove();
	}
}
