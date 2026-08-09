import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const MANIFEST = resolve(ROOT, "public/assets/meshy/arena-manifest.json");
const BALL_MESHY = resolve(ROOT, "public/assets/models/ball_meshy.glb");
const BALL_GAME = resolve(ROOT, "public/assets/models/ball.glb");

describe("Meshy piłka — manifest i assety", () => {
	it("arena-manifest.json wskazuje ball_meshy.glb", () => {
		const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as {
			ballModel?: string;
			ballAlbedo?: string;
		};
		expect(manifest.ballModel).toBe("/assets/models/ball_meshy.glb");
		expect(manifest.ballAlbedo).toContain("meshy_ball_albedo");
	});

	it("ball_meshy.glb i ball.glb istnieją na dysku", () => {
		expect(existsSync(BALL_MESHY)).toBe(true);
		expect(existsSync(BALL_GAME)).toBe(true);
	});
});
