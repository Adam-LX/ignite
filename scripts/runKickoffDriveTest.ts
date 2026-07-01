import { runKickoffDriveSelfTest } from "../tests/match/kickoffDriveSelfTest";

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

const result = await runKickoffDriveSelfTest();
if (result.passed) {
	console.log(
		`[KICKOFF:DRIVE] PASS — phase=${result.phase} speed=${result.speedMps.toFixed(2)} m/s`,
	);
	process.exit(0);
}

console.error(`[KICKOFF:DRIVE] FAIL — ${result.errors.join("; ")}`);
process.exit(1);
