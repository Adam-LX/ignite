import { describe, expect, it, vi, afterEach } from "vitest";

import { trellisBaseUrl, trellisHealth } from "../../scripts/trellis/client";

describe("Trellis client", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("trellisBaseUrl domyślnie localhost:8004", () => {
		expect(trellisBaseUrl()).toMatch(/8004/);
	});

	it("trellisHealth true gdy /health OK", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: true }),
		);
		await expect(trellisHealth()).resolves.toBe(true);
	});

	it("trellisHealth false gdy fetch pada", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(new Error("offline")),
		);
		await expect(trellisHealth()).resolves.toBe(false);
	});
});
