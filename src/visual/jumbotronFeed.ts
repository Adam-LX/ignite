/**
 * Jumbotron — obraz: CSS3D embed YT (mute) + LIVE broadcast RT, losowo nad LED.
 * Audio PA: same-origin clip → Web Audio (osobno w GameAudio).
 */
import * as THREE from "three";
import { CSS3DObject } from "three/examples/jsm/renderers/CSS3DRenderer.js";

import {
	disposeJumbotronBroadcast,
	setJumbotronBroadcastActive,
} from "./jumbotronBroadcast";

/**
 * Crypto TV (@CryptoTVPL) — domyślny feed na telebimach.
 * ID live zmienia się przy każdym starcie transmisji; zaktualizuj przy nowym streamie
 * albo podaj `?jumbotron=yt:VIDEO_ID`.
 */
export const IGNITE_TV_DEFAULT_YT = "LDzslQh7rEQ";
/** Domyślny clip = stream na żywo (mute embed; bez yt-dlp PA). */
export const IGNITE_TV_DEFAULT_IS_LIVE = true;
/** Stary spot „Będę grał w grę…” — migracja localStorage. */
const LEGACY_JUMBOTRON_YT = "Elh-QH6oN5M";

export type JumbotronSpec =
	| { kind: "off" }
	| { kind: "yt"; id: string };

/** Slot na telebimie: LED anim / film YT / LIVE boisko. */
export type JumbotronFeedMode = "led" | "film" | "live";

export type JumbotronMountOpts = {
	/** true = widać film; false = LED lub LIVE (PA duck). */
	onFilmVisible?: (visible: boolean) => void;
	onFeedMode?: (mode: JumbotronFeedMode) => void;
};

const YT_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
const IFRAME_W = 640;
const IFRAME_H = 360;

/** Film na ekranie krótko, LED dłużej — stadionowy „spot”. */
export const FILM_ON_MS = [11_000, 18_000] as const;
export const FILM_OFF_MS = [22_000, 42_000] as const;
/** LIVE feed boiska między LED a filmem. */
export const LIVE_ON_MS = [14_000, 24_000] as const;

type Mount = {
	object: CSS3DObject;
	iframe: HTMLIFrameElement;
	wrap: HTMLDivElement;
};

let mounts: Mount[] = [];
let active = false;
let filmVisible = false;
let feedMode: JumbotronFeedMode = "led";
/** Po LED: naprzemiennie LIVE i film. */
let nextSpotlight: "live" | "film" = "live";
/** true = nie rewinduj do 0 (stream na żywo / DVR). */
let mountedIsLive = false;
let ytApiPromise: Promise<void> | null = null;
let scheduleTimer = 0;
let keepAliveTimer = 0;
let onFilmVisibleCb: ((visible: boolean) => void) | null = null;
let onFeedModeCb: ((mode: JumbotronFeedMode) => void) | null = null;

/** Czy do tego id dokładać stadiumowe PA (yt-dlp) — nie dla live. */
export function jumbotronShouldAttachPa(videoId: string): boolean {
	return !(
		IGNITE_TV_DEFAULT_IS_LIVE && videoId === IGNITE_TV_DEFAULT_YT
	);
}

export function jumbotronPaUrls(videoId: string): string[] {
	return [
		`/jumbotron/${videoId}.webm`,
		`/jumbotron/${videoId}.m4a`,
		`/jumbotron/${videoId}.mp3`,
		`/jumbotron/${videoId}.mp4`,
		`/__ignite/jumbotron?id=${encodeURIComponent(videoId)}`,
	];
}

export function parseJumbotronSpec(raw: string | null | undefined): JumbotronSpec {
	if (raw == null) return { kind: "off" };
	const s = raw.trim();
	if (!s || s === "0" || s === "off" || s === "false") return { kind: "off" };
	if (s === "1" || s === "on" || s === "true" || s === "yt") {
		return { kind: "yt", id: IGNITE_TV_DEFAULT_YT };
	}
	const yt = s.startsWith("yt:") ? s.slice(3) : s;
	const id = yt.match(YT_ID_RE)?.[0];
	if (!id) return { kind: "off" };
	return { kind: "yt", id };
}

export function readJumbotronSpec(): JumbotronSpec {
	if (typeof window === "undefined") return { kind: "off" };
	const q = new URLSearchParams(window.location.search).get("jumbotron");
	if (q != null) {
		const spec = parseJumbotronSpec(q);
		try {
			window.localStorage.setItem(
				"ignite.jumbotron",
				spec.kind === "off" ? "0" : `yt:${spec.id}`,
			);
		} catch {
			/* */
		}
		return spec;
	}
	try {
		const stored = window.localStorage.getItem("ignite.jumbotron");
		if (stored != null) {
			const spec = parseJumbotronSpec(stored);
			if (spec.kind === "yt" && spec.id === LEGACY_JUMBOTRON_YT) {
				const next: JumbotronSpec = {
					kind: "yt",
					id: IGNITE_TV_DEFAULT_YT,
				};
				try {
					window.localStorage.setItem(
						"ignite.jumbotron",
						`yt:${IGNITE_TV_DEFAULT_YT}`,
					);
				} catch {
					/* */
				}
				return next;
			}
			return spec;
		}
	} catch {
		/* */
	}
	return { kind: "yt", id: IGNITE_TV_DEFAULT_YT };
}

export function isJumbotronActive(): boolean {
	return active;
}

export function isJumbotronFilmVisible(): boolean {
	return filmVisible;
}

export function getJumbotronFeedMode(): JumbotronFeedMode {
	return feedMode;
}

function randBetween(lo: number, hi: number): number {
	return lo + Math.random() * (hi - lo);
}

function ytEmbedUrl(id: string): string {
	const origin =
		typeof window !== "undefined" ? window.location.origin : "";
	const params = new URLSearchParams({
		autoplay: "1",
		mute: "1",
		/** Bez playlist — YT pokazuje wtedy ◀ ▶ i big-pause na środku. Pętla = seekTo w API. */
		controls: "0",
		rel: "0",
		modestbranding: "1",
		playsinline: "1",
		disablekb: "1",
		fs: "0",
		iv_load_policy: "3",
		cc_load_policy: "0",
		enablejsapi: "1",
		showinfo: "0",
	});
	if (origin.startsWith("http")) params.set("origin", origin);
	return `https://www.youtube-nocookie.com/embed/${id}?${params.toString()}`;
}

function makeFrame(id: string): HTMLIFrameElement {
	const iframe = document.createElement("iframe");
	iframe.width = String(IFRAME_W);
	iframe.height = String(IFRAME_H);
	iframe.src = ytEmbedUrl(id);
	iframe.setAttribute(
		"allow",
		"autoplay; encrypted-media; picture-in-picture; fullscreen",
	);
	iframe.allowFullscreen = false;
	iframe.referrerPolicy = "strict-origin-when-cross-origin";
	iframe.tabIndex = -1;
	iframe.setAttribute("aria-hidden", "true");
	iframe.className = "jumbotron-yt";
	/** Większy kadr — title bar / big pause / logo YT poza overflow ekranu */
	iframe.style.cssText =
		"position:absolute;left:50%;top:50%;width:122%;height:128%;" +
		"transform:translate(-50%,-52%);border:0;margin:0;pointer-events:none;background:#05070c";
	return iframe;
}

function wrapScreen(iframe: HTMLIFrameElement): HTMLDivElement {
	const wrap = document.createElement("div");
	wrap.className = "jumbotron-screen";
	wrap.appendChild(iframe);
	const scan = document.createElement("div");
	scan.className = "jumbotron-scan";
	wrap.appendChild(scan);
	const mask = document.createElement("div");
	mask.className = "jumbotron-chrome-mask";
	mask.setAttribute("aria-hidden", "true");
	wrap.appendChild(mask);
	const bug = document.createElement("div");
	bug.className = "jumbotron-bug";
	bug.textContent = "CRYPTO TV";
	wrap.appendChild(bug);
	return wrap;
}

function ensureYtApi(): Promise<void> {
	if (typeof window === "undefined") return Promise.resolve();
	const w = window as Window & {
		YT?: { Player: new (el: HTMLIFrameElement, opts: object) => YtPlayer };
		onYouTubeIframeAPIReady?: () => void;
	};
	if (w.YT?.Player) return Promise.resolve();
	if (ytApiPromise) return ytApiPromise;
	ytApiPromise = new Promise((resolve) => {
		const prev = w.onYouTubeIframeAPIReady;
		w.onYouTubeIframeAPIReady = () => {
			prev?.();
			resolve();
		};
		if (!document.querySelector("script[data-ignite-yt]")) {
			const s = document.createElement("script");
			s.src = "https://www.youtube.com/iframe_api";
			s.dataset.igniteYt = "1";
			document.head.appendChild(s);
		}
		window.setTimeout(() => resolve(), 4000);
	});
	return ytApiPromise;
}

type YtPlayer = {
	mute: () => void;
	unMute?: () => void;
	isMuted?: () => boolean;
	setVolume?: (n: number) => void;
	playVideo?: () => void;
	pauseVideo?: () => void;
	seekTo?: (seconds: number, allowSeekAhead?: boolean) => void;
	getPlayerState?: () => number;
	unloadModule?: (name: string) => void;
	setOption?: (mod: string, opt: string, val: unknown) => void;
};

/** YT.PlayerState.PAUSED = 2, CUED = 5, ENDED = 0 */
const YT_PAUSED = 2;
const YT_CUED = 5;
const YT_ENDED = 0;

let ytPlayers: YtPlayer[] = [];

function forcePlayQuiet(player: YtPlayer): void {
	try {
		player.mute();
		player.setVolume?.(0);
		player.playVideo?.();
	} catch {
		/* */
	}
}

/** Pętla bez playlist — koniec VOD → seek 0 (live: tylko play, bez rewind). */
function loopOrResume(player: YtPlayer, state: number): void {
	try {
		if (state === YT_ENDED && !mountedIsLive) {
			player.seekTo?.(0, true);
		}
	} catch {
		/* */
	}
	forcePlayQuiet(player);
}

function bindYtPlayer(iframe: HTMLIFrameElement): void {
	void ensureYtApi().then(() => {
		const YT = (
			window as Window & {
				YT?: { Player: new (el: HTMLIFrameElement, opts: object) => YtPlayer };
			}
		).YT;
		if (!YT?.Player) return;
		try {
			const player = new YT.Player(iframe, {
				playerVars: {
					autoplay: 1,
					mute: 1,
					controls: 0,
					rel: 0,
					modestbranding: 1,
					playsinline: 1,
					disablekb: 1,
					fs: 0,
					iv_load_policy: 3,
					cc_load_policy: 0,
				},
				events: {
					onReady: (ev: { target: YtPlayer }) => {
						ytPlayers.push(ev.target);
						try {
							ev.target.unloadModule?.("captions");
							ev.target.unloadModule?.("cc");
							ev.target.setOption?.("captions", "track", {});
						} catch {
							/* */
						}
						forcePlayQuiet(ev.target);
					},
					onStateChange: (ev: { data: number; target: YtPlayer }) => {
						/** Nigdy nie zostawiaj big-pause / end-screen na telebimie */
						if (
							ev.data === YT_PAUSED ||
							ev.data === YT_CUED ||
							ev.data === YT_ENDED
						) {
							loopOrResume(ev.target, ev.data);
						}
					},
				},
			});
			void player;
		} catch {
			/* */
		}
	});
}

function applyFeedMode(mode: JumbotronFeedMode): void {
	feedMode = mode;
	filmVisible = mode === "film";
	const showYt = mode === "film";
	for (const m of mounts) {
		m.object.visible = showYt;
		m.wrap.style.opacity = showYt ? "1" : "0";
		m.wrap.style.visibility = showYt ? "visible" : "hidden";
	}
	setJumbotronBroadcastActive(mode === "live");
	onFilmVisibleCb?.(showYt);
	onFeedModeCb?.(mode);
}

function clearSchedule(): void {
	if (scheduleTimer) {
		window.clearTimeout(scheduleTimer);
		scheduleTimer = 0;
	}
}

function clearKeepAlive(): void {
	if (keepAliveTimer) {
		window.clearInterval(keepAliveTimer);
		keepAliveTimer = 0;
	}
}

function scheduleAfter(mode: JumbotronFeedMode): void {
	clearSchedule();
	if (!active || typeof window === "undefined") return;
	const wait =
		mode === "film"
			? randBetween(FILM_ON_MS[0], FILM_ON_MS[1])
			: mode === "live"
				? randBetween(LIVE_ON_MS[0], LIVE_ON_MS[1])
				: randBetween(FILM_OFF_MS[0], FILM_OFF_MS[1]);
	scheduleTimer = window.setTimeout(() => {
		scheduleTimer = 0;
		if (!active) return;
		let next: JumbotronFeedMode;
		if (mode === "led") {
			next = nextSpotlight;
			nextSpotlight = nextSpotlight === "live" ? "film" : "live";
		} else {
			next = "led";
		}
		applyFeedMode(next);
		if (next === "film") {
			for (const p of ytPlayers) forcePlayQuiet(p);
		}
		scheduleAfter(next);
	}, wait);
}

function startKeepAlive(): void {
	if (typeof window === "undefined") return;
	/** Gra też w LED-idle — film wraca już w play, bez flasha big-pause. */
	keepAliveTimer = window.setInterval(() => {
		if (!active) return;
		for (const p of ytPlayers) {
			try {
				const st = p.getPlayerState?.();
				if (
					st === YT_PAUSED ||
					st === YT_CUED ||
					st === YT_ENDED ||
					st === undefined
				) {
					loopOrResume(p, st ?? YT_PAUSED);
				}
			} catch {
				forcePlayQuiet(p);
			}
		}
	}, 900);
}

export function mountJumbotronYoutube(
	meshes: THREE.Mesh[],
	videoId: string,
	opts?: JumbotronMountOpts,
): boolean {
	disposeJumbotron();
	if (meshes.length === 0 || typeof document === "undefined") return false;

	onFilmVisibleCb = opts?.onFilmVisible ?? null;
	onFeedModeCb = opts?.onFeedMode ?? null;
	nextSpotlight = "live";
	mountedIsLive =
		IGNITE_TV_DEFAULT_IS_LIVE && videoId === IGNITE_TV_DEFAULT_YT;

	for (const mesh of meshes) {
		const geo = mesh.geometry as THREE.PlaneGeometry;
		const w = geo.parameters?.width ?? 8;
		const h = geo.parameters?.height ?? 4;
		const iframe = makeFrame(videoId);
		const wrap = wrapScreen(iframe);
		const object = new CSS3DObject(wrap);
		object.scale.set(w / IFRAME_W, h / IFRAME_H, 1);
		mesh.add(object);
		mounts.push({ object, iframe, wrap });
		bindYtPlayer(iframe);
	}

	active = mounts.length > 0;
	/** Start od LED — potem LIVE, potem film, w cyklu. */
	applyFeedMode("led");
	scheduleAfter("led");
	startKeepAlive();
	return active;
}

export function disposeJumbotron(): void {
	clearSchedule();
	clearKeepAlive();
	onFilmVisibleCb = null;
	onFeedModeCb = null;
	disposeJumbotronBroadcast();
	for (const m of mounts) {
		m.object.removeFromParent();
		m.iframe.src = "about:blank";
		m.object.element.remove();
	}
	mounts = [];
	ytPlayers = [];
	active = false;
	filmVisible = false;
	feedMode = "led";
	mountedIsLive = false;
}
