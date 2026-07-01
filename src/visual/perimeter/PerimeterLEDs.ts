import * as THREE from "three";

import {
	LED_LIGHT_COUNT,
	LED_POINT_DISTANCE,
	LED_POINT_INTENSITY,
	LED_STRIP_LIFT,
	LED_STRIP_WIDTH,
	RAMP_BASE_Y,
	RAMP_RUN,
	RAMP_TOP_Y,
} from "./constants";
import { isGoalMouthSegment, outerAt } from "./ribbon";
import type { RibbonMeshData, RibbonVertex } from "./types";

function pushTri(indices: number[], a: number, b: number, c: number): void {
	indices.push(a, b, c);
}

const whiteLedMat = new THREE.MeshStandardMaterial({
	color: 0xffffff,
	emissive: 0xffffff,
	emissiveIntensity: 4.0,
	roughness: 0.05,
	metalness: 0.15,
	side: THREE.DoubleSide,
	depthWrite: true,
});

import type { CrowdSurgeKind } from "../crowdSurge";

const perimeterLedLights: THREE.PointLight[] = [];
const _pulseColor = new THREE.Color(0xffffff);
const _surgeColor = new THREE.Color(0xffffff);
let surgeStrength = 0;
let surgeWave = 0;
let surgeKind: CrowdSurgeKind | null = null;

function buildEdgeStripGeometry(
	ribbon: RibbonVertex[],
	edge: "bottom" | "top",
): RibbonMeshData {
	const positions: number[] = [];
	const indices: number[] = [];
	const n = ribbon.length;
	const halfW = LED_STRIP_WIDTH * 0.5;

	for (let i = 0; i < n; i++) {
		const j = (i + 1) % n;
		if (isGoalMouthSegment(ribbon[i], ribbon[j])) continue;

		const a = ribbon[i];
		const b = ribbon[j];

		let ax: number;
		let az: number;
		let bx: number;
		let bz: number;
		let y: number;

		if (edge === "bottom") {
			y = RAMP_BASE_Y + LED_STRIP_LIFT;
			ax = a.x;
			az = a.z;
			bx = b.x;
			bz = b.z;
		} else {
			const oa = outerAt(a);
			const ob = outerAt(b);
			y = RAMP_TOP_Y + LED_STRIP_LIFT;
			ax = oa.x;
			az = oa.z;
			bx = ob.x;
			bz = ob.z;
		}

		const dx = bx - ax;
		const dz = bz - az;
		const len = Math.hypot(dx, dz);
		if (len < 0.05) continue;

		const nx = (-dz / len) * halfW;
		const nz = (dx / len) * halfW;

		const base = positions.length / 3;
		positions.push(
			ax - nx,
			y,
			az - nz,
			ax + nx,
			y,
			az + nz,
			bx + nx,
			y,
			bz + nz,
			bx - nx,
			y,
			bz - nz,
		);
		pushTri(indices, base, base + 1, base + 2);
		pushTri(indices, base, base + 2, base + 3);
	}

	return {
		positions: new Float32Array(positions),
		indices: new Uint32Array(indices),
		groups: [],
	};
}

function addStripMesh(
	parent: THREE.Group,
	data: RibbonMeshData,
	name: string,
): void {
	if (data.indices.length === 0) return;
	const geo = new THREE.BufferGeometry();
	geo.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
	geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
	geo.computeVertexNormals();

	const mesh = new THREE.Mesh(geo, whiteLedMat);
	mesh.name = name;
	mesh.castShadow = false;
	mesh.receiveShadow = false;
	mesh.frustumCulled = false;
	mesh.renderOrder = 10;
	parent.add(mesh);
}

/** Białe paski LED na dolnej i górnej krawędzi ramp + PointLights oświetlające otoczenie. */
export class PerimeterLEDs {
	readonly material = whiteLedMat;

	clearLights(): void {
		perimeterLedLights.length = 0;
	}

	addToScene(stadium: THREE.Group, ribbon: RibbonVertex[]): THREE.Group {
		const group = new THREE.Group();
		group.name = "perimeterNeonLeds";

		addStripMesh(
			group,
			buildEdgeStripGeometry(ribbon, "bottom"),
			"rampNeonBottom",
		);
		addStripMesh(group, buildEdgeStripGeometry(ribbon, "top"), "rampNeonTop");

		stadium.add(group);
		this.addPointLights(stadium, ribbon);
		return group;
	}

	private addPointLights(stadium: THREE.Group, ribbon: RibbonVertex[]): void {
		perimeterLedLights.length = 0;
		const lightGroup = new THREE.Group();
		lightGroup.name = "perimeterLedLights";

		const spots: { x: number; y: number; z: number }[] = [];
		const n = ribbon.length;
		const lightY = RAMP_TOP_Y * 0.55;

		for (let i = 0; i < n; i++) {
			const j = (i + 1) % n;
			if (isGoalMouthSegment(ribbon[i], ribbon[j])) continue;

			const ax = ribbon[i].x;
			const az = ribbon[i].z;
			const bx = ribbon[j].x;
			const bz = ribbon[j].z;
			const mx = (ax + bx) * 0.5;
			const mz = (az + bz) * 0.5;
			const outX = (ribbon[i].outX + ribbon[j].outX) * 0.5;
			const outZ = (ribbon[i].outZ + ribbon[j].outZ) * 0.5;
			spots.push({
				x: mx + outX * RAMP_RUN * 0.42,
				y: lightY,
				z: mz + outZ * RAMP_RUN * 0.42,
			});
		}

		if (spots.length === 0) return;

		for (let k = 0; k < LED_LIGHT_COUNT; k++) {
			const spot =
				spots[Math.floor((k * spots.length) / LED_LIGHT_COUNT)] ?? spots[0];
			const light = new THREE.PointLight(
				0xffffff,
				LED_POINT_INTENSITY,
				LED_POINT_DISTANCE,
			);
			light.position.set(spot.x, spot.y, spot.z);
			light.castShadow = false;
			lightGroup.add(light);
			perimeterLedLights.push(light);
		}

		stadium.add(lightGroup);
	}

	/** Pulsacja białych neonów i synchronizacja PointLightów. */
	update(_timeSec: number): void {
		const basePulse = 3.2 + Math.sin(Date.now() * 0.005) * 1.2;
		const surgeBoost =
			surgeStrength > 0
				? surgeStrength *
					(0.65 + 0.35 * Math.sin(Date.now() * 0.012 + surgeWave * 3.5))
				: 0;
		const pulse = basePulse + surgeBoost * 5.5;
		whiteLedMat.emissiveIntensity = pulse;
		if (surgeStrength > 0) {
			whiteLedMat.emissive.copy(_surgeColor);
		} else {
			whiteLedMat.emissive.setHex(0xffffff);
		}
		_pulseColor.setRGB(pulse / 4, pulse / 4, pulse / 4);
		for (let i = 0; i < perimeterLedLights.length; i++) {
			const light = perimeterLedLights[i]!;
			const travel =
				surgeKind === "supersonic" || surgeKind === "demolish"
					? 0.35 + 0.65 * Math.max(0, Math.sin(surgeWave - i * 0.55))
					: 0.8 + 0.2 * Math.sin(Date.now() * 0.005 + i);
			light.intensity =
				LED_POINT_INTENSITY *
				(0.75 + 0.25 * Math.sin(Date.now() * 0.005)) *
				(1 + surgeBoost * 1.35 * travel);
			if (surgeStrength > 0) {
				light.color.copy(_surgeColor).lerp(_pulseColor, 0.25);
			} else {
				light.color.copy(_pulseColor);
			}
		}
	}

	beginSurge(color: THREE.Color, strength: number, kind: CrowdSurgeKind): void {
		_surgeColor.copy(color);
		surgeStrength = strength;
		surgeWave = 0;
		surgeKind = kind;
	}

	endSurge(): void {
		surgeStrength = 0;
		surgeWave = 0;
		surgeKind = null;
	}

	updateSurge(
		_surge: { elapsed: number },
		envelope: { mix: number; wave: number },
		_timeSec: number,
	): void {
		surgeStrength = Math.max(0, envelope.mix);
		surgeWave = envelope.wave;
	}
}

export const perimeterLEDs = new PerimeterLEDs();

export function updateRampSeamLeds(timeSec: number): void {
	perimeterLEDs.update(timeSec);
}
