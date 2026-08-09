import * as THREE from "three";

import {
	getDefaultCarId,
	primeCarCatalog,
} from "../meta/CarCatalog";
import {
	cloneCarMesh,
	disposeCarMeshGroup,
	loadCarModel,
} from "./carVisuals";
import type { CarCosmeticLoadout } from "./carCosmetics";

const ICON_SIZE = 512;
const ICON_BG = 0x0b1424;

const EMPTY_LOADOUT: CarCosmeticLoadout = { paint: {} };

function centerCarOnGround(car: THREE.Group): void {
	car.updateMatrixWorld(true);
	const box = new THREE.Box3().setFromObject(car);
	const center = box.getCenter(new THREE.Vector3());
	car.position.sub(center);
	car.position.y -= box.min.y - center.y;
}

function frameCar(camera: THREE.PerspectiveCamera, car: THREE.Group): void {
	car.updateMatrixWorld(true);
	const box = new THREE.Box3().setFromObject(car);
	const size = box.getSize(new THREE.Vector3());
	const center = box.getCenter(new THREE.Vector3());
	const maxDim = Math.max(size.x, size.y, size.z);
	const fovRad = (camera.fov * Math.PI) / 180;
	const dist = (maxDim * 0.62) / Math.tan(fovRad / 2);
	camera.position.set(
		center.x + dist * 0.92,
		center.y + dist * 0.38,
		center.z + dist * 0.78,
	);
	camera.lookAt(center.x, center.y + size.y * 0.12, center.z);
}

/** Render PNG (data URL) ikony aplikacji z modelu auta z gry. */
export async function renderCarIconDataUrl(
	carId?: string,
	canvas?: HTMLCanvasElement,
): Promise<string> {
	await primeCarCatalog();
	const id = carId ?? getDefaultCarId();

	const target =
		canvas ??
		Object.assign(document.createElement("canvas"), {
			width: ICON_SIZE,
			height: ICON_SIZE,
		});

	const renderer = new THREE.WebGLRenderer({
		canvas: target,
		alpha: false,
		antialias: true,
		preserveDrawingBuffer: true,
	});
	renderer.setSize(ICON_SIZE, ICON_SIZE, false);
	renderer.setPixelRatio(1);
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.72;

	const scene = new THREE.Scene();
	scene.background = new THREE.Color(ICON_BG);

	const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 50);

	const keyLight = new THREE.DirectionalLight(0xfff0dc, 3.4);
	keyLight.position.set(4.2, 6.5, 3.2);
	scene.add(keyLight);

	const fillLight = new THREE.DirectionalLight(0x8ec8ff, 1.35);
	fillLight.position.set(-3.2, 2.8, 4.5);
	scene.add(fillLight);

	const rimLight = new THREE.DirectionalLight(0x3dffe8, 1.05);
	rimLight.position.set(-1.5, 2.4, -4.8);
	scene.add(rimLight);

	scene.add(new THREE.AmbientLight(0x507090, 0.58));
	scene.add(new THREE.HemisphereLight(0xa8d8ff, 0x101820, 0.52));

	const holder = new THREE.Group();
	holder.rotation.y = -Math.PI / 4.8;
	scene.add(holder);

	const template = await loadCarModel(id, "blue", null, EMPTY_LOADOUT);
	const car = cloneCarMesh(template);
	disposeCarMeshGroup(template);

	centerCarOnGround(car);
	holder.add(car);
	frameCar(camera, car);

	renderer.render(scene, camera);
	const dataUrl = renderer.domElement.toDataURL("image/png");

	disposeCarMeshGroup(car, { disposeMaterials: true, disposeGeometry: true });
	renderer.dispose();

	return dataUrl;
}
