/** Preferencje prezentacji UI — winiety, kamera kinowa (localStorage). */

const STORAGE_KEY = "ignite.presentation.v5";
const LEGACY_KEYS = [
	"ignite.presentation.v4",
	"ignite.presentation.v3",
	"ignite.presentation.v2",
] as const;

export type CinematicCameraMode = "on" | "reduced" | "off";

export type PresentationPrefs = {
	uiVignette: boolean;
	cinematicCamera: CinematicCameraMode;
	/** Komentator meczowy (prebaked bank). Domyslnie OFF — wrócimy do niego później. */
	commentator: boolean;
	/**
	 * Film hybrid PT look: planar wet, lacquer, soft optics.
	 * Domyślnie ON — piękne wizualia bez BVH freeze.
	 */
	pathTraceLook: boolean;
	/**
	 * Eksperymentalny three-realtime-rt (GPU BVH lighting).
	 * Domyślnie OFF — włączenie: ustawienia lub ?rt=1.
	 */
	gpuRealtimeRt: boolean;
};

const DEFAULT: PresentationPrefs = {
	uiVignette: false,
	cinematicCamera: "on",
	commentator: false,
	pathTraceLook: true,
	gpuRealtimeRt: false,
};

let memoryPrefs: PresentationPrefs | null = null;

function sanitizeCinematic(raw: unknown): CinematicCameraMode {
	if (raw === "on" || raw === "reduced" || raw === "off") return raw;
	return DEFAULT.cinematicCamera;
}

function queryWantsGpuRt(): boolean {
	if (typeof location === "undefined") return false;
	try {
		return new URLSearchParams(location.search).get("rt") === "1";
	} catch {
		return false;
	}
}

function sanitize(raw: unknown): PresentationPrefs {
	if (!raw || typeof raw !== "object") return { ...DEFAULT };
	const data = raw as Record<string, unknown>;
	return {
		uiVignette: data.uiVignette === true,
		cinematicCamera: sanitizeCinematic(data.cinematicCamera),
		commentator: data.commentator === true,
		pathTraceLook: data.pathTraceLook !== false,
		gpuRealtimeRt: data.gpuRealtimeRt === true,
	};
}

function readPrefs(): PresentationPrefs {
	if (memoryPrefs) return { ...memoryPrefs };
	if (typeof localStorage === "undefined") {
		const d = { ...DEFAULT };
		if (queryWantsGpuRt()) d.gpuRealtimeRt = true;
		return d;
	}
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) {
			const p = sanitize(JSON.parse(raw));
			if (queryWantsGpuRt()) p.gpuRealtimeRt = true;
			return p;
		}
		/** v5: wymuś gpuRealtimeRt OFF przy migracji — stare sesje miały białą kaszanę. */
		for (const key of LEGACY_KEYS) {
			const legacy = localStorage.getItem(key);
			if (!legacy) continue;
			const migrated = sanitize(JSON.parse(legacy));
			migrated.commentator = false;
			migrated.gpuRealtimeRt = false;
			if (queryWantsGpuRt()) migrated.gpuRealtimeRt = true;
			writePrefs(migrated);
			try {
				localStorage.removeItem(key);
			} catch {
				/* ignore */
			}
			return migrated;
		}
		const d = { ...DEFAULT };
		if (queryWantsGpuRt()) d.gpuRealtimeRt = true;
		return d;
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

export function isPathTraceLookEnabled(): boolean {
	return readPrefs().pathTraceLook;
}

export function setPathTraceLookEnabled(enabled: boolean): PresentationPrefs {
	const prefs = { ...readPrefs(), pathTraceLook: enabled };
	writePrefs(prefs);
	return prefs;
}

export function isGpuRealtimeRtEnabled(): boolean {
	return readPrefs().gpuRealtimeRt || queryWantsGpuRt();
}

export function setGpuRealtimeRtEnabled(enabled: boolean): PresentationPrefs {
	const prefs = { ...readPrefs(), gpuRealtimeRt: enabled };
	writePrefs(prefs);
	return prefs;
}

export function applyPresentationPrefs(): void {
	if (typeof document === "undefined") return;
	document.body?.classList.toggle("ui-vignette-on", readPrefs().uiVignette);
}

export function resetPresentationPrefsForTests(): void {
	memoryPrefs = null;
	if (typeof localStorage !== "undefined") {
		localStorage.removeItem(STORAGE_KEY);
		for (const key of LEGACY_KEYS) localStorage.removeItem(key);
	}
	applyPresentationPrefs();
}
