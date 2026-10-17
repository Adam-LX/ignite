import * as THREE from "three";
import { primeCarCatalog } from "../meta/CarCatalog";
import { loadCarThumbnailModel } from "../visual/CarModel";
import { scoreUndercarriageDown } from "../visual/trellisCarOrientation";

const CARS = [
	"muscle",
	"truck",
	"hatch",
	"buggy",
	"blade",
	"phantom",
	"bruiser",
	"bruiserNeo",
	"sleek",
];

const W = 420;
const H = 280;

async function renderOne(carId: string): Promise<{
	id: string;
	size: [number, number, number];
	flat: boolean;
	underScore: number;
	dataUrl: string;
}> {
	const template = await loadCarThumbnailModel(carId);
	const car = template;
	car.updateMatrixWorld(true);
	const box = new THREE.Box3().setFromObject(car);
	const sizeV = box.getSize(new THREE.Vector3());
	const center = box.getCenter(new THREE.Vector3());
	const underScore = scoreUndercarriageDown(
		(car.children[0] as THREE.Object3D) ?? car,
	);

	const canvas = document.createElement("canvas");
	canvas.width = W;
	canvas.height = H;
	const renderer = new THREE.WebGLRenderer({
		canvas,
		antialias: true,
		alpha: false,
		preserveDrawingBuffer: true,
	});
	renderer.setSize(W, H, false);
	renderer.outputColorSpace = THREE.SRGBColorSpace;

	const scene = new THREE.Scene();
	scene.background = new THREE.Color(0x0b1424);
	scene.add(new THREE.AmbientLight(0xffffff, 0.7));
	const key = new THREE.DirectionalLight(0xfff0dd, 2.2);
	key.position.set(3, 5, 4);
	scene.add(key);
	const fill = new THREE.DirectionalLight(0x88aaff, 0.8);
	fill.position.set(-4, 2, -2);
	scene.add(fill);

	const ground = new THREE.Mesh(
		new THREE.PlaneGeometry(8, 8),
		new THREE.MeshBasicMaterial({ color: 0x1a3040 }),
	);
	ground.rotation.x = -Math.PI / 2;
	ground.position.y = box.min.y - 0.001;
	scene.add(ground);

	/** Osie: Y czerwona w górę, Z niebieska w przód. */
	scene.add(new THREE.AxesHelper(0.6));

	scene.add(car);

	const camera = new THREE.PerspectiveCamera(35, W / H, 0.05, 40);
	const maxDim = Math.max(sizeV.x, sizeV.y, sizeV.z, 0.2);
	camera.position.set(
		center.x + maxDim * 1.6,
		center.y + maxDim * 0.55,
		center.z + maxDim * 1.6,
	);
	camera.lookAt(center.x, center.y + sizeV.y * 0.1, center.z);

	renderer.render(scene, camera);
	const dataUrl = canvas.toDataURL("image/png");

	renderer.dispose();
	return {
		id: carId,
		size: [+sizeV.x.toFixed(3), +sizeV.y.toFixed(3), +sizeV.z.toFixed(3)],
		flat: sizeV.z > sizeV.y * 1.15,
		underScore: +underScore.toFixed(4),
		dataUrl,
	};
}

const grid = document.getElementById("grid")!;
const status = document.getElementById("status")!;
const results: unknown[] = [];

await primeCarCatalog();

for (const id of CARS) {
	status.textContent = `render ${id}…`;
	try {
		const r = await renderOne(id);
		results.push(r);
		const card = document.createElement("div");
		card.className = "card";
		const img = document.createElement("img");
		img.width = W;
		img.height = H;
		img.src = r.dataUrl;
		const label = document.createElement("div");
		label.className = "label";
		label.textContent = `${r.id} flat=${r.flat} under=${r.underScore} size=${r.size.join(",")}`;
		card.append(img, label);
		grid.append(card);
	} catch (e) {
		results.push({ id, error: String(e) });
		status.textContent = `FAIL ${id}: ${e}`;
	}
}

(window as unknown as { __orientResults?: unknown }).__orientResults = results;
document.body.dataset.ready = "1";
status.textContent = `ready ${results.length}/${CARS.length}`;
