import { describe, expect, it } from "vitest";

import {
	cycleGraphicsQuality,
	detectLowPowerDevice,
	resolveGraphicsSettings,
	setGraphicsQuality,
} from "../../src/util/graphicsProfile";

describe("graphicsProfile", () => {
	it("domyślnie high poza Deckiem", () => {
		expect(detectLowPowerDevice()).toBe(false);
		expect(resolveGraphicsSettings().quality).toBe("high");
	});

	it("presety mają sensowne wartości", () => {
		const low = setGraphicsQuality("low");
		const high = setGraphicsQuality("high");
		expect(low.shadowMapSize).toBeLessThan(high.shadowMapSize);
		expect(low.bloomStrength).toBeLessThan(high.bloomStrength);
		expect(low.pixelRatioCap).toBeLessThanOrEqual(high.pixelRatioCap);
	});

	it("cycleGraphicsQuality — low → medium → high → low", () => {
		setGraphicsQuality("low");
		expect(cycleGraphicsQuality().quality).toBe("medium");
		expect(cycleGraphicsQuality().quality).toBe("high");
		expect(cycleGraphicsQuality().quality).toBe("low");
	});
});
