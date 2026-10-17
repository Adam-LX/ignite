/** Profil grafiki — Low / Medium / High / Deck (Steam Deck tuned). */
export type GraphicsQuality = "low" | "medium" | "high" | "deck";

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
		bloomStrength: 0.04,
		shadowMapSize: 512,
		warmupFrames: 2,
	},
	medium: {
		pixelRatioCap: 1.25,
		bloomStrength: 0.045,
		shadowMapSize: 1024,
		warmupFrames: 2,
	},
	high: {
		pixelRatioCap: 2,
		/**
		 * Legacy seed — real match bloom jest w OpticsRecipe (`match.high`).
		 * Trzymane dla menu/legacy UnrealBloom path.
		 */
		bloomStrength: 0.055,
		/** 4096×N świateł = multi-sekundowy freeze przy kickoff alloc. */
		shadowMapSize: 2048,
		warmupFrames: 3,
	},
	/** Steam Deck / handheld — jak low, lekko ostrzejszy shadow. */
	deck: {
		pixelRatioCap: 1,
		bloomStrength: 0.04,
		shadowMapSize: 768,
		warmupFrames: 2,
	},
};

const QUALITY_ORDER: GraphicsQuality[] = ["low", "medium", "high", "deck"];

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
	return detectLowPowerDevice() ? "deck" : "high";
}

function parseStoredQuality(raw: string | null): GraphicsQuality | null {
	if (raw === "low" || raw === "medium" || raw === "high" || raw === "deck") {
		return raw;
	}
	return null;
}

export function resolveGraphicsSettings(): GraphicsSettings {
	const quality = parseStoredQuality(readStoredQuality()) ?? defaultQuality();
	return { quality, ...PRESETS[quality] };
}

/** Deszcz 3D Points — full 20k muli przy ulewie; skaluj wg profilu. */
export function rainParticleCountForQuality(quality: GraphicsQuality): number {
	switch (quality) {
		case "high":
			return 12_000;
		case "medium":
			return 8_000;
		case "deck":
			return 6_000;
		case "low":
			return 4_000;
	}
}

/** Specular glint na kroplach od jupiterów — low = off (FPS). */
export function rainGlintStrengthForQuality(quality: GraphicsQuality): number {
	switch (quality) {
		case "high":
			return 1.22;
		case "medium":
			return 0.78;
		case "deck":
			return 0.48;
		case "low":
			return 0;
	}
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
