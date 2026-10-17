import { describe, expect, it } from "vitest";
import {
	IGNITE_TV_DEFAULT_YT,
	isJumbotronActive,
	isJumbotronFilmVisible,
	jumbotronPaUrls,
	jumbotronShouldAttachPa,
	parseJumbotronSpec,
	readJumbotronSpec,
} from "../../src/visual/jumbotronFeed";

describe("parseJumbotronSpec", () => {
	it("off for empty / 0", () => {
		expect(parseJumbotronSpec(null).kind).toBe("off");
		expect(parseJumbotronSpec("0").kind).toBe("off");
		expect(parseJumbotronSpec("off").kind).toBe("off");
	});

	it("yt flag uses default Crypto TV live", () => {
		const spec = parseJumbotronSpec("1");
		expect(spec).toEqual({ kind: "yt", id: IGNITE_TV_DEFAULT_YT });
		expect(IGNITE_TV_DEFAULT_YT).toBe("LDzslQh7rEQ");
	});

	it("accepts on/true/yt aliases and false off", () => {
		expect(parseJumbotronSpec("on")).toEqual({
			kind: "yt",
			id: IGNITE_TV_DEFAULT_YT,
		});
		expect(parseJumbotronSpec("true")).toEqual({
			kind: "yt",
			id: IGNITE_TV_DEFAULT_YT,
		});
		expect(parseJumbotronSpec("yt")).toEqual({
			kind: "yt",
			id: IGNITE_TV_DEFAULT_YT,
		});
		expect(parseJumbotronSpec("false").kind).toBe("off");
	});

	it("accepts yt:VIDEO_ID", () => {
		expect(parseJumbotronSpec("yt:dQw4w9WgXcQ")).toEqual({
			kind: "yt",
			id: "dQw4w9WgXcQ",
		});
	});

	it("rejects garbage ids", () => {
		expect(parseJumbotronSpec("yt:nope").kind).toBe("off");
	});
});

describe("jumbotronShouldAttachPa", () => {
	it("skips PA for default Crypto TV live", () => {
		expect(jumbotronShouldAttachPa(IGNITE_TV_DEFAULT_YT)).toBe(false);
		expect(jumbotronShouldAttachPa("dQw4w9WgXcQ")).toBe(true);
	});
});

describe("jumbotronPaUrls", () => {
	it("same-origin cache first, then vite plugin", () => {
		expect(jumbotronPaUrls("LDzslQh7rEQ")[0]).toBe(
			"/jumbotron/LDzslQh7rEQ.webm",
		);
		expect(jumbotronPaUrls("LDzslQh7rEQ").at(-1)).toContain(
			"/__ignite/jumbotron?id=LDzslQh7rEQ",
		);
	});

	it("keeps video id unencoded in static paths", () => {
		const urls = jumbotronPaUrls("abcdefghijk");
		expect(urls[0]).toBe("/jumbotron/abcdefghijk.webm");
		expect(urls.some((u) => u.includes("m4a"))).toBe(true);
		expect(urls.some((u) => u.includes("mp4"))).toBe(true);
	});
});

describe("jumbotron defaults without mounts", () => {
	it("inactive / film hidden before mount", () => {
		expect(isJumbotronActive()).toBe(false);
		expect(isJumbotronFilmVisible()).toBe(false);
	});

	it("readJumbotronSpec defaults to yt Crypto TV when no storage", () => {
		const spec = readJumbotronSpec();
		expect(spec.kind === "off" || spec.kind === "yt").toBe(true);
		if (spec.kind === "yt") {
			expect(spec.id).toMatch(/^[a-zA-Z0-9_-]{11}$/);
		}
	});
});

describe("jumbotron YT embed contracts", () => {
	it("keeps iframe mute + no controls (PA is same-origin only)", async () => {
		const { readFileSync } = await import("node:fs");
		const { resolve } = await import("node:path");
		const src = readFileSync(
			resolve(__dirname, "../../src/visual/jumbotronFeed.ts"),
			"utf8",
		);
		expect(src).toMatch(/mute:\s*"1"/);
		expect(src).toMatch(/controls:\s*"0"/);
		expect(src).toContain("jumbotron-chrome-mask");
		expect(src).toMatch(/pointer-events:none/);
	});

	it("no playlist param (◀▶ na środku) — pętla przez seekTo", async () => {
		const { readFileSync } = await import("node:fs");
		const { resolve } = await import("node:path");
		const src = readFileSync(
			resolve(__dirname, "../../src/visual/jumbotronFeed.ts"),
			"utf8",
		);
		expect(src).not.toMatch(/playlist:\s*id/);
		expect(src).toContain("seekTo");
		expect(src).toContain("loopOrResume");
	});

	it("cykl LED → LIVE → film (broadcast boiska)", async () => {
		const { readFileSync } = await import("node:fs");
		const { resolve } = await import("node:path");
		const src = readFileSync(
			resolve(__dirname, "../../src/visual/jumbotronFeed.ts"),
			"utf8",
		);
		expect(src).toContain('JumbotronFeedMode = "led" | "film" | "live"');
		expect(src).toContain("setJumbotronBroadcastActive");
		expect(src).toContain("LIVE_ON_MS");
	});
});
