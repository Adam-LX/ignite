import * as THREE from "three";

import { assetUrl } from "../util/assetUrl";
import { createGltfLoader } from "../util/gltfLoader";
import { RL_ARENA } from "./arenaConstants";
import { createGoalNetMaterial } from "./goalNetMaterial";

/** Front bramki dokładnie na linii końcowej. */
export const GOAL_MOUTH_INSET = 0;

const GOAL_GLB = "/assets/models/stadium_goal_complete.glb";

function teamAccent(team: "blue" | "orange"): number {
	return team === "blue" ? 0x00f0ff : 0xff5500;
}

function isGoalNetMesh(name: string): boolean {
	const n = name.toLowerCase();
	return n.includes("net") || n.includes("siat") || n.includes("wire");
}

/**
 * Bramka RL — Meshy GLB z deterministyczną orientacją:
 * szerokość wzdłuż X (±9 m, styk z bandą), głębokość wzdłuż +Z, siatka z tyłu.
 */
export class GoalVisual {
	readonly mesh: THREE.Group;
	private readonly team: "blue" | "orange";
	private pendingLineZ = 0;
	private pendingZSign: 1 | -1 = 1;

	constructor(team: "blue" | "orange" = "blue") {
		this.team = team;
		this.mesh = new THREE.Group();
		this.mesh.name = `goalVisual_${team}`;
		this.loadGoalModel();
	}

	mount(parent: THREE.Object3D, lineZ: number, zSign: 1 | -1): void {
		this.pendingLineZ = lineZ;
		this.pendingZSign = zSign;
		this.applyMountTransform();
		parent.add(this.mesh);
	}

	private loadGoalModel(): void {
		const loader = createGltfLoader();
		loader.load(
			assetUrl(GOAL_GLB),
			(gltf) => {
				const model = gltf.scene;
				model.name = "goalMeshyComplete";
				this.applyTeamMaterials(model);
				this.fitMeshyGoal(model);
				this.mesh.add(model);
				this.applyMountTransform();
			},
			undefined,
			() => {
				console.warn("FlyBall: bramka Meshy — fallback proceduralny");
				this.buildProceduralGoal(this.mesh);
				this.applyMountTransform();
			},
		);
	}

	/** Czarne słupki + neonowa emisja drużyny; siatka osobno. */
	private applyTeamMaterials(root: THREE.Object3D): void {
		const accent = teamAccent(this.team);
		root.traverse((child) => {
			if (!(child instanceof THREE.Mesh)) return;
			child.castShadow = true;
			child.receiveShadow = true;

			if (isGoalNetMesh(child.name)) {
				child.material = createGoalNetMaterial(this.team);
				child.castShadow = false;
				child.receiveShadow = false;
				return;
			}

			const mats = Array.isArray(child.material)
				? child.material
				: [child.material];
			for (const mat of mats) {
				if (!(mat instanceof THREE.MeshStandardMaterial)) continue;
				mat.color.setHex(0x222222);
				mat.metalness = 0.8;
				mat.roughness = 0.2;
				mat.emissive.setHex(accent);
				mat.emissiveIntensity = 4.2;
				mat.transparent = false;
				mat.opacity = 1;
			}
		});
	}

	/** Szerokość → oś X, głębokość → oś +Z, wjazd od z=0, siatka w głębi. */
	private fitMeshyGoal(model: THREE.Object3D): void {
		const { GOAL_WIDTH, GOAL_HEIGHT, GOAL_DEPTH } = RL_ARENA;
		const halfW = GOAL_WIDTH / 2;

		model.position.set(0, 0, 0);
		model.rotation.set(0, 0, 0);
		model.scale.set(1, 1, 1);
		model.updateMatrixWorld(true);

		let box = new THREE.Box3().setFromObject(model);
		let size = box.getSize(new THREE.Vector3());

		if (size.z > size.x) {
			model.rotation.y = Math.PI / 2;
			model.updateMatrixWorld(true);
			box = new THREE.Box3().setFromObject(model);
			size = box.getSize(new THREE.Vector3());
		}

		model.rotation.y += Math.PI;
		model.updateMatrixWorld(true);
		box = new THREE.Box3().setFromObject(model);
		size = box.getSize(new THREE.Vector3());

		if (size.x < 1e-4 || size.y < 1e-4 || size.z < 1e-4) return;

		model.scale.set(
			GOAL_WIDTH / size.x,
			GOAL_HEIGHT / size.y,
			GOAL_DEPTH / size.z,
		);
		model.updateMatrixWorld(true);
		box = new THREE.Box3().setFromObject(model);

		model.position.set(-halfW - box.min.x, -box.min.y, -box.min.z);
	}

	private buildProceduralGoal(parent: THREE.Group): void {
		const { GOAL_WIDTH, GOAL_HEIGHT, GOAL_DEPTH } = RL_ARENA;
		const halfW = GOAL_WIDTH / 2;
		const backH = GOAL_HEIGHT * (5 / 8);
		const r = 0.15;
		const accent = teamAccent(this.team);

		const frameMat = new THREE.MeshStandardMaterial({
			color: 0x222222,
			metalness: 0.8,
			roughness: 0.2,
			emissive: accent,
			emissiveIntensity: 3.8,
		});
		const netMat = createGoalNetMaterial(this.team);

		const top = new THREE.Mesh(
			new THREE.CylinderGeometry(r, r, GOAL_WIDTH, 12),
			frameMat,
		);
		top.rotation.z = Math.PI / 2;
		top.position.set(0, GOAL_HEIGHT, 0);
		parent.add(top);

		for (const sx of [-1, 1] as const) {
			const post = new THREE.Mesh(
				new THREE.CylinderGeometry(r, r, GOAL_HEIGHT, 12),
				frameMat,
			);
			post.position.set(sx * halfW, GOAL_HEIGHT / 2, 0);
			parent.add(post);
		}

		const slopeLen = Math.hypot(GOAL_DEPTH, GOAL_HEIGHT - backH);
		const slopeAng = Math.atan2(GOAL_HEIGHT - backH, GOAL_DEPTH);

		for (const sx of [-1, 1] as const) {
			const rail = new THREE.Mesh(
				new THREE.CylinderGeometry(r, r, slopeLen, 12),
				frameMat,
			);
			rail.position.set(sx * halfW, (GOAL_HEIGHT + backH) / 2, GOAL_DEPTH / 2);
			rail.rotation.x = slopeAng;
			parent.add(rail);

			const floor = new THREE.Mesh(
				new THREE.CylinderGeometry(r, r, GOAL_DEPTH, 12),
				frameMat,
			);
			floor.rotation.x = Math.PI / 2;
			floor.position.set(sx * halfW, 0, GOAL_DEPTH / 2);
			parent.add(floor);
		}

		const roof = new THREE.Mesh(
			new THREE.PlaneGeometry(GOAL_WIDTH, slopeLen),
			netMat,
		);
		roof.position.set(0, (GOAL_HEIGHT + backH) / 2, GOAL_DEPTH / 2);
		roof.rotation.x = slopeAng;
		parent.add(roof);

		const back = new THREE.Mesh(
			new THREE.PlaneGeometry(GOAL_WIDTH, backH),
			netMat.clone(),
		);
		back.position.set(0, backH / 2, GOAL_DEPTH);
		parent.add(back);
	}

	private goalMouthLocalZ(box: THREE.Box3, zSign: 1 | -1): number {
		return zSign > 0 ? box.min.z : box.max.z;
	}

	private applyMountTransform(): void {
		const mouthZ = this.pendingLineZ - this.pendingZSign * GOAL_MOUTH_INSET;

		this.mesh.rotation.set(0, this.pendingZSign < 0 ? Math.PI : 0, 0);
		this.mesh.position.set(0, 0, 0);
		this.mesh.updateMatrixWorld(true);

		const box = new THREE.Box3().setFromObject(this.mesh);
		this.mesh.position.z =
			mouthZ - this.goalMouthLocalZ(box, this.pendingZSign);
	}
}
