import * as THREE from "three";
import { getArenaBallFocus } from "./arenaBallFocus";
import { RL_ARENA } from "./arenaConstants";
import { glowTexture } from "./vfx/glowTexture";
import { createDroneVolumetricLightMaterial } from "./volumetricBeam";

const DRONE_COUNT = 8;
const DRONE_SCALE = 2.6;
const BEAM_LENGTH = 42;
const BEAM_RADIUS = 11;
const BEAM_OPACITY_BASE = 0.18;
const SKY_TARGET_LIFT = 88;
const SKY_SWEEP_RADIUS = 32;

const DRONE_BODY = new THREE.MeshStandardMaterial({
	color: 0x142030,
	emissive: 0x2a5080,
	emissiveIntensity: 1.4,
	roughness: 0.32,
	metalness: 0.82,
});

const DRONE_RING = new THREE.MeshStandardMaterial({
	color: 0x081018,
	emissive: 0x00d4ff,
	emissiveIntensity: 4.5,
	roughness: 0.18,
	metalness: 0.7,
});

const DRONE_LENS = new THREE.MeshStandardMaterial({
	color: 0xffffff,
	emissive: 0xe8f4ff,
	emissiveIntensity: 6.0,
	roughness: 0.04,
	metalness: 0.08,
});

type SkyDrone = {
	rig: THREE.Group;
	beamPivot: THREE.Group;
	spot: THREE.SpotLight;
	beam: THREE.Mesh;
	beamMat: THREE.ShaderMaterial;
	glow: THREE.Sprite;
	rotors: THREE.Mesh[];
	orbitCx: number;
	orbitCz: number;
	orbitRx: number;
	orbitRz: number;
	orbitSpeed: number;
	orbitPhase: number;
	heightBase: number;
	heightAmp: number;
	sweepSpeed: number;
	sweepPhase: number;
	sweepRadius: number;
	hue: number;
	skyAimPoint: THREE.Vector3;
};

export type SkyDroneRig = {
	root: THREE.Group;
	drones: SkyDrone[];
};

const _lensLocal = new THREE.Vector3(0, -0.12, 0.38);
const _skyTarget = new THREE.Vector3();

function seededRandom(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 0x1_0000_0000;
	};
}

function buildDroneMesh(hue: number): {
	body: THREE.Group;
	glow: THREE.Sprite;
	rotors: THREE.Mesh[];
} {
	const body = new THREE.Group();
	body.name = "skyDroneBody";

	const core = new THREE.Mesh(
		new THREE.BoxGeometry(1.1, 0.28, 1.1),
		DRONE_BODY,
	);
	core.frustumCulled = false;
	body.add(core);

	const ringMat = DRONE_RING.clone();
	ringMat.emissive = new THREE.Color().setHSL(hue, 0.85, 0.55);
	const ring = new THREE.Mesh(
		new THREE.TorusGeometry(0.72, 0.06, 8, 24),
		ringMat,
	);
	ring.rotation.x = Math.PI / 2;
	ring.position.y = 0.08;
	ring.frustumCulled = false;
	body.add(ring);

	const lensMat = DRONE_LENS.clone();
	lensMat.emissive = new THREE.Color().setHSL(hue, 0.55, 0.82);
	const lens = new THREE.Mesh(
		new THREE.CylinderGeometry(0.18, 0.24, 0.14, 10),
		lensMat,
	);
	lens.position.set(0, -0.2, 0.42);
	lens.frustumCulled = false;
	body.add(lens);

	const rotors: THREE.Mesh[] = [];
	const armGeo = new THREE.BoxGeometry(0.08, 0.05, 0.72);
	for (const [x, z] of [
		[-0.55, -0.55],
		[0.55, -0.55],
		[-0.55, 0.55],
		[0.55, 0.55],
	] as const) {
		const arm = new THREE.Mesh(armGeo, DRONE_BODY);
		arm.position.set(x, 0.02, z);
		arm.frustumCulled = false;
		body.add(arm);

		const rotor = new THREE.Mesh(
			new THREE.CylinderGeometry(0.22, 0.22, 0.035, 8),
			ringMat,
		);
		rotor.position.set(x, 0.1, z);
		rotor.frustumCulled = false;
		body.add(rotor);
		rotors.push(rotor);
	}

	const glow = new THREE.Sprite(
		new THREE.SpriteMaterial({
			map: glowTexture(),
			color: new THREE.Color().setHSL(hue, 0.82, 0.62),
			transparent: true,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			fog: false,
			opacity: 0.85,
		}),
	);
	glow.scale.set(4.2, 4.2, 1);
	glow.position.y = 0.15;
	glow.renderOrder = 8;
	body.add(glow);

	return { body, glow, rotors };
}

/** Cel snopu ponad stadionem — omiatanie nieba, bez pada na murawę. */
function pickSkyTarget(
	drone: SkyDrone,
	droneX: number,
	droneY: number,
	droneZ: number,
	timeSec: number,
	out: THREE.Vector3,
): void {
	const sweep = timeSec * drone.sweepSpeed + drone.sweepPhase;
	const hw = RL_ARENA.HALF_WIDTH * 1.15;
	const hl = RL_ARENA.HALF_LENGTH * 1.15;
	out.set(
		THREE.MathUtils.clamp(
			droneX + Math.sin(sweep) * drone.sweepRadius,
			-hw,
			hw,
		),
		droneY + SKY_TARGET_LIFT + Math.sin(sweep * 0.43 + drone.orbitPhase) * 14,
		THREE.MathUtils.clamp(
			droneZ + Math.cos(sweep * 1.17) * drone.sweepRadius * 0.85,
			-hl,
			hl,
		),
	);
}

function createSkyDrone(index: number, rand: () => number): SkyDrone {
	const hue = 0.52 + rand() * 0.28;
	const color = new THREE.Color().setHSL(hue, 0.7, 0.62);

	const rig = new THREE.Group();
	rig.name = `skyDrone${index + 1}`;
	rig.scale.setScalar(DRONE_SCALE);
	rig.frustumCulled = false;

	const { body, glow, rotors } = buildDroneMesh(hue);
	rig.add(body);

	const beamPivot = new THREE.Group();
	beamPivot.name = "beamPivot";
	beamPivot.position.copy(_lensLocal);
	rig.add(beamPivot);

	const spot = new THREE.SpotLight(color, 1.2, 0, Math.PI / 6, 0.82, 1.1);
	spot.castShadow = false;
	spot.position.set(0, 0, 0);
	beamPivot.add(spot);

	const beamMat = createDroneVolumetricLightMaterial(
		color,
		BEAM_OPACITY_BASE * (0.88 + rand() * 0.24),
		BEAM_LENGTH,
	);
	const beamGeo = new THREE.ConeGeometry(BEAM_RADIUS, BEAM_LENGTH, 24, 6, true);
	beamGeo.translate(0, -BEAM_LENGTH * 0.5, 0);
	const beam = new THREE.Mesh(beamGeo, beamMat);
	beam.rotation.x = -Math.PI / 2;
	beam.renderOrder = 6;
	beam.frustumCulled = false;
	beamPivot.add(beam);

	const hw = RL_ARENA.HALF_WIDTH;
	const hl = RL_ARENA.HALF_LENGTH;
	const orbitCx = THREE.MathUtils.lerp(-hw * 0.25, hw * 0.25, rand());
	const orbitCz = THREE.MathUtils.lerp(-hl * 0.25, hl * 0.25, rand());

	return {
		rig,
		beamPivot,
		spot,
		beam,
		beamMat,
		glow,
		rotors,
		orbitCx,
		orbitCz,
		orbitRx: THREE.MathUtils.lerp(hw * 0.55, hw * 0.88, rand()),
		orbitRz: THREE.MathUtils.lerp(hl * 0.5, hl * 0.82, rand()),
		orbitSpeed: 0.05 + rand() * 0.06,
		orbitPhase: rand() * Math.PI * 2,
		heightBase: 14 + rand() * 10,
		heightAmp: 2.5 + rand() * 4,
		sweepSpeed: 0.3 + rand() * 0.4,
		sweepPhase: rand() * Math.PI * 2,
		sweepRadius: SKY_SWEEP_RADIUS * (0.75 + rand() * 0.5),
		hue,
		skyAimPoint: new THREE.Vector3(orbitCx, SKY_TARGET_LIFT, orbitCz),
	};
}

/** Futurystyczne drony nad areną — mgliste snopy w niebo. */
export function setupSkyDrones(scene: THREE.Scene): SkyDroneRig {
	const existing = scene.getObjectByName("skyDrones");
	if (existing) existing.removeFromParent();

	const root = new THREE.Group();
	root.name = "skyDrones";
	root.frustumCulled = false;

	const rand = seededRandom(0xd705e51);
	const drones: SkyDrone[] = [];

	for (let i = 0; i < DRONE_COUNT; i++) {
		const drone = createSkyDrone(i, rand);
		root.add(drone.rig);
		scene.add(drone.spot.target);
		drones.push(drone);
	}

	scene.add(root);
	(scene.userData as { skyDroneRig?: SkyDroneRig }).skyDroneRig = {
		root,
		drones,
	};
	return { root, drones };
}

const _ballAim = new THREE.Vector3();
const _blendedAim = new THREE.Vector3();

export function updateSkyDrones(
	rig: SkyDroneRig,
	timeSec: number,
	dt = 1 / 60,
	ballPos?: THREE.Vector3,
): void {
	const spin = timeSec * 24;
	const aimLerp = 1 - Math.exp(-dt * 2.4);
	const ballFocus = getArenaBallFocus();

	for (const drone of rig.drones) {
		const t = timeSec * drone.orbitSpeed + drone.orbitPhase;
		const x = drone.orbitCx + Math.sin(t) * drone.orbitRx;
		const z = drone.orbitCz + Math.cos(t * 0.91 + 0.6) * drone.orbitRz;
		const y =
			drone.heightBase +
			Math.sin(timeSec * 0.33 + drone.orbitPhase) * drone.heightAmp;

		drone.rig.position.set(x, y, z);

		pickSkyTarget(drone, x, y, z, timeSec, _skyTarget);
		if (ballFocus.blend > 0.04 && ballPos) {
			_ballAim.set(ballPos.x, 6 + ballPos.y * 0.35, ballPos.z);
			_blendedAim.copy(_skyTarget).lerp(_ballAim, ballFocus.blend * 0.55);
			drone.skyAimPoint.lerp(_blendedAim, aimLerp);
		} else {
			drone.skyAimPoint.lerp(_skyTarget, aimLerp);
		}

		drone.beamPivot.lookAt(drone.skyAimPoint);
		drone.spot.target.position.copy(drone.skyAimPoint);

		drone.rig.lookAt(
			x + Math.sin(t + 0.4) * 8,
			y + 6,
			z + Math.cos(t + 0.4) * 8,
		);

		for (let i = 0; i < drone.rotors.length; i++) {
			drone.rotors[i].rotation.y = spin + i * 1.2;
		}

		const pulse = 0.72 + 0.28 * Math.sin(timeSec * 1.8 + drone.sweepPhase);
		const focusBoost = 1 + ballFocus.blend * 0.65;
		drone.spot.intensity = 1.1 * pulse * focusBoost;
		drone.beamMat.uniforms.uOpacity.value = BEAM_OPACITY_BASE * pulse;
		const glowMat = drone.glow.material as THREE.SpriteMaterial;
		glowMat.opacity = 0.55 + pulse * 0.25;
	}
}
