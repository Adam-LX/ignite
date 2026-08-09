import { existsSync } from "node:fs";

import {
	createTextToImage,
	downloadUrl,
	pollTextToImage,
} from "./client.js";

export type TextureGenOpts = {
	key: string;
	force: boolean;
	outPath: string;
	prompt: string;
	label: string;
	aspectRatio?: string;
	aiModel?: "nano-banana-2" | "nano-banana-pro";
	taskId?: string;
	onTaskId: (id: string) => void;
};

/** Pobiera teksturę Meshy text-to-image (cache po task id + pliku). */
export async function ensureMeshyTexture(opts: TextureGenOpts): Promise<void> {
	const {
		key,
		force,
		outPath,
		prompt,
		label,
		aspectRatio = "1:1",
		aiModel = "nano-banana-pro",
		taskId,
		onTaskId,
	} = opts;

	let id = taskId;
	if (force || !id || !existsSync(outPath)) {
		console.info(`Meshy text-to-image: ${label}…`);
		id = await createTextToImage(key, prompt, aspectRatio, aiModel);
		onTaskId(id);
	}

	const task = await pollTextToImage(key, id!, label);
	const url = task.image_urls?.[0];
	if (!url) throw new Error(`${label}: brak image_urls`);
	await downloadUrl(url, outPath);
}
