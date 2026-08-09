/**
 * Rama bramki — motyw RL: ciężki metalowy portal + energy-field siatka.
 * Neon tylko jako cienka krawędź / wnętrze kieszeni (jak DFH-style).
 */
import * as THREE from "three";

import { RL_ARENA } from "../arenaConstants";
import { createGoalNetMaterial } from "../goalNetMaterial";
import { RL } from "../materials";
import { GOAL_TUBE_R, SOCCAR_GOAL, type GoalShellSide } from "./profiles";

const POST_R = GOAL_TUBE_R;
const EDGE_NEON_R = 0.07;
const RAIL_R = POST_R * 0.78;
const MOUTH_CORNER_R = 1.45;
const TUBE_RADIAL = 12;
const TUBE_TUBULAR = 56;

function metalMat(): THREE.MeshStandardMaterial {
	return new THREE.MeshStandardMaterial({
		color: 0x1a1e28,
		metalness: 0.92,
		roughness: 0.28,
		emissive: 0x080a10,
		emissiveIntensity: 0.35,
		envMapIntensity: 1.65,
	});
}

function edgeNeonMat(team: GoalShellSide): THREE.MeshStandardMaterial {
	const accent = team === "blue" ? RL.goalBlue : RL.goalOrange;
	return new THREE.MeshStandardMaterial({
		color: 0x040608,
		metalness: 0.1,
		roughness: 0.25,
		emissive: accent,
		emissiveIntensity: 3.4,
		toneMapped: false,
		envMapIntensity: 0.25,
	});
}

/** Neon edge — preferuj mat ze StadiumLeds (idle / goal pulse). */
function resolveNeonMat(
	team: GoalShellSide,
	shared?: THREE.MeshStandardMaterial,
): THREE.MeshStandardMaterial {
	return shared ?? edgeNeonMat(team);
}

function roundedRectCurve(
	halfW: number,
	height: number,
	cornerR: number,
	z: number,
	yFloor = 0,
	samplesPerCorner = 16,
	samplesPerEdge = 10,
): THREE.CatmullRomCurve3 {
	const hw = halfW;
	const h = height;
	const r = Math.min(cornerR, hw * 0.42, (h - yFloor) * 0.42);
	const pts: THREE.Vector3[] = [];

	const edge = (ax: number, ay: number, bx: number, by: number) => {
		for (let i = 1; i < samplesPerEdge; i++) {
			const t = i / samplesPerEdge;
			pts.push(
				new THREE.Vector3(ax + (bx - ax) * t, ay + (by - ay) * t, z),
			);
		}
	};

	const arc = (cx: number, cy: number, a0: number, a1: number) => {
		for (let i = 0; i <= samplesPerCorner; i++) {
			const t = i / samplesPerCorner;
			const a = a0 + (a1 - a0) * t;
			pts.push(
				new THREE.Vector3(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z),
			);
		}
	};

	arc(-hw + r, yFloor + r, Math.PI, (Math.PI * 3) / 2);
	edge(-hw + r, yFloor, hw - r, yFloor);
	arc(hw - r, yFloor + r, -Math.PI / 2, 0);
	edge(hw, yFloor + r, hw, h - r);
	arc(hw - r, h - r, 0, Math.PI / 2);
	edge(hw - r, h, -hw + r, h);
	arc(-hw + r, h - r, Math.PI / 2, Math.PI);
	edge(-hw, h - r, -hw, yFloor + r);

	return new THREE.CatmullRomCurve3(pts, true, "catmullrom", 0.04);
}

function addTube(
	parent: THREE.Object3D,
	name: string,
	curve: THREE.Curve<THREE.Vector3>,
	radius: number,
	mat: THREE.Material,
	tubular = TUBE_TUBULAR,
	closed = false,
): THREE.Mesh {
	const mesh = new THREE.Mesh(
		new THREE.TubeGeometry(curve, tubular, radius, TUBE_RADIAL, closed),
		mat,
	);
	mesh.name = name;
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	parent.add(mesh);
	return mesh;
}

function addSphere(
	parent: THREE.Object3D,
	name: string,
	radius: number,
	mat: THREE.Material,
	x: number,
	y: number,
	z: number,
): THREE.Mesh {
	const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 18, 14), mat);
	mesh.name = name;
	mesh.position.set(x, y, z);
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	parent.add(mesh);
	return mesh;
}

/** Lokalny układ: wlot z≈0, głębokość +Z. */
export function buildSoccarGoalFrame(
	parent: THREE.Object3D,
	team: GoalShellSide,
	sharedNeon?: THREE.MeshStandardMaterial,
): THREE.Group {
	const { GOAL_WIDTH, GOAL_HEIGHT, GOAL_DEPTH } = RL_ARENA;
	const halfW = GOAL_WIDTH / 2;
	const group = new THREE.Group();
	group.name = `soccarGoalFrame_${team}`;
	parent.add(group);

	const metal = metalMat();
	const neon = resolveNeonMat(team, sharedNeon);
	const mouthZ = POST_R * 0.2;
	const cornerR = MOUTH_CORNER_R;
	const postX = halfW - POST_R * 0.08;
	const backZ = GOAL_DEPTH - SOCCAR_GOAL.backWallHalf;
	const backH = GOAL_HEIGHT * 0.76;

	/** Ciężki metalowy portal (RL industrial). */
	addTube(
		group,
		`mouthRim_${team}`,
		roundedRectCurve(halfW, GOAL_HEIGHT, cornerR, mouthZ),
		POST_R,
		metal,
		72,
		true,
	);

	/** Cienka neonowa krawędź wewnątrz ust. */
	addTube(
		group,
		`mouthEdgeNeon_${team}`,
		roundedRectCurve(
			halfW - POST_R * 0.85,
			GOAL_HEIGHT - POST_R * 0.65,
			cornerR * 0.9,
			mouthZ - POST_R * 0.55,
			POST_R * 0.55,
		),
		EDGE_NEON_R,
		neon,
		64,
		true,
	);

	/** Kołnierz metal — maskuje cut bandy. */
	addTube(
		group,
		`mouthCollar_${team}`,
		roundedRectCurve(
			halfW + POST_R * 1.1,
			GOAL_HEIGHT + POST_R * 0.95,
			cornerR + POST_R * 0.7,
			mouthZ + POST_R * 0.8,
		),
		POST_R * 0.72,
		metal,
		48,
		true,
	);

	for (const sx of [-1, 1] as const) {
		addSphere(
			group,
			`mouthCornerTop_${team}_${sx > 0 ? "r" : "l"}`,
			POST_R * 1.2,
			metal,
			sx * (halfW - cornerR * 0.18),
			GOAL_HEIGHT - cornerR * 0.18,
			mouthZ,
		);
		addSphere(
			group,
			`mouthCornerBot_${team}_${sx > 0 ? "r" : "l"}`,
			POST_R * 1.1,
			metal,
			sx * (halfW - cornerR * 0.18),
			cornerR * 0.22,
			mouthZ,
		);

		/** Głębokość — metalowe szyny + neon edge. */
		addTube(
			group,
			`depthRail_${team}_${sx > 0 ? "r" : "l"}`,
			new THREE.CatmullRomCurve3([
				new THREE.Vector3(sx * postX, GOAL_HEIGHT - POST_R * 0.08, mouthZ),
				new THREE.Vector3(sx * postX, GOAL_HEIGHT * 0.9, GOAL_DEPTH * 0.4),
				new THREE.Vector3(sx * postX, backH + POST_R * 0.1, backZ),
			]),
			RAIL_R,
			metal,
			28,
		);
		addTube(
			group,
			`depthNeon_${team}_${sx > 0 ? "r" : "l"}`,
			new THREE.CatmullRomCurve3([
				new THREE.Vector3(
					sx * (postX - POST_R * 0.35),
					GOAL_HEIGHT - POST_R * 0.25,
					mouthZ,
				),
				new THREE.Vector3(
					sx * (postX - POST_R * 0.35),
					GOAL_HEIGHT * 0.85,
					GOAL_DEPTH * 0.4,
				),
				new THREE.Vector3(
					sx * (postX - POST_R * 0.35),
					backH,
					backZ - 0.05,
				),
			]),
			EDGE_NEON_R,
			neon,
			28,
		);

		addTube(
			group,
			`floorRail_${team}_${sx > 0 ? "r" : "l"}`,
			new THREE.CatmullRomCurve3([
				new THREE.Vector3(sx * postX, POST_R * 0.95, mouthZ),
				new THREE.Vector3(sx * postX, POST_R * 0.75, GOAL_DEPTH * 0.45),
				new THREE.Vector3(sx * postX, POST_R * 0.9, backZ),
			]),
			RAIL_R * 0.85,
			metal,
			22,
		);

		addTube(
			group,
			`backPost_${team}_${sx > 0 ? "r" : "l"}`,
			new THREE.CatmullRomCurve3([
				new THREE.Vector3(sx * postX, POST_R, backZ),
				new THREE.Vector3(sx * postX, backH * 0.5, backZ),
				new THREE.Vector3(sx * postX, backH, backZ),
			]),
			POST_R * 0.85,
			metal,
			16,
		);

		addSphere(
			group,
			`backCorner_${team}_${sx > 0 ? "r" : "l"}`,
			RAIL_R * 1.3,
			metal,
			sx * postX,
			backH,
			backZ,
		);

		/** Pionowe stripy LED w kieszeni (jak RL interior glow). */
		const strip = new THREE.Mesh(
			new THREE.BoxGeometry(0.08, GOAL_HEIGHT * 0.72, 0.06),
			neon,
		);
		strip.name = `pocketLedStrip_${team}_${sx > 0 ? "r" : "l"}`;
		strip.position.set(
			sx * (halfW - POST_R * 1.6),
			GOAL_HEIGHT * 0.42,
			GOAL_DEPTH * 0.55,
		);
		strip.castShadow = false;
		group.add(strip);
	}

	addTube(
		group,
		`backArch_${team}`,
		new THREE.CatmullRomCurve3([
			new THREE.Vector3(-postX, backH, backZ),
			new THREE.Vector3(0, backH + 0.4, backZ + 0.15),
			new THREE.Vector3(postX, backH, backZ),
		]),
		RAIL_R,
		metal,
		28,
	);

	addTube(
		group,
		`mouthFloorNeon_${team}`,
		new THREE.CatmullRomCurve3([
			new THREE.Vector3(-halfW + cornerR, EDGE_NEON_R * 1.6, 0.04),
			new THREE.Vector3(0, EDGE_NEON_R * 1.5, 0.02),
			new THREE.Vector3(halfW - cornerR, EDGE_NEON_R * 1.6, 0.04),
		]),
		EDGE_NEON_R,
		neon,
		20,
	);

	/** Soft fill light w kieszeni — energy field czytelny. */
	{
		const accent = team === "blue" ? RL.goalBlue : RL.goalOrange;
		const fill = new THREE.PointLight(accent, 2.8, GOAL_DEPTH * 2.4, 1.6);
		fill.name = `goalPocketFill_${team}`;
		fill.position.set(0, GOAL_HEIGHT * 0.55, GOAL_DEPTH * 0.55);
		fill.castShadow = false;
		group.add(fill);
	}

	/** Dach ride — metal. */
	{
		const { RAMP_SIZE } = RL_ARENA;
		const deckW = halfW + POST_R * 2.4;
		const deckDepth = GOAL_DEPTH * 0.42 + RAMP_SIZE * 0.55;
		const deck = new THREE.Mesh(
			new THREE.BoxGeometry(deckW * 2, 0.3, deckDepth),
			metal,
		);
		deck.name = `goalRoofDeck_${team}`;
		deck.position.set(
			0,
			GOAL_HEIGHT + POST_R * 1.02,
			GOAL_DEPTH * 0.18 + RAMP_SIZE * 0.28,
		);
		/** Dach nie rzuca SM — duże płyty = ciemna połowa murawy (klip F9). */
		deck.castShadow = false;
		deck.receiveShadow = true;
		group.add(deck);

		for (const sx of [-1, 1] as const) {
			const fillet = new THREE.Mesh(
				new THREE.CylinderGeometry(
					POST_R * 1.55,
					POST_R * 1.55,
					GOAL_DEPTH * 0.42,
					12,
				),
				metal,
			);
			fillet.name = `goalRoofFillet_${team}_${sx > 0 ? "r" : "l"}`;
			fillet.rotation.x = Math.PI / 2;
			fillet.position.set(
				sx * (halfW + POST_R * 0.85),
				GOAL_HEIGHT + POST_R * 0.32,
				GOAL_DEPTH * 0.22,
			);
			fillet.castShadow = false;
			group.add(fillet);

			const rim = new THREE.Mesh(
				new THREE.TorusGeometry(
					POST_R * 1.3,
					POST_R * 0.5,
					8,
					12,
					Math.PI * 0.5,
				),
				metal,
			);
			rim.name = `goalInteriorRim_${team}_${sx > 0 ? "r" : "l"}`;
			rim.position.set(
				sx * (halfW - POST_R * 0.2),
				GOAL_HEIGHT - POST_R * 0.15,
				mouthZ + POST_R * 0.3,
			);
			rim.rotation.z = sx > 0 ? -Math.PI * 0.5 : Math.PI * 0.5;
			rim.rotation.y = Math.PI * 0.5;
			group.add(rim);
		}
	}

	addNets(group, team);
	return group;
}

function tuneNet(mat: THREE.ShaderMaterial): THREE.ShaderMaterial {
	/** Energy field — wyższa opacity fill, hex w shadery. */
	mat.uniforms.uOpacity.value = 0.78;
	mat.uniforms.uGridScale.value = 10;
	mat.side = THREE.DoubleSide;
	return mat;
}

function addNets(group: THREE.Group, team: GoalShellSide): void {
	const { GOAL_WIDTH, GOAL_HEIGHT, GOAL_DEPTH } = RL_ARENA;
	const halfW = GOAL_WIDTH / 2;
	const backH = GOAL_HEIGHT - POST_R * 0.18;

	group.add(
		buildSlopedNet(
			GOAL_WIDTH * 0.94,
			GOAL_DEPTH * 0.92,
			GOAL_HEIGHT - POST_R * 0.3,
			backH * 0.92,
			tuneNet(createGoalNetMaterial(team)),
			team,
			"Roof",
		),
	);

	const backNet = new THREE.Mesh(
		new THREE.PlaneGeometry(GOAL_WIDTH * 0.92, backH * 0.98, 22, 16),
		tuneNet(createGoalNetMaterial(team)),
	);
	backNet.name = `goalNetBack_${team}`;
	const bp = backNet.geometry.attributes.position;
	for (let i = 0; i < bp.count; i++) {
		const x = bp.getX(i);
		bp.setZ(i, (1 - (x / (halfW * 0.92)) ** 2) * 0.38);
	}
	backNet.geometry.computeVertexNormals();
	backNet.position.set(0, backH * 0.5, GOAL_DEPTH - 0.1);
	group.add(backNet);

	for (const sx of [-1, 1] as const) {
		const sideNet = new THREE.Mesh(
			new THREE.PlaneGeometry(GOAL_DEPTH * 0.9, GOAL_HEIGHT * 0.9, 18, 16),
			tuneNet(createGoalNetMaterial(team)),
		);
		sideNet.name = `goalNetSide_${team}_${sx > 0 ? "r" : "l"}`;
		const sp = sideNet.geometry.attributes.position;
		for (let i = 0; i < sp.count; i++) {
			const zLocal = sp.getX(i);
			const t = (zLocal / (GOAL_DEPTH * 0.45) + 1) * 0.5;
			sp.setZ(i, Math.sin(Math.max(0, Math.min(1, t)) * Math.PI) * 0.25);
		}
		sideNet.geometry.computeVertexNormals();
		sideNet.position.set(
			sx * (halfW - POST_R * 0.9),
			GOAL_HEIGHT * 0.46,
			GOAL_DEPTH * 0.48,
		);
		sideNet.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
		group.add(sideNet);
	}
}

function buildSlopedNet(
	width: number,
	depth: number,
	frontY: number,
	backY: number,
	mat: THREE.ShaderMaterial,
	team: GoalShellSide,
	kind: string,
): THREE.Mesh {
	const segsW = 22;
	const segsD = 18;
	const positions: number[] = [];
	const uvs: number[] = [];
	const indices: number[] = [];

	for (let j = 0; j <= segsD; j++) {
		const tj = j / segsD;
		const z = tj * depth;
		const y = THREE.MathUtils.lerp(frontY, backY, tj);
		for (let i = 0; i <= segsW; i++) {
			const ti = i / segsW;
			const x = (ti - 0.5) * width;
			const arch = Math.sin(ti * Math.PI) * 0.2 * (1 - tj * 0.45);
			positions.push(x, y + arch, z);
			uvs.push(ti, tj);
		}
	}
	for (let j = 0; j < segsD; j++) {
		for (let i = 0; i < segsW; i++) {
			const a = j * (segsW + 1) + i;
			const b = a + 1;
			const c = a + (segsW + 1);
			const d = c + 1;
			indices.push(a, c, b, b, c, d);
		}
	}

	const geo = new THREE.BufferGeometry();
	geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
	geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
	geo.setIndex(indices);
	geo.computeVertexNormals();

	const mesh = new THREE.Mesh(geo, mat);
	mesh.name = `goalNet${kind}_${team}`;
	return mesh;
}
