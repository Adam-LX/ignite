import RAPIER from "@dimforge/rapier3d-compat";
import { beforeAll } from "vitest";

if (typeof document === "undefined") {
	(globalThis as unknown as { document: Document }).document = {
		createElement: () =>
			({
				width: 0,
				height: 0,
				getContext: () => ({
					createLinearGradient: () => ({ addColorStop: () => {} }),
					createRadialGradient: () => ({ addColorStop: () => {} }),
					createImageData: (w: number, h: number) => ({
						width: w,
						height: h,
						data: new Uint8ClampedArray(w * h * 4),
					}),
					getImageData: (sx: number, sy: number, w: number, h: number) => ({
						width: w,
						height: h,
						data: new Uint8ClampedArray(w * h * 4),
					}),
					putImageData: () => {},
					drawImage: () => {},
					fillRect: () => {},
					stroke: () => {},
					fill: () => {},
					beginPath: () => {},
					closePath: () => {},
					moveTo: () => {},
					lineTo: () => {},
				}),
			}) as unknown as HTMLCanvasElement,
	} as Document;
}

beforeAll(async () => {
	await RAPIER.init();
});
