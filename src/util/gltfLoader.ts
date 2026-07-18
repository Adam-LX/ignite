import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const DRACO_DECODER = "https://www.gstatic.com/draco/versioned/decoders/1.5.7/";

let sharedDraco: DRACOLoader | null = null;

/** GLTFLoader z obsługą KHR_draco_mesh_compression (Meshy / gltf-transform). */
export function createGltfLoader(): GLTFLoader {
	const loader = new GLTFLoader();
	if (!sharedDraco) {
		sharedDraco = new DRACOLoader();
		sharedDraco.setDecoderPath(DRACO_DECODER);
	}
	loader.setDRACOLoader(sharedDraco);
	return loader;
}

export function disposeGltfDracoLoader(): void {
	sharedDraco?.dispose();
	sharedDraco = null;
}
