/**
 * Tag meshes for three-realtime-rt BVH.
 * Bez ArenaRtProxy. Stadium meshy / grass / VFX = rtExclude.
 * NIGDY layers.set.
 */

import * as THREE from "three";

const HARD_EXCLUDE =
	/full_rl_stadium|grass|blade|crowd|seat|sky|city|nebula|haze|boost|trail|spark|flame|streak|afterimage|beam|laser|pyro|gobo|smoke|show|jumbo|banner|led|wire|neon|reflector|planar|atmosphere|shaft|jupiter|overlay|aura|shadow|particle|meshy_raw|decoration|parallax|drone|prematch|energy.?field|vector.?overlay|arenaRtProxy/i;

function isAlwaysKeep(obj: THREE.Mesh): boolean {
	const n = `${obj.name} ${obj.parent?.name ?? ""}`.toLowerCase();
	if (/pitchfloor|pitch_floor/.test(n)) return true;
	if (/ball/.test(n) || obj.userData?.isBall) return true;
	if (/car|chassis|octane|vehicle|player/.test(n) || obj.userData?.isCar)
		return true;
	if (
		/soccar.?goal|goalframe|goal_frame|goalnet|backboard|goalpocket|goalframeshell|goalvisual|mouthrim|mouthcollar|wallramp|wallupper|^ceiling$/i.test(
			n,
		)
	) {
		return true;
	}
	return false;
}

function bvhPriority(obj: THREE.Mesh): number {
	const n = `${obj.name} ${obj.parent?.name ?? ""}`.toLowerCase();
	if (/ball/.test(n) || obj.userData?.isBall) return 100;
	if (/car|chassis|octane|vehicle|player/.test(n) || obj.userData?.isCar)
		return 90;
	if (/pitchfloor|pitch_floor/.test(n)) return 85;
	if (/goal|net|backboard|soccar|mouth|pocket|wallramp|wallupper|ceiling/.test(n))
		return 55;
	if (/wall|ramp|cage/.test(n)) return 40;
	return 5;
}

const MAX_STATIC_VERTS = 180_000;
const MAX_DYNAMIC_MESHES = 48;

export function tagSceneForRealtimeRt(scene: THREE.Scene): {
	excluded: number;
	dynamic: THREE.Mesh[];
	staticVerts: number;
} {
	let excluded = 0;
	const candidates: { mesh: THREE.Mesh; verts: number; pri: number }[] = [];
	const dynamic: THREE.Mesh[] = [];

	scene.traverse((obj) => {
		if (obj instanceof THREE.Points || obj instanceof THREE.Sprite) {
			obj.userData.rtExclude = true;
			excluded++;
			return;
		}
		if (obj instanceof THREE.InstancedMesh) {
			obj.userData.rtExclude = true;
			excluded++;
			return;
		}
		if (!(obj instanceof THREE.Mesh)) return;

		const n = obj.name || "";
		const parentN = obj.parent?.name || "";
		const label = `${n} ${parentN}`;

		if (obj.userData?.arenaRtProxy === true || /arenaRtProxy/i.test(label)) {
			obj.userData.rtExclude = true;
			excluded++;
			return;
		}

		if (HARD_EXCLUDE.test(label) && !isAlwaysKeep(obj)) {
			obj.userData.rtExclude = true;
			excluded++;
			return;
		}

		const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
		for (const m of mats) {
			if (
				m &&
				(m.blending === THREE.AdditiveBlending ||
					m.blending === THREE.MultiplyBlending ||
					(m.transparent && m.opacity < 0.35))
			) {
				obj.userData.rtExclude = true;
				excluded++;
				return;
			}
			if (
				m instanceof THREE.MeshStandardMaterial &&
				m.emissiveIntensity > 0.4 &&
				m.emissive.getHex() !== 0 &&
				!isAlwaysKeep(obj)
			) {
				obj.userData.rtExclude = true;
				excluded++;
				return;
			}
		}

		const pos = obj.geometry?.getAttribute("position");
		const verts = pos?.count ?? 0;
		if (verts > 80_000 && !isAlwaysKeep(obj)) {
			obj.userData.rtExclude = true;
			excluded++;
			return;
		}

		obj.userData.rtExclude = true;
		candidates.push({ mesh: obj, verts, pri: bvhPriority(obj) });
	});

	candidates.sort((a, b) => b.pri - a.pri || a.verts - b.verts);

	let staticVerts = 0;
	const allowed = new Set<THREE.Mesh>();
	for (const c of candidates) {
		const keep = c.pri >= 55 || isAlwaysKeep(c.mesh);
		if (!keep && staticVerts + c.verts > MAX_STATIC_VERTS) {
			excluded++;
			continue;
		}
		if (staticVerts + c.verts > MAX_STATIC_VERTS * 1.4 && c.pri < 85) {
			excluded++;
			continue;
		}
		allowed.add(c.mesh);
		staticVerts += c.verts;
	}

	for (const c of candidates) {
		if (!allowed.has(c.mesh)) continue;
		c.mesh.userData.rtExclude = false;
		excluded = Math.max(0, excluded - 1);

		let p: THREE.Object3D | null = c.mesh;
		while (p) {
			const pn = (p.name || "").toLowerCase();
			if (
				/car|chassis|body|ball|octane|vehicle|player/i.test(pn) ||
				p.userData?.isCar === true ||
				p.userData?.isBall === true
			) {
				if (dynamic.length < MAX_DYNAMIC_MESHES) dynamic.push(c.mesh);
				break;
			}
			p = p.parent;
		}
	}

	return { excluded, dynamic, staticVerts };
}

export function sceneTopologySignature(scene: THREE.Scene): string {
	let meshes = 0;
	let verts = 0;
	scene.traverse((obj) => {
		if (!(obj instanceof THREE.Mesh) || obj.userData?.rtExclude) return;
		meshes++;
		const pos = obj.geometry?.getAttribute("position");
		if (pos) verts += pos.count;
	});
	return `${meshes}:${verts}`;
}
