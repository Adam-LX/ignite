import * as THREE from "three";

import { RL_ARENA } from "./arenaConstants";
import { LIGHTING_FILM } from "./lighting";
import { STADIUM_PYLON_SPECS } from "./stadiumPylons";
import { createJupiterConeMaterial } from "./volumetricBeam";

const MAX_PITCH_LIGHTS = 4;
const JUPITER_COUNT = 4;

export type StadiumLightingRig = {
	primaryShadow: THREE.DirectionalLight;
	hemisphere: THREE.HemisphereLight;
	pitchLights: THREE.DirectionalLight[];
	cornerSpots: THREE.SpotLight[];
	fixtures: THREE.Group;
};

/** Statyczna mapa cieni — całe boisko, bez śledzenia auta. */
function configureStaticArenaShadow(light: THREE.DirectionalLight): void {
	light.castShadow = true;
	light.position.set(22, 132, 38);
	light.target.position.set(0, 0, 0);

	light.shadow.mapSize.set(2048, 2048);
	light.shadow.bias = -0.0005;
	light.shadow.normalBias = 0.04;
	light.shadow.radius = 1.2;

	const cam = light.shadow.camera;
	cam.near = 10;
	cam.far = 200;
	cam.left = -RL_ARENA.HALF_WIDTH;
	cam.right = RL_ARENA.HALF_WIDTH;
	cam.top = RL_ARENA.HALF_LENGTH;
	cam.bottom = -RL_ARENA.HALF_LENGTH;
	cam.updateProjectionMatrix();
}

/** Mapa cieni per jupiter — kierunek ze słupa na murawę. */
function configureJupiterShadow(light: THREE.DirectionalLight): void {
	light.castShadow = true;
	light.shadow.mapSize.set(1024, 1024);
	light.shadow.bias = -0.00035;
	light.shadow.normalBias = 0.035;
	light.shadow.radius = 1.1;

	const cam = light.shadow.camera;
	cam.near = 15;
	cam.far = 170;
	const span = Math.max(RL_ARENA.HALF_WIDTH, RL_ARENA.HALF_LENGTH) + 12;
	cam.left = -span;
	cam.right = span;
	cam.top = span;
	cam.bottom = -span;
	cam.updateProjectionMatrix();
}

function configureCornerSpotShadow(light: THREE.SpotLight): void {
	light.castShadow = true;
	light.shadow.mapSize.set(2048, 2048);
	light.shadow.bias = -0.00025;
	light.shadow.normalBias = 0.03;
	light.shadow.radius = 1.4;
	light.shadow.camera.near = 8;
	light.shadow.camera.far = 160;
}

const housingMat = new THREE.MeshStandardMaterial({
	color: 0x0a1018,
	metalness: 0.9,
	roughness: 0.4,
});

const bulbMat = new THREE.MeshStandardMaterial({
	color: 0xffffff,
	emissive: 0xe8f2ff,
	emissiveIntensity: 2.8,
	roughness: 0.06,
	metalness: 0.12,
});

function createPylonBeamFixture(
	position: THREE.Vector3,
	target: THREE.Vector3,
): THREE.Group {
	const rig = new THREE.Group();
	rig.position.copy(position);

	const housing = new THREE.Mesh(
		new THREE.BoxGeometry(1.6, 0.35, 1.6),
		housingMat,
	);
	const bulb = new THREE.Mesh(
		new THREE.CylinderGeometry(0.42, 0.55, 0.28, 10),
		bulbMat,
	);
	bulb.position.y = -0.28;
	rig.add(housing, bulb);

	const beamMat = createJupiterConeMaterial(0xd8e8ff);
	beamMat.opacity = 0.032;
	beamMat.transparent = true;
	const beam = new THREE.Mesh(
		new THREE.ConeGeometry(22, 42, 12, 1, true),
		beamMat,
	);
	beam.rotation.x = Math.PI / 2;
	beam.position.z = 22;
	rig.add(beam);

	rig.lookAt(target);
	return rig;
}

function createCornerSpotFixture(
	position: THREE.Vector3,
	target: THREE.Vector3,
): THREE.Group {
	const rig = new THREE.Group();
	rig.position.copy(position);

	const housing = new THREE.Mesh(
		new THREE.BoxGeometry(2.4, 0.5, 2.4),
		housingMat,
	);
	const lens = new THREE.Mesh(
		new THREE.CylinderGeometry(0.65, 0.8, 0.35, 12),
		bulbMat,
	);
	lens.position.y = -0.32;
	rig.add(housing, lens);

	rig.lookAt(target);
	return rig;
}

/** Ukrywa wizualne snopy (stożki) — światła zostają aktywne. */
export function setStadiumVolumetricsVisible(
	rig: StadiumLightingRig,
	visible: boolean,
): void {
	rig.fixtures.visible = visible;
}

const CORNER_SPOT_SPECS = [
	{
		position: new THREE.Vector3(
			-RL_ARENA.HALF_WIDTH + 4,
			44,
			RL_ARENA.HALF_LENGTH - 8,
		),
		target: new THREE.Vector3(-12, 0, 18),
		color: 0xc8e8ff,
	},
	{
		position: new THREE.Vector3(
			RL_ARENA.HALF_WIDTH - 4,
			44,
			-RL_ARENA.HALF_LENGTH + 8,
		),
		target: new THREE.Vector3(12, 0, -18),
		color: 0xffe0c0,
	},
] as const;

/**
 * Oświetlenie stadionu — ambient + jupitery + reflektory narożne z cieniami i god rays.
 */
export function setupStadiumLighting(scene: THREE.Scene): StadiumLightingRig {
	const ambient = new THREE.AmbientLight(
		LIGHTING_FILM.ambientColor,
		LIGHTING_FILM.ambientIntensity,
	);
	ambient.name = "arenaAmbient";
	scene.add(ambient);

	const hemisphere = new THREE.HemisphereLight(
		LIGHTING_FILM.hemisphereSky,
		LIGHTING_FILM.hemisphereGround,
		LIGHTING_FILM.hemisphereIntensity,
	);
	hemisphere.name = "arenaHemisphere";
	hemisphere.position.set(0, 90, 0);
	scene.add(hemisphere);

	const pitchLights: THREE.DirectionalLight[] = [];
	const cornerSpots: THREE.SpotLight[] = [];
	const fixtures = new THREE.Group();
	fixtures.name = "stadiumJupiters";

	const shadowLight = new THREE.DirectionalLight(
		LIGHTING_FILM.directionalColor,
		LIGHTING_FILM.keyShadowIntensity,
	);
	shadowLight.name = "arenaKeyShadow";
	configureStaticArenaShadow(shadowLight);
	shadowLight.castShadow = true;
	scene.add(shadowLight);
	scene.add(shadowLight.target);

	for (let i = 0; i < JUPITER_COUNT; i++) {
		const spec = STADIUM_PYLON_SPECS[i];
		const top = new THREE.Vector3(spec.x, spec.height + 1.1, spec.z);
		const target = new THREE.Vector3(...spec.target);

		const light = new THREE.DirectionalLight(
			LIGHTING_FILM.directionalColor,
			LIGHTING_FILM.jupiterIntensities[i] ?? 1.2,
		);
		light.name = `jupiterDirectional${i + 1}`;
		light.position.copy(top);
		light.target.position.copy(target);
		configureJupiterShadow(light);

		scene.add(light);
		scene.add(light.target);
		pitchLights.push(light);
		fixtures.add(createPylonBeamFixture(top, target));
	}

	for (let i = 0; i < CORNER_SPOT_SPECS.length; i++) {
		const spec = CORNER_SPOT_SPECS[i]!;
		const baseIntensity = LIGHTING_FILM.cornerSpotIntensities[i] ?? 5;
		const spot = new THREE.SpotLight(
			spec.color,
			baseIntensity,
			220,
			Math.PI / 5.4,
			0.38,
			1.55,
		);
		spot.name = `cornerSpot${i + 1}`;
		spot.position.copy(spec.position);
		spot.target.position.copy(spec.target);
		configureCornerSpotShadow(spot);

		scene.add(spot);
		scene.add(spot.target);
		cornerSpots.push(spot);
		fixtures.add(createCornerSpotFixture(spec.position, spec.target));
	}

	scene.add(fixtures);

	return {
		primaryShadow: shadowLight,
		hemisphere,
		pitchLights,
		cornerSpots,
		fixtures,
	};
}

/** Delikatny puls reflektorów — żywy stadion bez disco. */
export function updateStadiumLighting(
	rig: StadiumLightingRig,
	timeSec: number,
): void {
	const breathe = 0.94 + 0.06 * Math.sin(timeSec * 0.85);
	for (let i = 0; i < rig.cornerSpots.length; i++) {
		const base = LIGHTING_FILM.cornerSpotIntensities[i] ?? 5;
		rig.cornerSpots[i]!.intensity = base * breathe;
	}
	for (let i = 0; i < rig.pitchLights.length; i++) {
		const base = LIGHTING_FILM.jupiterIntensities[i] ?? 1.2;
		const flicker = 1 + 0.025 * Math.sin(timeSec * 1.9 + i * 2.1);
		rig.pitchLights[i]!.intensity = base * flicker;
	}
}

const _floodSky = new THREE.Color(LIGHTING_FILM.hemisphereSky);
const _floodGround = new THREE.Color(LIGHTING_FILM.hemisphereGround);
const _floodSpot = new THREE.Color();
const _cornerSpotA = new THREE.Color(CORNER_SPOT_SPECS[0]!.color);
const _cornerSpotB = new THREE.Color(CORNER_SPOT_SPECS[1]!.color);

let goalFloodTeam: "blue" | "orange" | null = null;
let goalFloodTime = 0;

/** Arena flood w kolorze drużyny strzelającej. */
export function triggerGoalFlood(team: "blue" | "orange"): void {
	goalFloodTeam = team;
	goalFloodTime = 2.4;
}

export function updateGoalFlood(rig: StadiumLightingRig, dt: number): void {
	if (goalFloodTime <= 0 || !goalFloodTeam) return;

	goalFloodTime -= dt;
	const t = THREE.MathUtils.clamp(goalFloodTime / 2.4, 0, 1);
	const pulse = 1 + 0.38 * Math.sin((2.4 - goalFloodTime) * 11);
	const mix = t * pulse * 0.72;

	const teamColor = goalFloodTeam === "blue" ? 0x3388ff : 0xff7722;
	_floodSpot.setHex(teamColor);

	rig.hemisphere.color.copy(_floodSky).lerp(_floodSpot, 0.55 * mix);
	rig.hemisphere.groundColor.copy(_floodGround).lerp(_floodSpot, 0.35 * mix);
	rig.hemisphere.intensity = LIGHTING_FILM.hemisphereIntensity + 0.55 * mix;

	for (let i = 0; i < rig.cornerSpots.length; i++) {
		const base = LIGHTING_FILM.cornerSpotIntensities[i] ?? 5;
		rig.cornerSpots[i]!.intensity = base * (1 + 0.85 * mix);
		const spotBase = i === 0 ? _cornerSpotA : _cornerSpotB;
		rig.cornerSpots[i]!.color.copy(spotBase).lerp(_floodSpot, mix * 0.72);
	}

	for (let i = 0; i < rig.pitchLights.length; i++) {
		const base = LIGHTING_FILM.jupiterIntensities[i] ?? 1.2;
		rig.pitchLights[i]!.intensity = base * (1 + 0.95 * mix);
	}

	if (goalFloodTime <= 0) {
		goalFloodTeam = null;
		rig.hemisphere.color.setHex(LIGHTING_FILM.hemisphereSky);
		rig.hemisphere.groundColor.setHex(LIGHTING_FILM.hemisphereGround);
		rig.hemisphere.intensity = LIGHTING_FILM.hemisphereIntensity;
		for (let i = 0; i < rig.cornerSpots.length; i++) {
			const base = LIGHTING_FILM.cornerSpotIntensities[i] ?? 5;
			rig.cornerSpots[i]!.intensity = base;
			rig.cornerSpots[i]!.color.copy(i === 0 ? _cornerSpotA : _cornerSpotB);
		}
	}
}

/** Pozycje jupiterów dla shadera trawy. */
export function samplePitchLightUniforms(
	rig: StadiumLightingRig,
	outPositions: THREE.Vector3[],
	outColors: THREE.Color[],
	outWeights: number[],
): number {
	const count = Math.min(rig.pitchLights.length, MAX_PITCH_LIGHTS);
	for (let i = 0; i < count; i++) {
		const light = rig.pitchLights[i];
		outPositions[i].copy(light.position);
		outColors[i].copy(light.color).multiplyScalar(light.intensity * 0.1);
		outWeights[i] = light.intensity;
	}
	return count;
}

export { MAX_PITCH_LIGHTS };
