import { describe, expect, it } from "vitest";

import { getLocale, setLocale, t } from "../../src/i18n";
import { getLocalizedModeSpec } from "../../src/game/modes";

describe("i18n", () => {
	it("setLocale przełącza tłumaczenia", () => {
		setLocale("en");
		expect(getLocale()).toBe("en");
		expect(t("hud.matchEnd")).toBe("FINAL");
		setLocale("pl");
		expect(t("hud.matchEnd")).toBe("KONIEC");
	});

	it("t podstawia parametry", () => {
		setLocale("en");
		expect(t("loading.status.match", { mode: "1v1 Duel" })).toBe(
			"Loading match (1v1 Duel)…",
		);
	});

	it("getLocalizedModeSpec zwraca opis w aktywnym języku", () => {
		setLocale("en");
		const spec = getLocalizedModeSpec("1v1");
		expect(spec.description).toContain("warm-up");
		setLocale("pl");
		expect(getLocalizedModeSpec("1v1").description).toContain("rozgrzewkę");
	});
});
