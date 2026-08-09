import { AudioLoader } from "three";

const sharedLoader = new AudioLoader();
const LOAD_TIMEOUT_MS = 12_000;

export async function loadAudioBuffer(
	url: string,
): Promise<AudioBuffer | null> {
	try {
		const buffer = await Promise.race([
			sharedLoader.loadAsync(url),
			new Promise<never>((_, reject) => {
				setTimeout(
					() => reject(new Error(`timeout ${LOAD_TIMEOUT_MS}ms`)),
					LOAD_TIMEOUT_MS,
				);
			}),
		]);
		return buffer;
	} catch (err) {
		console.warn(`[audio] missing or invalid: ${url}`, err);
		return null;
	}
}

export async function loadAudioBuffers(
	urls: readonly string[],
): Promise<(AudioBuffer | null)[]> {
	return Promise.all(urls.map((url) => loadAudioBuffer(url)));
}
