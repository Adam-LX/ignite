import RAPIER from "@dimforge/rapier3d-compat";
import { beforeAll } from "vitest";

if (typeof document === "undefined") {
	(globalThis as unknown as { document: Document }).document = {
		createElement: () =>
			({
				width: 0,
				height: 0,
				getContext: () => ({
					createRadialGradient: () => ({ addColorStop: () => {} }),
					createImageData: (w: number, h: number) => ({
						width: w,
						height: h,
						data: new Uint8ClampedArray(w * h * 4),
					}),
					putImageData: () => {},
					fillRect: () => {},
				}),
			}) as unknown as HTMLCanvasElement,
	} as Document;
}

beforeAll(async () => {
	await RAPIER.init();
});
