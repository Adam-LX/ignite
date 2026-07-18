import * as THREE from "three";
import { loadItemGlb } from "../visual/cosmeticGlb";
import { loadCarThumbnailModel } from "../visual/CarModel";
import { applyPaintToCar } from "../visual/applyPaintCosmetic";
import { disposeCarMeshGroup } from "../visual/carVisuals";
import { orientWheelInstanceForHub } from "../visual/wheelMount";
import { hideShowcaseGhostMeshes } from "../visual/showcaseSceneAudit";
import { enforceBodyMaterialsFrontSide } from "../visual/trellisCarOrientation";
import { sanitizeCarVisuals } from "../visual/sanitizeCar";

const THUMB_W = 320;
const THUMB_H = 200;
const PRIZE_W = 960;
const PRIZE_H = 600;
const CAR_CAM_POS = new THREE.Vector3(2.65, 1.05, 2.35);
const CAR_CAM_TARGET = new THREE.Vector3(0, 0.42, 0);

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let keyLight: THREE.DirectionalLight | null = null;
let fillLight: THREE.DirectionalLight | null = null;
let rimLight: THREE.DirectionalLight | null = null;
let carHolder: THREE.Group | null = null;
let itemHolder: THREE.Group | null = null;

const dataUrlCache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
const THUMB_CACHE_TAG = "proc-wheels-v54-prize-swarm";

let thumbRenderQueue: Promise<void> = Promise.resolve();

function enqueueThumbRender<T>(fn: () => Promise<T>): Promise<T> {
	const run = thumbRenderQueue.then(fn, fn);
	thumbRenderQueue = run.then(
		() => undefined,
		() => undefined,
	);
	return run;
}

/** Po zmianie modeli / montażu kół — wymuś nowe miniaturki w garażu. */
export function clearCarThumbnailCache(): void {
	dataUrlCache.clear();
}

function ensureStudio(): void {
	if (renderer) return;

	renderer = new THREE.WebGLRenderer({
		alpha: true,
		antialias: true,
		preserveDrawingBuffer: true,
	});
	renderer.setSize(THUMB_W, THUMB_H);
	renderer.setPixelRatio(1);
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.68;

	scene = new THREE.Scene();
	scene.background = new THREE.Color(0x1a2230);

	camera = new THREE.PerspectiveCamera(34, THUMB_W / THUMB_H, 0.08, 40);
	camera.position.copy(CAR_CAM_POS);
	camera.lookAt(CAR_CAM_TARGET);

	keyLight = new THREE.DirectionalLight(0xfff4e8, 2.85);
	keyLight.position.set(3.5, 5, 2.5);
	scene.add(keyLight);

	fillLight = new THREE.DirectionalLight(0xc8d4e8, 0.75);
	fillLight.position.set(-2.5, 2.2, 3.2);
	scene.add(fillLight);

	rimLight = new THREE.DirectionalLight(0xa8c0d8, 0.45);
	rimLight.position.set(-1.2, 1.8, -3.5);
	scene.add(rimLight);

	scene.add(new THREE.AmbientLight(0x607080, 0.55));
	scene.add(new THREE.HemisphereLight(0xd0dce8, 0x283040, 0.42));

	carHolder = new THREE.Group();
	carHolder.rotation.y = -Math.PI / 5.5;
	scene.add(carHolder);

	itemHolder = new THREE.Group();
	itemHolder.rotation.set(-0.25, Math.PI / 4, 0);
	itemHolder.visible = false;
	scene.add(itemHolder);
}

function ensureItemHolder(): THREE.Group {
	ensureStudio();
	if (!itemHolder) throw new Error("carThumbnail: brak itemHolder");
	return itemHolder;
}

function centerObjectOnOrigin(object: THREE.Object3D): void {
	object.updateMatrixWorld(true);
	const box = new THREE.Box3().setFromObject(object);
	const center = box.getCenter(new THREE.Vector3());
	object.position.sub(center);
}

function frameCameraOnObject(object: THREE.Object3D, fill = 1.4): void {
	if (!camera) return;
	const box = new THREE.Box3().setFromObject(object);
	const size = box.getSize(new THREE.Vector3());
	const center = box.getCenter(new THREE.Vector3());
	const maxDim = Math.max(size.x, size.y, size.z, 0.01);
	const fovRad = (camera.fov * Math.PI) / 180;
	const dist = (maxDim * fill) / (2 * Math.tan(fovRad / 2));
	camera.position.set(
		center.x + dist * 0.72,
		center.y + dist * 0.32,
		center.z + dist * 0.72,
	);
	camera.lookAt(center);
}

function disposeObject3D(root: THREE.Object3D): void {
	root.traverse((obj) => {
		if (!(obj instanceof THREE.Mesh)) return;
		obj.geometry.dispose();
		const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
		for (const mat of mats) mat.dispose();
	});
}

function mountThumbImage(container: HTMLElement, url: string): void {
	const img = document.createElement("img");
	img.className = "loadout-chip__thumb-img";
	img.src = url;
	img.alt = "";
	img.decoding = "async";
	img.loading = "lazy";
	container.appendChild(img);
}

function centerCarOnGround(car: THREE.Group): void {
	car.updateMatrixWorld(true);
	const box = new THREE.Box3().setFromObject(car);
	const center = box.getCenter(new THREE.Vector3());
	car.position.sub(center);
	car.position.y -= box.min.y - center.y;
}

/** Miniaturka — tekstury z GLB, neutralne PBR bez neonu drużyny. */
function toneThumbnailMaterials(root: THREE.Object3D): void {
	root.traverse((obj) => {
		if (!(obj instanceof THREE.Mesh)) return;
		const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
		for (const mat of mats) {
			if (
				!(mat instanceof THREE.MeshStandardMaterial) &&
				!(mat instanceof THREE.MeshPhysicalMaterial)
			) {
				continue;
			}
			mat.side = THREE.FrontSide;
			mat.emissive.setHex(0x000000);
			mat.emissiveIntensity = 0;
			mat.envMapIntensity = 1.25;
			if (mat.map) {
				mat.color.setHex(0xffffff);
			}
			if (mat instanceof THREE.MeshPhysicalMaterial) {
				mat.iridescence = 0;
				mat.clearcoat = Math.min(mat.clearcoat, 0.35);
			}
			mat.needsUpdate = true;
		}
	});
}

async function renderCarDataUrl(
	carId: string,
	paintId: string | null = null,
	transparent = false,
	large = false,
): Promise<string> {
	const cacheKey = `${THUMB_CACHE_TAG}:${transparent ? "a" : "o"}:${large ? "L" : "s"}:${carId}:${paintId ?? ""}`;
	const cached = dataUrlCache.get(cacheKey);
	if (cached) return cached;

	const inflight = pending.get(cacheKey);
	if (inflight) return inflight;

	const task = enqueueThumbRender(async () => {
		ensureStudio();
		if (!renderer || !scene || !camera || !carHolder) {
			throw new Error("carThumbnail: brak studia renderu");
		}

		const w = large ? PRIZE_W : THUMB_W;
		const h = large ? PRIZE_H : THUMB_H;
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();

		const prevBg = scene.background;
		scene.background = transparent ? null : new THREE.Color(0x1a2230);

		const template = await loadCarThumbnailModel(carId);
		const car = template.clone(true);
		car.traverse((node) => {
			if (!(node instanceof THREE.Mesh)) return;
			if (node.geometry) node.geometry = node.geometry.clone();
			if (Array.isArray(node.material)) {
				node.material = node.material.map((m) => m.clone());
			} else if (node.material) {
				node.material = node.material.clone();
			}
		});
		toneThumbnailMaterials(car);
		applyPaintToCar(car, paintId, "blue");
		sanitizeCarVisuals(car);
		hideShowcaseGhostMeshes(car);
		enforceBodyMaterialsFrontSide(car);
		if (large) {
			// Środek AABB w origin — auto w środku roju, bez biasu „na ziemi”.
			centerObjectOnOrigin(car);
		} else {
			centerCarOnGround(car);
		}
		carHolder.clear();
		carHolder.add(car);

		const savedCam = camera.position.clone();
		if (large) {
			// Ciaśniejszy kadr — model wypełnia środek roju.
			frameCameraOnObject(car, 1.05);
		}

		renderer.setClearColor(0x000000, transparent ? 0 : 1);
		renderer.render(scene, camera);
		const url = transparent
			? renderer.domElement.toDataURL("image/png")
			: renderer.domElement.toDataURL("image/webp", 0.92);
		scene.background = prevBg;
		renderer.setClearColor(0x000000, 1);
		camera.position.copy(savedCam);
		camera.lookAt(CAR_CAM_TARGET);
		renderer.setSize(THUMB_W, THUMB_H, false);
		camera.aspect = THUMB_W / THUMB_H;
		camera.updateProjectionMatrix();
		dataUrlCache.set(cacheKey, url);
		disposeCarMeshGroup(car, { disposeMaterials: true, disposeGeometry: true });
		disposeCarMeshGroup(template);
		carHolder.clear();
		return url;
	});

	pending.set(cacheKey, task);
	try {
		return await task;
	} finally {
		pending.delete(cacheKey);
	}
}

export type MountCarThumbnailOpts = {
	/** Przezroczyste tło (np. reveal skrzynki) — osobny klucz cache. */
	transparent?: boolean;
	/** Duży render pod prize reveal. */
	large?: boolean;
};

/** Wstawia miniaturkę GLB do kontenera (cache per carId + paint). */
export async function mountCarThumbnail(
	container: HTMLElement,
	carId: string,
	paintId: string | null = null,
	opts: MountCarThumbnailOpts = {},
): Promise<void> {
	container.replaceChildren();
	container.classList.add("loadout-chip__thumb--rendered");
	if (opts.transparent) {
		container.classList.add("crate-reveal__item-thumb--transparent");
	}

	const url = await renderCarDataUrl(
		carId,
		paintId,
		opts.transparent === true,
		opts.large === true,
	);
	mountThumbImage(container, url);
}

async function renderGlbDataUrl(glbPath: string): Promise<string> {
	const cacheKey = `glb:${THUMB_CACHE_TAG}:${glbPath}`;
	const cached = dataUrlCache.get(cacheKey);
	if (cached) return cached;

	const inflight = pending.get(cacheKey);
	if (inflight) return inflight;

	const task = enqueueThumbRender(async () => {
		ensureStudio();
		if (!renderer || !scene || !camera || !carHolder) {
			throw new Error("carThumbnail: brak studia renderu");
		}

		const holder = ensureItemHolder();
		carHolder.visible = false;
		holder.visible = true;
		holder.clear();

		const model = await loadItemGlb(glbPath);
		orientWheelInstanceForHub(model);
		centerObjectOnOrigin(model);
		holder.add(model);

		const savedPos = camera.position.clone();
		frameCameraOnObject(model);
		renderer.render(scene, camera);
		const url = renderer.domElement.toDataURL("image/webp", 0.9);
		dataUrlCache.set(cacheKey, url);

		camera.position.copy(savedPos);
		camera.lookAt(CAR_CAM_TARGET);
		disposeObject3D(model);
		holder.clear();
		holder.visible = false;
		carHolder.visible = true;
		return url;
	});

	pending.set(cacheKey, task);
	try {
		return await task;
	} finally {
		pending.delete(cacheKey);
	}
}

/** Miniaturka pojedynczego GLB (felga, topper). */
export async function mountGlbThumbnail(
	container: HTMLElement,
	glbPath: string,
): Promise<void> {
	container.replaceChildren();
	container.classList.add("loadout-chip__thumb--rendered");
	const url = await renderGlbDataUrl(glbPath);
	mountThumbImage(container, url);
}

/** Prefetch miniatur — garaż ładuje karuzelę bez migotania. */
export async function primeCarThumbnails(carIds: string[]): Promise<void> {
	for (const id of carIds) {
		await renderCarDataUrl(id);
	}
}

/** Prefetch GLB itemów (felgi, toppery). */
export async function primeGlbThumbnails(glbPaths: string[]): Promise<void> {
	const unique = [...new Set(glbPaths)];
	await Promise.all(unique.map((path) => renderGlbDataUrl(path)));
}
