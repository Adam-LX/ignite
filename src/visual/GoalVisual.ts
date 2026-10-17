/**
 * Bramka RL — Trellis GLB (decor) fit do AABB SoccarShell.
 * Colliders / interior = goalPocket + soccarShell (nie GLB).
 */
import * as THREE from "three";

import { assetUrl } from "../util/assetUrl";
import { createGltfLoader } from "../util/gltfLoader";
import { RL_ARENA } from "./arenaConstants";
import { createGoalNetMaterial } from "./goalNetMaterial";
import { buildSoccarGoalFrame } from "./soccarShell/goalFrameVisual";
import type { GoalShellSide } from "./soccarShell/profiles";

/** Front bramki dokładnie na linii końcowej. */
export const GOAL_MOUTH_INSET = 0;

const GOAL_GLB_STANDARD = "/assets/arenas/standard/props/goalFrame.glb";

/**
 * Domyślnie SoccarShell (rury). Rodin/Trellis GLB: `?trellisGoal=1`
 * albo po `./scripts/install-rodin-goal.sh` ustaw FORCE poniżej.
 */
const FORCE_GLB_GOAL = false;

function preferGlbGoal(): boolean {
	if (FORCE_GLB_GOAL) return true;
	if (typeof window === "undefined") return false;
	try {
		return new URLSearchParams(window.location.search).get("trellisGoal") === "1";
	} catch {
		return false;
	}
}

function teamAccent(team: GoalShellSide): number {
	return team === "blue" ? 0x00f0ff : 0xff5500;
}

function isGoalNetMesh(name: string): boolean {
	const n = name.toLowerCase();
	return n.includes("net") || n.includes("siat") || n.includes("wire");
}

function isGoalFloorMesh(name: string): boolean {
	const n = name.toLowerCase();
	return (
		n.includes("floor") ||
		n.includes("ground") ||
		n.includes("podlog") ||
		n.includes("base_plate") ||
		n.includes("baseplate") ||
		n.includes("deck") ||
		n.includes("scaffold") ||
		n.includes("pipe")
	);
}

export class GoalVisual {
	readonly mesh: THREE.Group;
	private readonly team: GoalShellSide;
	private readonly sharedNeon: THREE.MeshStandardMaterial | undefined;
	private pendingLineZ = 0;
	private pendingZSign: 1 | -1 = 1;

	constructor(
		team: GoalShellSide = "blue",
		sharedNeon?: THREE.MeshStandardMaterial,
	) {
		this.team = team;
		this.sharedNeon = sharedNeon;
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
		/** SoccarShell tubular — source of truth look (1:1 colliders, zero corner holes). */
		const shell = buildSoccarGoalFrame(this.mesh, this.team, this.sharedNeon);
		shell.name = "goalFrameShell";

		if (!preferGlbGoal()) return;

		const loader = createGltfLoader();
		loader.load(
			assetUrl(GOAL_GLB_STANDARD),
			(gltf) => {
				const model = gltf.scene;
				model.name = "goalFrameTrellis";
				this.applyTeamMaterials(model);
				this.fitGoalFrame(model);
				this.hideEmbeddedFloorPlates(model);
				this.stripMouthFillers(model);
				if (!this.trellisLooksUsable(model)) {
					console.warn(
						"Ignite: goalFrame.glb odrzucony (jakość) — zostaje SoccarShell",
					);
					return;
				}
				shell.visible = false;
				this.mesh.add(model);
				this.addSoccarNets();
				this.applyMountTransform();
			},
			undefined,
			() => {
				console.warn("Ignite: brak goalFrame.glb — SoccarShell");
			},
		);
	}

	/**
	 * Odrzuć Trellis gdy mesh jest „pudełkami” / wypełnia usta /
	 * ma za mało geometrii (typowe po słabym concepcie).
	 */
	private trellisLooksUsable(root: THREE.Object3D): boolean {
		let meshCount = 0;
		let triApprox = 0;
		const size = new THREE.Vector3();
		root.updateMatrixWorld(true);
		const box = new THREE.Box3().setFromObject(root);
		box.getSize(size);
		if (size.x < RL_ARENA.GOAL_WIDTH * 0.7) return false;
		if (size.y < RL_ARENA.GOAL_HEIGHT * 0.7) return false;
		root.traverse((child) => {
			if (!(child instanceof THREE.Mesh) || !child.visible) return;
			meshCount++;
			const pos = child.geometry?.getAttribute("position");
			if (pos) triApprox += Math.floor(pos.count / 3);
		});
		/** Puste / ultra-lowpoly = śmieć. */
		if (meshCount < 1 || triApprox < 80) return false;
		return true;
	}

	/** Siatka zawsze z kodu — Trellis robi tylko ramę (hollow mouth). */
	private addSoccarNets(): void {
		const { GOAL_WIDTH, GOAL_HEIGHT, GOAL_DEPTH } = RL_ARENA;
		const netMat = createGoalNetMaterial(this.team);
		const backH = GOAL_HEIGHT * 0.62;
		const slopeLen = Math.hypot(GOAL_DEPTH * 0.92, GOAL_HEIGHT - backH);
		const slopeAng = Math.atan2(GOAL_HEIGHT - backH, GOAL_DEPTH * 0.92);
		const halfW = GOAL_WIDTH / 2;

		const roof = new THREE.Mesh(
			new THREE.PlaneGeometry(GOAL_WIDTH * 0.96, slopeLen),
			netMat,
		);
		roof.name = `goalNetRoof_${this.team}`;
		roof.position.set(0, (GOAL_HEIGHT + backH) * 0.5, GOAL_DEPTH * 0.48);
		roof.rotation.x = slopeAng;
		this.mesh.add(roof);

		const backNet = new THREE.Mesh(
			new THREE.PlaneGeometry(GOAL_WIDTH * 0.94, backH),
			netMat.clone(),
		);
		backNet.name = `goalNetBack_${this.team}`;
		backNet.position.set(0, backH * 0.5, GOAL_DEPTH - 0.08);
		this.mesh.add(backNet);

		for (const sx of [-1, 1] as const) {
			const sideNet = new THREE.Mesh(
				new THREE.PlaneGeometry(GOAL_DEPTH * 0.9, GOAL_HEIGHT * 0.9),
				netMat.clone(),
			);
			sideNet.name = `goalNetSide_${this.team}_${sx > 0 ? "r" : "l"}`;
			sideNet.position.set(
				sx * (halfW - 0.12),
				GOAL_HEIGHT * 0.45,
				GOAL_DEPTH * 0.48,
			);
			sideNet.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
			this.mesh.add(sideNet);
		}
	}

	private applyTeamMaterials(root: THREE.Object3D): void {
		const accent = teamAccent(this.team);
		const accentCol = new THREE.Color(accent);
		root.traverse((child) => {
			if (!(child instanceof THREE.Mesh)) return;
			/** Rama bramki bez SM — słupy rzucały twarde plamy tylko przy jednej bramce. */
			child.castShadow = false;
			child.receiveShadow = true;

			if (isGoalNetMesh(child.name)) {
				child.material = createGoalNetMaterial(this.team);
				child.castShadow = false;
				child.receiveShadow = false;
				return;
			}
			if (isGoalFloorMesh(child.name)) {
				child.visible = false;
				return;
			}

			const mats = Array.isArray(child.material)
				? child.material
				: [child.material];
			for (const mat of mats) {
				if (!(mat instanceof THREE.MeshStandardMaterial)) continue;
				/** Zachowaj Trellis albedo / metal — tylko tint team + night-safe. */
				if (!mat.map) {
					mat.color.lerp(new THREE.Color(0x141820), 0.35);
				}
				mat.metalness = Math.max(mat.metalness, 0.55);
				mat.roughness = Math.min(Math.max(mat.roughness, 0.22), 0.55);
				mat.envMapIntensity = Math.max(mat.envMapIntensity, 1.15);
				const e = mat.emissive.clone();
				const lum = e.r * 0.3 + e.g * 0.6 + e.b * 0.1;
				if (lum < 0.08) {
					mat.emissive.copy(accentCol);
					mat.emissiveIntensity = 0.85;
				} else {
					mat.emissive.lerp(accentCol, this.team === "orange" ? 0.55 : 0.25);
					mat.emissiveIntensity = Math.max(mat.emissiveIntensity, 1.05);
				}
				mat.transparent = false;
				mat.opacity = 1;
				mat.side = THREE.FrontSide;
			}
		});
	}

	/** Fit do GOAL_WIDTH × HEIGHT × DEPTH — colliders = source of truth. */
	private fitGoalFrame(model: THREE.Object3D): void {
		const { GOAL_WIDTH, GOAL_HEIGHT, GOAL_DEPTH } = RL_ARENA;
		const halfW = GOAL_WIDTH / 2;

		model.position.set(0, 0, 0);
		model.rotation.set(0, 0, 0);
		model.scale.set(1, 1, 1);
		model.updateMatrixWorld(true);

		let box = new THREE.Box3().setFromObject(model);
		let size = box.getSize(new THREE.Vector3());
		if (size.z > size.x * 1.15) {
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
		model.position.set(
			-halfW - box.min.x,
			-box.min.y - 0.04,
			-box.min.z,
		);
		this.hideEmbeddedFloorPlates(model);
	}

	private hideEmbeddedFloorPlates(root: THREE.Object3D): void {
		const size = new THREE.Vector3();
		root.updateMatrixWorld(true);
		const rootBox = new THREE.Box3().setFromObject(root);
		const ySpan = Math.max(1e-3, rootBox.max.y - rootBox.min.y);
		root.traverse((child) => {
			if (!(child instanceof THREE.Mesh) || !child.visible) return;
			if (isGoalNetMesh(child.name)) return;
			if (isGoalFloorMesh(child.name)) {
				child.visible = false;
				return;
			}
			child.geometry?.computeBoundingBox();
			const gb = child.geometry?.boundingBox;
			if (!gb) return;
			const world = gb.clone().applyMatrix4(child.matrixWorld);
			world.getSize(size);
			const flat =
				size.y < ySpan * 0.22 &&
				size.x > RL_ARENA.GOAL_WIDTH * 0.28 &&
				size.z > RL_ARENA.GOAL_DEPTH * 0.16;
			const nearBottom = world.max.y < rootBox.min.y + ySpan * 0.32;
			if (flat && nearBottom) child.visible = false;
		});
	}

	/**
	 * Trellis często wypełnia wlot „ścianą” / kratą — wytnij duże płyty
	 * stojące w ustach bramki (blokują wjazd wizualnie + „dziury”).
	 */
	private stripMouthFillers(root: THREE.Object3D): void {
		const size = new THREE.Vector3();
		root.updateMatrixWorld(true);
		const rootBox = new THREE.Box3().setFromObject(root);
		const zSpan = Math.max(1e-3, rootBox.max.z - rootBox.min.z);
		const mouthZ = rootBox.min.z + zSpan * 0.22;
		root.traverse((child) => {
			if (!(child instanceof THREE.Mesh) || !child.visible) return;
			if (isGoalNetMesh(child.name)) return;
			child.geometry?.computeBoundingBox();
			const gb = child.geometry?.boundingBox;
			if (!gb) return;
			const world = gb.clone().applyMatrix4(child.matrixWorld);
			world.getSize(size);
			const inMouth = world.max.z < mouthZ;
			const wallFill =
				size.x > RL_ARENA.GOAL_WIDTH * 0.55 &&
				size.y > RL_ARENA.GOAL_HEIGHT * 0.45 &&
				size.z < RL_ARENA.GOAL_DEPTH * 0.2;
			if (inMouth && wallFill) child.visible = false;
		});
	}

	private applyMountTransform(): void {
		const mouthZ = this.pendingLineZ - this.pendingZSign * GOAL_MOUTH_INSET;
		this.mesh.rotation.set(0, this.pendingZSign < 0 ? Math.PI : 0, 0);
		this.mesh.position.set(0, 0, 0);
		this.mesh.updateMatrixWorld(true);
		const box = new THREE.Box3().setFromObject(this.mesh);
		const mouthLocalZ =
			this.pendingZSign > 0 ? box.min.z : box.max.z;
		this.mesh.position.z = mouthZ - mouthLocalZ;
	}
}
