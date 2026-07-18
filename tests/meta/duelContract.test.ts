import { beforeEach, describe, expect, it } from "vitest";

import {
	acceptDuelContract,
	clearDuelContractForTests,
	getActiveDuelContract,
	getMatchCarId,
	recordDuelContractMatch,
} from "../../src/meta/duelContract";
import { isoWeekKey } from "../../src/modes/MutatorRegistry";
import {
	getEquippedCarId,
	resetPlayerInventoryForTests,
} from "../../src/meta/PlayerInventory";

describe("duelContract", () => {
	beforeEach(() => {
		resetPlayerInventoryForTests();
		clearDuelContractForTests();
	});

	it("accept locks equipped car for the week", () => {
		const car = getEquippedCarId();
		const c = acceptDuelContract(car);
		expect(c.status).toBe("active");
		expect(c.carId).toBe(car);
		expect(c.weekKey).toBe(isoWeekKey());
		expect(getMatchCarId()).toBe(car);
		expect(getActiveDuelContract()?.wins).toBe(0);
	});

	it("BO3 win grants reward after 2 wins", () => {
		acceptDuelContract(getEquippedCarId());
		const r1 = recordDuelContractMatch(true, "1v1", () => 0.1);
		expect(r1?.contract.wins).toBe(1);
		expect(r1?.justFinished).toBe(false);

		const r2 = recordDuelContractMatch(true, "1v1", () => 0.1);
		expect(r2?.justFinished).toBe(true);
		expect(r2?.contract.status).toBe("won");
		expect(getActiveDuelContract()).toBeNull();
	});

	it("two losses ends the series", () => {
		acceptDuelContract(getEquippedCarId());
		recordDuelContractMatch(false, "1v1");
		const r = recordDuelContractMatch(false, "1v1");
		expect(r?.contract.status).toBe("lost");
		expect(r?.justFinished).toBe(true);
	});

	it("ignores non-1v1 modes", () => {
		acceptDuelContract(getEquippedCarId());
		expect(recordDuelContractMatch(true, "2v2")).toBeNull();
		expect(getActiveDuelContract()?.wins).toBe(0);
	});
});
