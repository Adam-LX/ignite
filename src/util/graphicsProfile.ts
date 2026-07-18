/** Profil grafiki — auto (Deck) lub wybór w pauzie (localStorage). */
export type GraphicsQuality = "low" | "medium" | "high";

export type GraphicsSettings = {
	quality: GraphicsQuality;
	pixelRatioCap: number;
	bloomStrength: number;
	shadowMapSize: number;
	warmupFrames: number;
};

const STORAGE_KEY = "ignite.graphicsQuality";

let memoryQuality: GraphicsQuality | null = null;

const PRESETS: Record<GraphicsQuality, Omit<GraphicsSettings, "quality">> = {
	low: {
		pixelRatioCap: 1,
		bloomStrength: 0.08,
		shadowMapSize: 512,
		warmupFrames: 2,
	},
	medium: {
		pixelRatioCap: 1.25,
		bloomStrength: 0.14,
		shadowMapSize: 1024,
		warmupFrames: 2,
	},
	high: {
		pixelRatioCap: 2,
		bloomStrength: 0.2,
		shadowMapSize: 2048,
		warmupFrames: 3,
	},
};

const QUALITY_ORDER: GraphicsQuality[] = ["low", "medium", "high"];

/** Heurystyka sprzętu — Steam Deck / niski ekran dotykowy. */
export function detectLowPowerDevice(): boolean {
	if (typeof navigator === "undefined") return false;
	const ua = navigator.userAgent.toLowerCase();
	if (ua.includes("steam") || ua.includes("deck")) return true;
	if (
		typeof window !== "undefined" &&
		window.innerWidth <= 1280 &&
		window.innerHeight <= 800 &&
		"ontouchstart" in window
	) {
		return true;
	}
	return false;
}

/** @deprecated Użyj `resolveGraphicsSettings().quality`. */
export type GraphicsProfile = "high" | "deck";

/** @deprecated Użyj `resolveGraphicsSettings()`. */
export function detectGraphicsProfile(): GraphicsProfile {
	return detectLowPowerDevice() ? "deck" : "high";
}

function defaultQuality(): GraphicsQuality {
	return detectLowPowerDevice() ? "low" : "high";
}

function parseStoredQuality(raw: string | null): GraphicsQuality | null {
	if (raw === "low" || raw === "medium" || raw === "high") return raw;
	return null;
}

export function resolveGraphicsSettings(): GraphicsSettings {
	const quality = parseStoredQuality(readStoredQuality()) ?? defaultQuality();
	return { quality, ...PRESETS[quality] };
}

function readStoredQuality(): string | null {
	if (memoryQuality) return memoryQuality;
	if (typeof localStorage === "undefined") return null;
	try {
		return localStorage.getItem(STORAGE_KEY);
	} catch {
		return memoryQuality;
	}
}

export function getStoredGraphicsQuality(): GraphicsQuality | null {
	return parseStoredQuality(readStoredQuality());
}

export function setGraphicsQuality(quality: GraphicsQuality): GraphicsSettings {
	memoryQuality = quality;
	if (typeof localStorage !== "undefined") {
		try {
			localStorage.setItem(STORAGE_KEY, quality);
		} catch {
			/* private mode */
		}
	}
	return { quality, ...PRESETS[quality] };
}

export function cycleGraphicsQuality(): GraphicsSettings {
	const current = resolveGraphicsSettings().quality;
	const idx = QUALITY_ORDER.indexOf(current);
	const next = QUALITY_ORDER[(idx + 1) % QUALITY_ORDER.length]!;
	return setGraphicsQuality(next);
}
