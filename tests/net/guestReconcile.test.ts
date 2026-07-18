import { describe, expect, it } from "vitest";

import { GuestReconcilePool } from "../../src/net/guestReconcile";

describe("GuestReconcilePool", () => {
	it("tworzy osobny predictor per slot", () => {
		const pool = new GuestReconcilePool();
		const a = pool.get(0);
		const b = pool.get(1);
		expect(a).not.toBe(b);
		expect(pool.get(0)).toBe(a);
	});

	it("resetSlot usuwa tylko jeden slot", () => {
		const pool = new GuestReconcilePool();
		const a = pool.get(0);
		const b = pool.get(1);
		pool.resetSlot(0);
		expect(pool.get(1)).toBe(b);
		expect(pool.get(0)).not.toBe(a);
	});

	it("reset czyści całą pulę", () => {
		const pool = new GuestReconcilePool();
		pool.get(0);
		pool.reset();
		const again = pool.get(0);
		expect(again).toBeDefined();
	});
});
