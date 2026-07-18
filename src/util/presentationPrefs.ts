/** Preferencje prezentacji UI — winiety, kamera kinowa (localStorage). */

const STORAGE_KEY = "ignite.presentation.v2";
const LEGACY_KEY = "ignite.presentation.v1";

export type CinematicCameraMode = "on" | "reduced" | "off";

export type PresentationPrefs = {
	uiVignette: boolean;
	cinematicCamera: CinematicCameraMode;
	/** Komentator stadionowy (prebaked bank). Domyslnie ON. */
	commentator: boolean;
};

const DEFAULT: PresentationPrefs = {
	uiVignette: false,
	cinematicCamera: "on",
	commentator: true,
};

let memoryPrefs: PresentationPrefs | null = null;

function sanitizeCinematic(raw: unknown): CinematicCameraMode {
	if (raw === "on" || raw === "reduced" || raw === "off") return raw;
	return DEFAULT.cinematicCamera;
}

function sanitize(raw: unknown): PresentationPrefs {
	if (!raw || typeof raw !== "object") return { ...DEFAULT };
	const data = raw as Record<string, unknown>;
	return {
		uiVignette: data.uiVignette === true,
		cinematicCamera: sanitizeCinematic(data.cinematicCamera),
		// Brak klucza = ON (domyślnie); tylko explicit false wyłącza.
		commentator: data.commentator !== false,
	};
}

function readPrefs(): PresentationPrefs {
	if (memoryPrefs) return { ...memoryPrefs };
	if (typeof localStorage === "undefined") return { ...DEFAULT };
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) return sanitize(JSON.parse(raw));
		const legacy = localStorage.getItem(LEGACY_KEY);
		if (legacy) {
			const migrated = sanitize(JSON.parse(legacy));
			writePrefs(migrated);
			return migrated;
		}
		return { ...DEFAULT };
	} catch {
		return { ...DEFAULT };
	}
}

function writePrefs(prefs: PresentationPrefs): void {
	memoryPrefs = { ...prefs };
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
	} catch {
		/* private mode */
	}
}

export function resolvePresentationPrefs(): PresentationPrefs {
	return readPrefs();
}

export function isUiVignetteEnabled(): boolean {
	return readPrefs().uiVignette;
}

export function getCinematicCameraMode(): CinematicCameraMode {
	return readPrefs().cinematicCamera;
}

export function setUiVignette(enabled: boolean): PresentationPrefs {
	const prefs = { ...readPrefs(), uiVignette: enabled };
	writePrefs(prefs);
	applyPresentationPrefs();
	return prefs;
}

export function setCinematicCameraMode(
	mode: CinematicCameraMode,
): PresentationPrefs {
	const prefs = { ...readPrefs(), cinematicCamera: mode };
	writePrefs(prefs);
	return prefs;
}

export function isCommentatorEnabled(): boolean {
	return readPrefs().commentator;
}

export function setCommentatorEnabled(enabled: boolean): PresentationPrefs {
	const prefs = { ...readPrefs(), commentator: enabled };
	writePrefs(prefs);
	return prefs;
}

export function applyPresentationPrefs(): void {
	if (typeof document === "undefined") return;
	document.body.classList.toggle("ui-vignette-on", readPrefs().uiVignette);
}

export function resetPresentationPrefsForTests(): void {
	memoryPrefs = null;
	if (typeof localStorage !== "undefined") {
		localStorage.removeItem(STORAGE_KEY);
		localStorage.removeItem(LEGACY_KEY);
	}
	applyPresentationPrefs();
}
