import type { Locale } from "../i18n";
import { loadAudioBuffers } from "./AudioLoader";
import type { GameAudio } from "./GameAudio";
import { isCommentatorEnabled } from "../util/presentationPrefs";

export type CommentaryEvent =
	| "goal"
	| "epic_save"
	| "demolish"
	| "kickoff"
	| "countdown_10"
	| "countdown_9"
	| "countdown_8"
	| "countdown_7"
	| "countdown_6"
	| "countdown_5"
	| "countdown_4"
	| "countdown_3"
	| "countdown_2"
	| "countdown_1"
	| "countdown_go"
	| "clock_60"
	| "clock_30"
	| "power_shot"
	| "flip_reset"
	| "aerial"
	| "post_hit"
	| "near_miss"
	| "blue_ahead"
	| "orange_ahead"
	| "overtime"
	| "match_end"
	| "scramble"
	| "turtle"
	| "fifty_fifty"
	| "idle_ball"
	| "big_boom"
	| "player_lazy"
	| "player_hot"
	| "player_praise"
	| "player_roast"
	| "player_hustle"
	| "player_spectator"
	| "blue_praise"
	| "orange_praise"
	| "blue_roast"
	| "orange_roast"
	| "score_taunt"
	| "crate_drop";

type ManifestClip = {
	id: string;
	text: string;
	weight: number;
	audio: string;
};

type ManifestEvent = {
	cooldown_sec: number;
	clips: ManifestClip[];
};

type CommentaryManifest = {
	version: number;
	locales: Record<string, Record<string, ManifestEvent>>;
};

const MANIFEST_URL = "/assets/audio/commentary/commentary-manifest.json";
const DEFAULT_COOLDOWN_SEC = 3.5;
const GLOBAL_GAP_MS = 120;

/** Komentator zawsze EN — radio-net esport (niezależnie od UI). */
const COMMENTARY_LOCALE: Locale = "en";

const URGENT_EVENTS = new Set<CommentaryEvent>([
	"countdown_go",
	"clock_60",
	"clock_30",
]);

/**
 * Prebaked bank komentatora (EN, dynamiczny).
 * Kickoff GO + clock 60/30 — cyfry 5→1 wyciszone.
 */
export class MatchCommentator {
	private readonly audio: GameAudio;
	private manifest: CommentaryManifest | null = null;
	private readonly buffers = new Map<string, AudioBuffer>();
	private readonly cooldownUntil = new Map<CommentaryEvent, number>();
	private busyUntil = 0;
	private loadPromise: Promise<void> | null = null;
	private lastVariant = new Map<string, string>();
	/** Ostatnie klipy globalnie — mniej powtórzeń między eventami. */
	private readonly recentClipIds: string[] = [];
	private static readonly RECENT_CAP = 14;

	constructor(audio: GameAudio) {
		this.audio = audio;
	}

	ensureLoaded(): Promise<void> {
		if (!this.loadPromise) {
			this.loadPromise = this.load();
		}
		return this.loadPromise;
	}

	/**
	 * Cyfry kickoff / final clock — wyciszone (były irytujące).
	 * Zostaje zwykły countdownTick SFX z GameSession.
	 */
	triggerCountdownDigit(_tick: number): Promise<void> {
		return Promise.resolve();
	}

	async trigger(event: CommentaryEvent): Promise<void> {
		if (!isCommentatorEnabled()) return;
		await this.ensureLoaded();
		if (!this.manifest) return;

		const now = performance.now();
		const urgent = URGENT_EVENTS.has(event);
		/** Urgent może nachodzić / przerywać; reszta czeka na lukę. */
		if (!urgent && now < this.busyUntil) return;
		const coolUntil = this.cooldownUntil.get(event) ?? 0;
		if (now < coolUntil) return;

		const locale = COMMENTARY_LOCALE;
		const clip = this.pickClip(locale, event);
		if (!clip?.audio) return;

		let buf = this.buffers.get(clip.audio);
		if (!buf) {
			const [loaded] = await loadAudioBuffers([clip.audio]);
			if (!loaded) return;
			this.buffers.set(clip.audio, loaded);
			buf = loaded;
		}

		const durationMs = Math.max(280, buf.duration * 1000);
		const eventMeta =
			this.manifest.locales[locale]?.[event] ??
			this.manifest.locales.en?.[event];
		const cooldownSec = eventMeta?.cooldown_sec ?? DEFAULT_COOLDOWN_SEC;

		this.busyUntil = now + durationMs + (urgent ? 30 : GLOBAL_GAP_MS);
		this.cooldownUntil.set(event, now + cooldownSec * 1000);
		this.lastVariant.set(`${locale}:${event}`, clip.id);
		this.recentClipIds.push(clip.id);
		if (this.recentClipIds.length > MatchCommentator.RECENT_CAP) {
			this.recentClipIds.shift();
		}
		this.audio.playCommentary(buf, urgent ? 1.05 : 0.98);
	}

	private async load(): Promise<void> {
		try {
			const res = await fetch(MANIFEST_URL);
			if (!res.ok) {
				console.warn(`[commentary] manifest HTTP ${res.status}`);
				return;
			}
			this.manifest = (await res.json()) as CommentaryManifest;
			const urls: string[] = [];
			const localeBank =
				this.manifest.locales[COMMENTARY_LOCALE] ??
				this.manifest.locales.en ??
				{};
			for (const ev of Object.values(localeBank)) {
				for (const clip of ev.clips ?? []) {
					if (clip.audio) urls.push(clip.audio);
				}
			}
			const unique = [...new Set(urls)];
			const bufs = await loadAudioBuffers(unique);
			for (let i = 0; i < unique.length; i++) {
				const b = bufs[i];
				if (b) this.buffers.set(unique[i], b);
			}
			if (import.meta.env.DEV) {
				console.info(
					`[commentary] loaded ${this.buffers.size}/${unique.length} clips (en hype)`,
				);
			}
		} catch (err) {
			console.warn("[commentary] load failed", err);
		}
	}

	private pickClip(
		locale: Locale,
		event: CommentaryEvent,
	): ManifestClip | null {
		if (!this.manifest) return null;
		const bank =
			this.manifest.locales[locale]?.[event] ??
			this.manifest.locales.en?.[event];
		if (!bank?.clips?.length) return null;
		const ready = bank.clips.filter((c) => Boolean(c.audio));
		if (ready.length === 0) return null;

		const last = this.lastVariant.get(`${locale}:${event}`);
		const recent = new Set(this.recentClipIds);
		let pool = ready.filter(
			(c) => c.id !== last && !recent.has(c.id),
		);
		if (pool.length === 0) {
			pool = ready.filter((c) => c.id !== last);
		}
		if (pool.length === 0) pool = ready;

		let total = 0;
		for (const c of pool) total += Math.max(1, c.weight || 1);
		let roll = Math.random() * total;
		for (const c of pool) {
			roll -= Math.max(1, c.weight || 1);
			if (roll <= 0) return c;
		}
		return pool[pool.length - 1] ?? null;
	}
}
