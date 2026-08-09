import * as THREE from "three";

import { RL_ARENA } from "./arenaConstants";
import {
	LIGHTING_FILM,
	getActiveLightingFilm,
	getActiveLightingFilmId,
	sampleLightingFilm,
} from "./lighting";
import type { AtmospherePhase } from "./matchAtmosphereEngine";
import {
	type MatchAtmosphereDrive,
	sampleAtmosphereHemi,
} from "./matchAtmosphereEngine";
import { STADIUM_PYLON_SPECS } from "./stadiumPylons";
import { createJupiterConeMaterial, setJupiterBeamOpacity } from "./volumetricBeam";
import {
	installStadiumLightGobos,
	PYLON_GOBO_INTENSITY,
	updateStadiumGoboSpots,
} from "./stadiumGobo";
import type { OpticsLightsRecipe, OpticsShadowsRecipe } from "./optics/opticsTypes";

const MAX_PITCH_LIGHTS = 4;
const JUPITER_COUNT = 4;

export type StadiumLightingRig = {
	ambient: THREE.AmbientLight;
	primaryShadow: THREE.DirectionalLight;
	hemisphere: THREE.HemisphereLight;
	pitchLights: THREE.DirectionalLight[];
	cornerSpots: THREE.SpotLight[];
	/** Cookie SpotLighty z pylonów (SM gobo) — uzupełniają Directional jupiterów. */
	goboSpots: THREE.SpotLight[];
	fixtures: THREE.Group;
};

/** Statyczna mapa cieni — całe boisko, bez śledzenia auta. */
function configureStaticArenaShadow(light: THREE.DirectionalLight): void {
	light.castShadow = true;
	/**
	 * Blisko nadir — boczny key (42,92,58) robił ciemną połowę murawy
	 * (klip 23-51). Lekki offset zostaje dla czytelnego cienia auta.
	 */
	light.position.set(14, 155, 10);
	light.target.position.set(0, 0, 0);

	light.shadow.mapSize.set(2048, 2048);
	/**
	 * Mocny penumbra + słabsza intensywność — bez „czarnej strony” boiska.
	 * Kontakt auta i tak robi carContactShadow.
	 */
	light.shadow.bias = -0.00012;
	light.shadow.normalBias = 0.032;
	light.shadow.radius = 8.5;
	light.shadow.intensity = 0.48;

	const cam = light.shadow.camera;
	cam.near = 8;
	cam.far = 240;
	const pad = 8;
	cam.left = -RL_ARENA.HALF_WIDTH - pad;
	cam.right = RL_ARENA.HALF_WIDTH + pad;
	cam.top = RL_ARENA.HALF_LENGTH + pad;
	cam.bottom = -RL_ARENA.HALF_LENGTH - pad;
	cam.updateProjectionMatrix();
}

/** Mapa cieni per jupiter — kierunek ze słupa na murawę. */
function configureJupiterShadow(light: THREE.DirectionalLight): void {
	light.castShadow = true;
	light.shadow.mapSize.set(1024, 1024);
	light.shadow.bias = -0.0002;
	light.shadow.normalBias = 0.03;
	light.shadow.radius = 5.5;
	light.shadow.intensity = 0.55;

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
	/**
	 * Bez shadow map — SpotLight SM = czarne stożki na murawie.
	 * Fill + cookie zostają; cień = key + jupitery.
	 */
	light.castShadow = false;
	void light;
}

/** Dopasuj rozdzielczość map cieni do profilu grafiki (pauza / start). */
export function applyShadowQuality(
	rig: StadiumLightingRig,
	mapSize: number,
	opts?: Partial<OpticsShadowsRecipe>,
): void {
	const primary = Math.max(512, opts?.primaryMapSize ?? mapSize);
	const secondary = Math.max(512, Math.floor(primary / 2));
	const jupiterShadowCount =
		opts?.jupiterShadowCount ??
		(primary >= 2048 ? 3 : primary >= 1024 ? 2 : 1);
	const primaryRadius = opts?.primaryRadius ?? (primary >= 2048 ? 6.5 : 5.2);
	const jupiterRadius = opts?.jupiterRadius ?? (secondary >= 1024 ? 5.5 : 4.5);

	rig.primaryShadow.shadow.mapSize.set(primary, primary);
	rig.primaryShadow.shadow.radius = primaryRadius;
	rig.primaryShadow.shadow.intensity = Math.min(
		rig.primaryShadow.shadow.intensity || 0.48,
		0.52,
	);
	rig.primaryShadow.shadow.needsUpdate = true;

	for (let i = 0; i < rig.pitchLights.length; i++) {
		const light = rig.pitchLights[i]!;
		const wantCast = i < jupiterShadowCount;
		if (wantCast && !light.castShadow) {
			configureJupiterShadow(light);
		} else if (!wantCast) {
			light.castShadow = false;
		}
		if (!light.castShadow) continue;
		light.shadow.mapSize.set(secondary, secondary);
		light.shadow.radius = jupiterRadius;
		light.shadow.needsUpdate = true;
	}
	/** Corner spots: bez shadow map (patrz configureCornerSpotShadow). */
}

/**
 * Intensywności + snopy z OpticsRecipe (MatchOpticsDirector).
 * Nie nadpisuje goal-flood kolorów — tylko skala względem filmu.
 */
export function applyOpticsLights(
	rig: StadiumLightingRig,
	lights: OpticsLightsRecipe,
): void {
	const film = getActiveLightingFilm();
	rig.ambient.intensity = film.ambientIntensity * lights.ambientMul;
	rig.hemisphere.intensity = film.hemisphereIntensity * lights.hemiMul;
	rig.primaryShadow.intensity = film.keyShadowIntensity * lights.keyMul;
	for (let i = 0; i < rig.pitchLights.length; i++) {
		const base = film.jupiterIntensities[i] ?? 1.2;
		rig.pitchLights[i]!.intensity = base * lights.jupiterMul;
	}
	for (let i = 0; i < rig.cornerSpots.length; i++) {
		const base = film.cornerSpotIntensities[i] ?? 5;
		rig.cornerSpots[i]!.intensity = base * lights.cornerMul;
	}
	for (const gobo of rig.goboSpots) {
		gobo.intensity = PYLON_GOBO_INTENSITY * lights.goboMul;
		gobo.visible = lights.goboMul > 0.05;
	}
	setStadiumVolumetricsVisible(rig, lights.beamsVisible);
	setJupiterBeamOpacity(rig.fixtures, lights.beamOpacity);
}

const housingMat = new THREE.MeshStandardMaterial({
	color: 0x0a1018,
	metalness: 0.9,
	roughness: 0.4,
});

const bulbMat = new THREE.MeshStandardMaterial({
	color: 0xffffff,
	emissive: 0xf2f8ff,
	/** Niski emissive — żarówki nie mają robić białych blobów bloom. */
	emissiveIntensity: 0.12,
	roughness: 0.05,
	metalness: 0.1,
	toneMapped: true,
});

function createPylonBeamFixture(
	position: THREE.Vector3,
	target: THREE.Vector3,
	beamColor = 0xd8e8ff,
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

	const beamMat = createJupiterConeMaterial(beamColor);
	/**
	 * Wąski shaft (było r=22 → mleczna ściana na skyboxie).
	 * Ma wyglądać jak ostra plama specular na murawie, tylko w powietrzu.
	 */
	const shaftLen = 52;
	const shaftR = 5.2;
	const beam = new THREE.Mesh(
		new THREE.ConeGeometry(shaftR, shaftLen, 20, 1, true),
		beamMat,
	);
	beam.name = "jupiterVolumetricBeam";
	beam.rotation.x = Math.PI / 2;
	beam.position.z = shaftLen * 0.5;
	beam.renderOrder = 2;
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

/** Ukrywa tylko mesh snopy — housing/żarówki zostają. */
export function setStadiumVolumetricsVisible(
	rig: StadiumLightingRig,
	visible: boolean,
): void {
	rig.fixtures.traverse((obj) => {
		if (obj.name === "jupiterVolumetricBeam") obj.visible = visible;
	});
}

/** Menu/garaż — przygaszone spoty; `updateStadiumLighting` respektuje flagę. */
let showcaseLightingActive = false;
/** Menu główne: orbita stadionu — jaśniej + snopy, nie plama pod autem. */
let menuStadiumOrbitActive = false;

/**
 * Showcase menu/garaż.
 * - Garaż: snopy off.
 * - Menu orbit / mecz: snopy ON (bloom ścięty → godrays czytelne).
 */
export function setStadiumShowcaseLighting(
	rig: StadiumLightingRig,
	showcase: boolean,
	opts?: { stadiumOrbit?: boolean },
): void {
	showcaseLightingActive = showcase;
	menuStadiumOrbitActive = showcase && (opts?.stadiumOrbit ?? false);
	const beamsOn = !showcase || menuStadiumOrbitActive;
	setStadiumVolumetricsVisible(rig, beamsOn);
	applyShowcaseLightingLevels(rig);
}

function showcaseSpotMul(): number {
	if (!showcaseLightingActive) return 1;
	/** Menu orbit ≈ mecz. Garaż też musi czytać lakier — ×0.16 = czarne sylwetki. */
	return menuStadiumOrbitActive ? 0.88 : 0.92;
}

function showcaseJupiterMul(): number {
	if (!showcaseLightingActive) return 1;
	return menuStadiumOrbitActive ? 0.95 : 1.05;
}

function applyShowcaseLightingLevels(rig: StadiumLightingRig): void {
	const spotMul = showcaseSpotMul();
	const jupiterMul = showcaseJupiterMul();
	for (let i = 0; i < rig.cornerSpots.length; i++) {
		const base = LIGHTING_FILM.cornerSpotIntensities[i] ?? 5;
		rig.cornerSpots[i]!.intensity = base * spotMul;
	}
	for (let i = 0; i < rig.pitchLights.length; i++) {
		const base = LIGHTING_FILM.jupiterIntensities[i] ?? 1.2;
		rig.pitchLights[i]!.intensity = base * jupiterMul;
	}
	for (const gobo of rig.goboSpots) {
		gobo.intensity = PYLON_GOBO_INTENSITY * spotMul * jupiterMul;
		gobo.visible = !showcaseLightingActive || menuStadiumOrbitActive;
	}
	rig.hemisphere.intensity =
		LIGHTING_FILM.hemisphereIntensity *
		(showcaseLightingActive
			? menuStadiumOrbitActive
				? 1.08
				: 1.25
			: 1);
	if (menuStadiumOrbitActive) {
		/** Menu — trochę więcej fillu bez podbijania jupiterów. */
		rig.ambient.intensity = LIGHTING_FILM.ambientIntensity * 1.55;
	} else if (showcaseLightingActive) {
		/** Garaż — czytelny lakier przy ściętych jupiterach. */
		rig.ambient.intensity = LIGHTING_FILM.ambientIntensity * 1.85;
	} else {
		rig.ambient.intensity = LIGHTING_FILM.ambientIntensity;
	}
}

const CORNER_SPOT_SPECS = [
	{
		position: new THREE.Vector3(
			-RL_ARENA.HALF_WIDTH + 4,
			44,
			RL_ARENA.HALF_LENGTH - 8,
		),
		target: new THREE.Vector3(-12, 0, 18),
		color: 0x7ec8ff,
	},
	{
		position: new THREE.Vector3(
			RL_ARENA.HALF_WIDTH - 4,
			44,
			-RL_ARENA.HALF_LENGTH + 8,
		),
		target: new THREE.Vector3(12, 0, -18),
		color: 0xff9a55,
	},
] as const;

/**
 * Oświetlenie stadionu — ambient + jupitery + reflektory narożne z cieniami i god rays.
 */
export function setupStadiumLighting(scene: THREE.Scene): StadiumLightingRig {
	const film = getActiveLightingFilm();
	const ambient = new THREE.AmbientLight(
		film.ambientColor,
		film.ambientIntensity,
	);
	ambient.name = "arenaAmbient";
	scene.add(ambient);

	const hemisphere = new THREE.HemisphereLight(
		film.hemisphereSky,
		film.hemisphereGround,
		film.hemisphereIntensity,
	);
	hemisphere.name = "arenaHemisphere";
	hemisphere.position.set(0, 90, 0);
	scene.add(hemisphere);

	const pitchLights: THREE.DirectionalLight[] = [];
	const cornerSpots: THREE.SpotLight[] = [];
	const fixtures = new THREE.Group();
	fixtures.name = "stadiumJupiters";

	const shadowLight = new THREE.DirectionalLight(
		film.directionalColor,
		film.keyShadowIntensity,
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
			film.directionalColor,
			film.jupiterIntensities[i] ?? 1.2,
		);
		light.name = `jupiterDirectional${i + 1}`;
		light.position.copy(top);
		light.target.position.copy(target);
		/**
		 * Jupiter Directional SM = czarne plamy na murawie (klipy F9).
		 * Światło zostaje; cień tylko z arenaKeyShadow.
		 */
		light.castShadow = false;

		scene.add(light);
		scene.add(light.target);
		pitchLights.push(light);
		const beamTint = spec.x < 0 ? 0xb8d8ff : 0xffd0a8;
		fixtures.add(createPylonBeamFixture(top, target, beamTint));
	}

	for (let i = 0; i < CORNER_SPOT_SPECS.length; i++) {
		const spec = CORNER_SPOT_SPECS[i]!;
		const baseIntensity = film.cornerSpotIntensities[i] ?? 5;
		const spot = new THREE.SpotLight(
			spec.color,
			baseIntensity,
			200,
			Math.PI / 5.8,
			0.48,
			1.65,
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

	const goboSpots: THREE.SpotLight[] = [];
	const rig: StadiumLightingRig = {
		ambient,
		primaryShadow: shadowLight,
		hemisphere,
		pitchLights,
		cornerSpots,
		goboSpots,
		fixtures,
	};
	void installStadiumLightGobos(scene, cornerSpots).then((spots) => {
		goboSpots.push(...spots);
		applyShowcaseLightingLevels(rig);
	});

	return rig;
}

/** Delikatny puls reflektorów — żywy stadion bez disco. */
export function updateStadiumLighting(
	rig: StadiumLightingRig,
	timeSec: number,
): void {
	const film = getActiveLightingFilm();
	const spotMul = showcaseSpotMul();
	const jupiterMul = showcaseJupiterMul();
	const breathe = showcaseLightingActive
		? 1
		: 0.94 + 0.06 * Math.sin(timeSec * 0.85);
	for (let i = 0; i < rig.cornerSpots.length; i++) {
		const base = film.cornerSpotIntensities[i] ?? 5;
		rig.cornerSpots[i]!.intensity = base * breathe * spotMul;
	}
	for (let i = 0; i < rig.pitchLights.length; i++) {
		const base = film.jupiterIntensities[i] ?? 1.2;
		const flicker = showcaseLightingActive
			? 1
			: 1 + 0.025 * Math.sin(timeSec * 1.9 + i * 2.1);
		rig.pitchLights[i]!.intensity = base * flicker * jupiterMul;
	}
	updateStadiumGoboSpots(rig.goboSpots, timeSec, spotMul * jupiterMul);
}

const _floodSky = new THREE.Color(LIGHTING_FILM.hemisphereSky);
const _floodGround = new THREE.Color(LIGHTING_FILM.hemisphereGround);
const _floodSpot = new THREE.Color();
const _cornerSpotA = new THREE.Color(CORNER_SPOT_SPECS[0]!.color);
const _cornerSpotB = new THREE.Color(CORNER_SPOT_SPECS[1]!.color);

let goalFloodTeam: "blue" | "orange" | null = null;
let goalFloodTime = 0;

/** Arena flood w kolorze drużyny strzelającej. */
const GOAL_FLOOD_DURATION = 1.15;

/** 0–1 mix aktywnego flood (dla MatchOpticsDirector). */
export function getGoalFloodMix(): number {
	if (goalFloodTime <= 0 || !goalFloodTeam) return 0;
	const t = THREE.MathUtils.clamp(goalFloodTime / GOAL_FLOOD_DURATION, 0, 1);
	return t * t;
}

export function triggerGoalFlood(team: "blue" | "orange"): void {
	goalFloodTeam = team;
	goalFloodTime = GOAL_FLOOD_DURATION;
}

function restoreGoalFloodLighting(rig: StadiumLightingRig): void {
	const film = getActiveLightingFilm();
	/** Mesh snopy: nie włączaj tu — MatchOpticsDirector trzyma receptę. */
	rig.hemisphere.color.setHex(film.hemisphereSky);
	rig.hemisphere.groundColor.setHex(film.hemisphereGround);
	rig.hemisphere.intensity =
		film.hemisphereIntensity *
		(showcaseLightingActive
			? menuStadiumOrbitActive
				? 1.05
				: 1.25
			: 1);
	const spotMul = showcaseSpotMul();
	const jupiterMul = showcaseJupiterMul();
	for (let i = 0; i < rig.cornerSpots.length; i++) {
		const base = film.cornerSpotIntensities[i] ?? 5;
		rig.cornerSpots[i]!.intensity = base * spotMul;
		rig.cornerSpots[i]!.color.copy(i === 0 ? _cornerSpotA : _cornerSpotB);
	}
	for (let i = 0; i < rig.pitchLights.length; i++) {
		const base = film.jupiterIntensities[i] ?? 1.2;
		rig.pitchLights[i]!.intensity = base * jupiterMul;
	}
}

/** Natychmiastowy reset oświetlenia — przed replay (bez migotania sin). */
export function cancelGoalFlood(rig: StadiumLightingRig): void {
	goalFloodTime = 0;
	goalFloodTeam = null;
	restoreGoalFloodLighting(rig);
}

export function updateGoalFlood(rig: StadiumLightingRig, dt: number): void {
	if (goalFloodTime <= 0 || !goalFloodTeam) return;

	goalFloodTime -= dt;
	const t = THREE.MathUtils.clamp(goalFloodTime / GOAL_FLOOD_DURATION, 0, 1);
	const mix = t * t * 0.38;
	/** Flood: tylko światła — mesh snopy zostają wg recepty optyki (OFF = anty-mleko). */

	const teamColor = goalFloodTeam === "blue" ? 0x3388ff : 0xff7722;
	_floodSpot.setHex(teamColor);

	rig.hemisphere.color.copy(_floodSky).lerp(_floodSpot, 0.72 * mix);
	rig.hemisphere.groundColor.copy(_floodGround).lerp(_floodSpot, 0.48 * mix);
	rig.hemisphere.intensity = LIGHTING_FILM.hemisphereIntensity + 0.78 * mix;

	for (let i = 0; i < rig.cornerSpots.length; i++) {
		const base = LIGHTING_FILM.cornerSpotIntensities[i] ?? 5;
		rig.cornerSpots[i]!.intensity = base * (1 + 1.15 * mix);
		const spotBase = i === 0 ? _cornerSpotA : _cornerSpotB;
		rig.cornerSpots[i]!.color.copy(spotBase).lerp(_floodSpot, mix * 0.88);
	}

	for (let i = 0; i < rig.pitchLights.length; i++) {
		const base = LIGHTING_FILM.jupiterIntensities[i] ?? 1.2;
		rig.pitchLights[i]!.intensity = base * (1 + 1.25 * mix);
	}

	if (goalFloodTime <= 0) {
		goalFloodTeam = null;
		restoreGoalFloodLighting(rig);
	}
}

let atmosphereHemiMix = 0;

/** Timeline dusk→neon + napięcie meczu — nakładka na hemi (poza goal flood). */
export function applyMatchAtmosphereLighting(
	rig: StadiumLightingRig,
	drive: MatchAtmosphereDrive,
	phase: AtmospherePhase,
	dt: number,
): void {
	if (goalFloodTime > 0) return;

	const targetMix = THREE.MathUtils.clamp(
		drive.hemiSkyTint + drive.tension * 0.25,
		0,
		1,
	);
	atmosphereHemiMix = THREE.MathUtils.lerp(
		atmosphereHemiMix,
		targetMix,
		1 - Math.exp(-4.2 * dt),
	);

	/**
	 * Profil areny: dusk → night szybko w meczu; night = full film.
	 */
	const baseId = getActiveLightingFilmId();
	const nightMix =
		baseId === "night"
			? 1
			: Math.min(1, 0.35 + drive.timeline * 0.85);
	const film = sampleLightingFilm(nightMix);

	rig.ambient.color.setHex(film.ambientColor);
	rig.ambient.intensity = film.ambientIntensity;
	rig.primaryShadow.color.setHex(film.directionalColor);
	rig.primaryShadow.intensity = film.keyShadowIntensity;
	for (const light of rig.pitchLights) {
		light.color.setHex(film.directionalColor);
	}

	if (atmosphereHemiMix < 0.02) {
		rig.hemisphere.color.setHex(film.hemisphereSky);
		rig.hemisphere.groundColor.setHex(film.hemisphereGround);
		rig.hemisphere.intensity = film.hemisphereIntensity;
	} else {
		const hemi = sampleAtmosphereHemi(drive, phase);
		const filmSky = _floodSky.setHex(film.hemisphereSky);
		const filmGround = _floodGround.setHex(film.hemisphereGround);

		rig.hemisphere.color.copy(filmSky).lerp(hemi.sky, atmosphereHemiMix);
		rig.hemisphere.groundColor
			.copy(filmGround)
			.lerp(hemi.ground, atmosphereHemiMix);
		rig.hemisphere.intensity = THREE.MathUtils.lerp(
			film.hemisphereIntensity,
			hemi.intensity,
			atmosphereHemiMix,
		);
	}

	/** Niskie capy — tension nie ma zmywać gobo / corner character. */
	const spotBoost = 1 + drive.tension * 0.12 + drive.ledTension * 0.08;
	for (let i = 0; i < rig.cornerSpots.length; i++) {
		const base = film.cornerSpotIntensities[i] ?? 5;
		rig.cornerSpots[i]!.intensity = base * spotBoost;
	}
	for (let i = 0; i < rig.pitchLights.length; i++) {
		const base = film.jupiterIntensities[i] ?? 1.2;
		rig.pitchLights[i]!.intensity =
			base * (1 + drive.timeline * 0.05 + drive.tension * 0.04);
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
