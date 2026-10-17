import { describe, expect, it } from "vitest";

import {
	isPathTraceLookEnabled,
	resetPresentationPrefsForTests,
	setPathTraceLookEnabled,
} from "../../src/util/presentationPrefs";

describe("pathTraceLook presentation pref", () => {
	it("domyślnie ON; da się wyłączyć", () => {
		resetPresentationPrefsForTests();
		expect(isPathTraceLookEnabled()).toBe(true);
		setPathTraceLookEnabled(false);
		expect(isPathTraceLookEnabled()).toBe(false);
		setPathTraceLookEnabled(true);
		expect(isPathTraceLookEnabled()).toBe(true);
		resetPresentationPrefsForTests();
	});
});
