import { afterEach, describe, expect, it, vi } from "vitest";

describe("loadDonationConfig", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.resetModules();
	});

	it("ładuje adresy z /donation.json", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					wallets: [
						{ symbol: "INJ", label: "Injective", address: "inj1test" },
						{ symbol: "ETH", label: "Ethereum", address: "" },
						{ symbol: "BTC", label: "Bitcoin", address: "bc1qtest" },
					],
					verifyUrl: "https://example.com/verify",
				}),
			}),
		);

		const { loadDonationConfig: loadFresh } = await import(
			"../../src/ui/donationConfig"
		);
		const config = await loadFresh();

		expect(config.wallets.find((w) => w.symbol === "INJ")?.address).toBe(
			"inj1test",
		);
		expect(config.wallets.find((w) => w.symbol === "BTC")?.address).toBe(
			"bc1qtest",
		);
		expect(config.verifyUrl).toBe("https://example.com/verify");
	});

	it("zwraca puste portfele gdy brak pliku", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(new Error("offline")),
		);

		const { loadDonationConfig: loadFresh } = await import(
			"../../src/ui/donationConfig"
		);
		const config = await loadFresh();
		expect(config.wallets.every((w) => w.address === "")).toBe(true);
	});
});
