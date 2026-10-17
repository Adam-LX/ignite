/**
 * Za bramką: tylko skrzydłowe jumbotrony LED (bez środkowego panelu).
 * Ekrany PRZED hex glass — hexy zostają na ścianach, nie na matrycy.
 */
import * as THREE from "three";

import { RL_ARENA } from "./arenaConstants";
import {
	disposeDotMatrixCapture,
	ensureDotMatrixCapture,
	sampleGameArt,
	sampleRotatingCar,
} from "./dotMatrixCapture";
import { RL } from "./materials";
import { RAMP_RUN } from "./perimeter/constants";
import { SOCCAR_GOAL } from "./soccarShell/profiles";

const BEZEL = 0.1;
const REFRESH_HZ = 24;

type TeamId = "blue" | "orange";

type MatrixAnim =
	| "logo"
	| "carSpin"
	| "gameArt"
	| "ballBounce"
	| "carChase"
	| "scroll"
	| "marquee"
	| "dualScroll"
	| "equalizer"
	| "strobe"
	| "fanChant"
	| "checker"
	| "radar"
	| "dualRadar"
	| "spiral"
	| "vortex"
	| "diamond"
	| "starBurst"
	| "scanSweep"
	| "helix"
	| "wave"
	| "rain"
	| "rings"
	| "zipper"
	| "countdown"
	| "pong"
	| "fireworks"
	| "snake"
	| "tunnel"
	| "glitch"
	| "confetti"
	| "typewriter"
	| "slotSpin"
	| "chevrons"
	| "scorebug"
	| "goalBurst";

type DotMatrixScreen = {
	team: TeamId;
	cols: number;
	rows: number;
	canvas: HTMLCanvasElement;
	ctx: CanvasRenderingContext2D;
	tex: THREE.CanvasTexture;
	mat: THREE.MeshBasicMaterial;
	phase: number;
	side: -1 | 1;
	mesh: THREE.Mesh | null;
};

type DisplayRig = {
	root: THREE.Group;
	screens: DotMatrixScreen[];
	team: TeamId;
	anim: MatrixAnim;
	animT: number;
	goalFlash: number;
};

const FONT_5X7: Record<string, number[]> = {
	A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
	B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
	C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
	D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
	E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
	F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
	G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0e],
	H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
	I: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x1f],
	J: [0x01, 0x01, 0x01, 0x01, 0x11, 0x11, 0x0e],
	K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
	L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
	M: [0x11, 0x1b, 0x15, 0x11, 0x11, 0x11, 0x11],
	N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
	O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
	P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
	Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
	R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
	S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
	T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
	U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
	V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
	W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11],
	X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
	Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
	Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
	"0": [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
	"1": [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
	"2": [0x0e, 0x11, 0x01, 0x06, 0x08, 0x10, 0x1f],
	"3": [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
	"4": [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
	"5": [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
	"6": [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
	"7": [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
	"8": [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
	"9": [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
	"!": [0x04, 0x04, 0x04, 0x04, 0x04, 0x00, 0x04],
	"?": [0x0e, 0x11, 0x01, 0x02, 0x04, 0x00, 0x04],
	"-": [0x00, 0x00, 0x00, 0x1f, 0x00, 0x00, 0x00],
	"/": [0x01, 0x01, 0x02, 0x04, 0x08, 0x10, 0x10],
	":": [0x00, 0x0c, 0x0c, 0x00, 0x0c, 0x0c, 0x00],
	"'": [0x04, 0x04, 0x08, 0x00, 0x00, 0x00, 0x00],
	".": [0x00, 0x00, 0x00, 0x00, 0x00, 0x0c, 0x0c],
	"*": [0x00, 0x04, 0x15, 0x0e, 0x15, 0x04, 0x00],
	" ": [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
};

/** Logo Ignite — płomień + I (11×13), czytelne na matrycy. */
const LOGO_IGNITE: number[] = [
	0b00001000000,
	0b00011100000,
	0b00111110000,
	0b01111111000,
	0b00111110000,
	0b00011100000,
	0b00001000000,
	0b00001000000,
	0b00111110000,
	0b00001000000,
	0b00001000000,
	0b00001000000,
	0b00111110000,
];

const IDLE_CYCLE: { anim: MatrixAnim; dur: number }[] = [
	{ anim: "scorebug", dur: 4.5 },
	{ anim: "pong", dur: 5.0 },
	{ anim: "strobe", dur: 3.5 },
	{ anim: "fireworks", dur: 5.0 },
	{ anim: "radar", dur: 4.5 },
	{ anim: "typewriter", dur: 4.5 },
	{ anim: "snake", dur: 4.5 },
	{ anim: "fanChant", dur: 4.0 },
	{ anim: "tunnel", dur: 4.5 },
	{ anim: "marquee", dur: 5.5 },
	{ anim: "glitch", dur: 4.0 },
	{ anim: "confetti", dur: 4.5 },
	{ anim: "carSpin", dur: 5.0 },
	{ anim: "slotSpin", dur: 4.5 },
	{ anim: "scorebug", dur: 4.0 },
	{ anim: "vortex", dur: 4.0 },
	{ anim: "dualScroll", dur: 4.5 },
	{ anim: "checker", dur: 3.5 },
	{ anim: "countdown", dur: 3.5 },
	{ anim: "helix", dur: 3.5 },
	{ anim: "equalizer", dur: 4.0 },
	{ anim: "starBurst", dur: 3.5 },
	{ anim: "rain", dur: 3.5 },
	{ anim: "scroll", dur: 4.0 },
	{ anim: "diamond", dur: 3.5 },
	{ anim: "zipper", dur: 3.5 },
	{ anim: "gameArt", dur: 4.5 },
	{ anim: "ballBounce", dur: 4.0 },
	{ anim: "scanSweep", dur: 3.5 },
	{ anim: "carChase", dur: 4.0 },
	{ anim: "logo", dur: 3.5 },
	{ anim: "chevrons", dur: 2.8 },
];

/** Krótkie — scroll / dual (i tak lecą w bok). */
const SCROLL_LINES: Record<TeamId, string[]> = {
	blue: [
		"IGNITE",
		"LET'S GO",
		"BLUE",
		"BOOST!",
		"NICE SHOT",
		"DEMO",
		"WALL RIDE",
		"CLUTCH",
		"ON FIRE",
		"LOCK IN",
		"OWN IT",
		"FLY",
	],
	orange: [
		"IGNITE",
		"LET'S GO",
		"ORANGE",
		"AERIAL!",
		"CENTER",
		"GO GO GO",
		"SONIC",
		"CLUTCH",
		"ON FIRE",
		"LOCK IN",
		"OWN IT",
		"FLY",
	],
};

const MARQUEE_LINES: Record<TeamId, string[]> = {
	blue: [
		"*** IGNITE ARENA ***  BOOST UP  ***  BLUE  ***  ",
		"*** NICE SHOT ***  CLOSE ONE ***  HUGE ***  ",
		"*** WALL TO AIR ***  PLAY HARD ***  ",
		"*** FULL BOOST ***  FULL SEND ***  LOCK IN ***  ",
		"*** DEMO TIME ***  DEFEND ***  ",
		"*** BLUE WAVE ***  NO MERCY ***  ",
	],
	orange: [
		"*** IGNITE ARENA ***  LIGHT IT UP  ***  ORANGE  ***  ",
		"*** GOOOAL ***  NEXT ***  SICK ***  ",
		"*** AERIAL ***  DEMO ***  CLEARED ***  ",
		"*** FULL BOOST ***  FULL SEND ***  LOCK IN ***  ",
		"*** CENTER IT ***  ON FIRE ***  ",
		"*** ORANGE ***  NO MERCY ***  ",
	],
};

/**
 * Hasła na środek ekranu (strobe / radar / itd.).
 * Max ~8–9 znaków przy 56 kolumnach Orbitron — dłuższe i tak shrinkuje fit.
 */
const STROBE_LINES: Record<TeamId, string[]> = {
	blue: [
		"HIT IT!",
		"GO!",
		"BOOST!",
		"SCORE!",
		"PUSH!",
		"NOW!",
		"FIRE!",
		"WIN!",
		"SMASH!",
		"BLUE!",
		"DEMO!",
		"FLIP!",
		"FLY!",
		"RUSH!",
		"YES!",
		"HUGE!",
		"CLUTCH!",
		"SEND!",
		"OWN IT!",
		"LOCK!",
		"DRIVE!",
		"CHARGE!",
		"CLEAR!",
		"RESET!",
		"BANG!",
		"RIP!",
		"YES!",
		"GO GO!",
	],
	orange: [
		"HIT IT!",
		"GO!",
		"BOOST!",
		"SCORE!",
		"PUSH!",
		"NOW!",
		"FIRE!",
		"WIN!",
		"SMASH!",
		"ORANGE!",
		"DEMO!",
		"FLIP!",
		"FLY!",
		"RUSH!",
		"YES!",
		"HUGE!",
		"CLUTCH!",
		"SEND!",
		"OWN IT!",
		"LOCK!",
		"DRIVE!",
		"CHARGE!",
		"CLEAR!",
		"RESET!",
		"BANG!",
		"RIP!",
		"YES!",
		"GO GO!",
	],
};

let rigs: DisplayRig[] = [];
let refreshAcc = 0;
let globalTime = 0;
let lastFrameDt = 1 / 60;
/** Wspólny capture auta — jeden render / tick dla obu skrzydeł. */
let sharedCarFrame: Uint8Array | null = null;
let sharedCarStamp = -1;
/** Żywy wynik z meczu — scorebug LED = HUD. */
let matchBlueScore = 0;
let matchOrangeScore = 0;

export function setDotMatrixMatchScore(blue: number, orange: number): void {
	matchBlueScore = Math.max(0, Math.floor(blue));
	matchOrangeScore = Math.max(0, Math.floor(orange));
}

function matchScoreLine(): string {
	return `${matchBlueScore}-${matchOrangeScore}`;
}

function teamScoreLine(team: TeamId): string {
	const n = team === "blue" ? matchBlueScore : matchOrangeScore;
	return team === "blue" ? `BLUE ${n}` : `ORANGE ${n}`;
}

function litColors(team: TeamId): { core: string; glow: string; dim: string } {
	if (team === "blue") {
		return { core: "#e8f7ff", glow: "#3dc4ff", dim: "#031018" };
	}
	return { core: "#fff0e0", glow: "#ff9a3c", dim: "#140806" };
}

function setPx(
	buf: Uint8Array,
	cols: number,
	rows: number,
	x: number,
	y: number,
	v = 2,
): void {
	const xi = Math.round(x);
	const yi = Math.round(y);
	if (xi < 0 || yi < 0 || xi >= cols || yi >= rows) return;
	const i = yi * cols + xi;
	buf[i] = Math.max(buf[i]!, v);
}

/** Nadpisanie (negatyw / carve w stroboskopie). */
function setPxRaw(
	buf: Uint8Array,
	cols: number,
	rows: number,
	x: number,
	y: number,
	v: number,
): void {
	const xi = Math.round(x);
	const yi = Math.round(y);
	if (xi < 0 || yi < 0 || xi >= cols || yi >= rows) return;
	buf[yi * cols + xi] = v;
}

function fillRect(
	buf: Uint8Array,
	cols: number,
	rows: number,
	x0: number,
	y0: number,
	w: number,
	h: number,
	v = 2,
): void {
	for (let y = y0; y < y0 + h; y++) {
		for (let x = x0; x < x0 + w; x++) setPx(buf, cols, rows, x, y, v);
	}
}

/** Orbitron (display gry) → kropki LED; 5×7 tylko jako fallback bez canvas. */
const LED_FONT_FAMILY = 'Orbitron, "Segoe UI", system-ui, sans-serif';
const LED_SSAA = 3;
let ledTextCanvas: HTMLCanvasElement | null = null;
let ledTextCtx: CanvasRenderingContext2D | null = null;
let ledFontWarm = false;

function normalizeLedText(text: string): string {
	return text.toUpperCase().replace(/[^\w\s!\?\-\/:'.*]/g, "");
}

function warmLedFont(): void {
	if (ledFontWarm || typeof document === "undefined") return;
	ledFontWarm = true;
	void document.fonts?.load?.(`900 48px ${LED_FONT_FAMILY}`);
	void document.fonts?.load?.(`800 24px ${LED_FONT_FAMILY}`);
}

function getLedTextCtx(): CanvasRenderingContext2D | null {
	if (typeof document === "undefined") return null;
	if (!ledTextCanvas) {
		ledTextCanvas = document.createElement("canvas");
		ledTextCanvas.width = 8;
		ledTextCanvas.height = 8;
		ledTextCtx = ledTextCanvas.getContext("2d", {
			willReadFrequently: true,
			alpha: false,
		});
	}
	return ledTextCtx;
}

function ledGlyphH(rows: number): number {
	return Math.max(9, Math.min(14, rows - 2));
}

function ledFontCss(px: number): string {
	return `900 ${px}px ${LED_FONT_FAMILY}`;
}

function measureLedText(text: string, rows: number, glyphH = ledGlyphH(rows)): number {
	const norm = normalizeLedText(text);
	if (!norm) return 0;
	const ctx = getLedTextCtx();
	if (!ctx) return Math.max(1, norm.length * 6);
	warmLedFont();
	ctx.font = ledFontCss(glyphH);
	return Math.max(1, Math.ceil(ctx.measureText(norm).width));
}

/** Zmniejsz font aż napis wejdzie w szerokość matrycy. */
function fitLedGlyphH(text: string, cols: number, rows: number, pad = 2): number {
	let h = ledGlyphH(rows);
	const maxW = Math.max(10, cols - pad);
	const norm = normalizeLedText(text);
	while (h > 6 && measureLedText(norm, rows, h) > maxW) h -= 1;
	return h;
}

function ledTextOy(rows: number, glyphH = ledGlyphH(rows)): number {
	return Math.max(0, ((rows - glyphH) / 2) | 0);
}

function blitTextBitmap(
	buf: Uint8Array,
	cols: number,
	rows: number,
	text: string,
	ox: number,
	oy: number,
	v = 2,
	scale = 1,
): void {
	const s = Math.max(1, scale | 0);
	let x = ox;
	for (const ch of normalizeLedText(text)) {
		const glyph = FONT_5X7[ch] ?? FONT_5X7[" "];
		if (glyph) {
			for (let row = 0; row < 7; row++) {
				const bits = glyph[row] ?? 0;
				for (let col = 0; col < 5; col++) {
					if (((bits >> (4 - col)) & 1) === 0) continue;
					for (let dy = 0; dy < s; dy++) {
						for (let dx = 0; dx < s; dx++) {
							if (v === 0) {
								setPxRaw(buf, cols, rows, x + col * s + dx, oy + row * s + dy, 0);
							} else {
								setPx(buf, cols, rows, x + col * s + dx, oy + row * s + dy, v);
							}
						}
					}
				}
			}
		}
		x += 6 * s;
	}
}

function blitText(
	buf: Uint8Array,
	cols: number,
	rows: number,
	text: string,
	ox: number,
	oy: number,
	v = 2,
	glyphH = fitLedGlyphH(text, cols, rows),
): void {
	if (!text) return;
	const norm = normalizeLedText(text);
	const ctx = getLedTextCtx();
	if (!ctx || !ledTextCanvas) {
		const scale = Math.max(1, Math.round(glyphH / 7));
		blitTextBitmap(buf, cols, rows, norm, ox, oy, v, scale);
		return;
	}
	warmLedFont();
	const ss = LED_SSAA;
	const fontPx = Math.max(8, glyphH * ss);
	ctx.font = ledFontCss(fontPx);
	const textW = Math.ceil(ctx.measureText(norm).width);
	if (textW < 2) {
		blitTextBitmap(buf, cols, rows, norm, ox, oy, v, Math.max(1, Math.round(glyphH / 7)));
		return;
	}
	const padX = 1;
	const padY = 1;
	const w = textW + padX * 2;
	const h = fontPx + padY * 2;
	if (ledTextCanvas.width < w || ledTextCanvas.height < h) {
		ledTextCanvas.width = Math.max(w, 32);
		ledTextCanvas.height = Math.max(h, 32);
	}
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.fillStyle = "#000000";
	ctx.fillRect(0, 0, w, h);
	ctx.fillStyle = "#ffffff";
	ctx.textBaseline = "top";
	ctx.textAlign = "left";
	ctx.font = ledFontCss(fontPx);
	ctx.fillText(norm, padX, padY);
	const { data } = ctx.getImageData(0, 0, w, h);
	const outW = Math.ceil(w / ss);
	const outH = Math.ceil(h / ss);
	for (let ly = 0; ly < outH; ly++) {
		for (let lx = 0; lx < outW; lx++) {
			let sum = 0;
			let n = 0;
			for (let dy = 0; dy < ss; dy++) {
				for (let dx = 0; dx < ss; dx++) {
					const sx = lx * ss + dx;
					const sy = ly * ss + dy;
					if (sx >= w || sy >= h) continue;
					sum += data[(sy * w + sx) * 4]!;
					n++;
				}
			}
			const lum = n > 0 ? sum / n : 0;
			if (lum < 55) continue;
			const level = lum > 140 ? 2 : 1;
			if (v === 0) {
				setPxRaw(buf, cols, rows, ox + lx, oy + ly, 0);
			} else {
				setPx(buf, cols, rows, ox + lx, oy + ly, v === 1 ? Math.min(1, level) : level);
			}
		}
	}
}

/** Wyśrodkowany napis Orbitron z auto-fit do cols. */
function blitCentered(
	buf: Uint8Array,
	cols: number,
	rows: number,
	text: string,
	v = 2,
): void {
	if (!text) return;
	const gh = fitLedGlyphH(text, cols, rows);
	const tw = measureLedText(text, rows, gh);
	const ox = Math.floor((cols - tw) * 0.5);
	const oy = ledTextOy(rows, gh);
	blitText(buf, cols, rows, text, ox, oy, v, gh);
}

function pickStrobe(team: TeamId, t: number, rate = 2): string {
	const lines = STROBE_LINES[team];
	const n = lines.length;
	if (n === 0) return "IGNITE";
	/** co ~4 hasła wstaw wynik z meczu */
	const raw = Math.floor(t * rate);
	if (raw % 4 === 0) return matchScoreLine();
	if (raw % 4 === 2) return teamScoreLine(team);
	const idx = ((raw % n) + n) % n;
	return lines[idx] ?? "IGNITE";
}

function blitLogo(
	buf: Uint8Array,
	cols: number,
	rows: number,
	ox: number,
	oy: number,
	pulse: number,
): void {
	const v = pulse > 0.55 ? 2 : 1;
	const scale = 2;
	for (let row = 0; row < LOGO_IGNITE.length; row++) {
		const bits = LOGO_IGNITE[row]!;
		for (let col = 0; col < 11; col++) {
			if (((bits >> (10 - col)) & 1) === 0) continue;
			for (let dy = 0; dy < scale; dy++) {
				for (let dx = 0; dx < scale; dx++) {
					setPx(buf, cols, rows, ox + col * scale + dx, oy + row * scale + dy, v);
				}
			}
		}
	}
}

function blitBall(
	buf: Uint8Array,
	cols: number,
	rows: number,
	cx: number,
	cy: number,
	r: number,
): void {
	const rr = r * r;
	for (let y = -r - 1; y <= r + 1; y++) {
		for (let x = -r - 1; x <= r + 1; x++) {
			const d = x * x + y * y;
			if (d <= rr) setPx(buf, cols, rows, cx + x, cy + y, 2);
			else if (d <= (r + 1.1) * (r + 1.1)) setPx(buf, cols, rows, cx + x, cy + y, 1);
		}
	}
	/** Hex „piłka” — 2 kropki jak panele. */
	setPx(buf, cols, rows, cx - 1, cy - 1, 1);
	setPx(buf, cols, rows, cx + 1, cy, 1);
}

function blitCar(
	buf: Uint8Array,
	cols: number,
	rows: number,
	x: number,
	y: number,
	dir: -1 | 1,
): void {
	fillRect(buf, cols, rows, x, y, 9, 3, 2);
	fillRect(buf, cols, rows, x + (dir > 0 ? 2 : 1), y - 2, 5, 2, 2);
	setPx(buf, cols, rows, x + 1, y + 3, 2);
	setPx(buf, cols, rows, x + 7, y + 3, 2);
	/** Boost. */
	for (let i = 1; i <= 5; i++) {
		setPx(buf, cols, rows, x - dir * (i + 1), y + 1, i % 2 === 0 ? 2 : 1);
		setPx(buf, cols, rows, x - dir * (i + 1), y + (i % 2), 1);
	}
}

function paintBuffer(screen: DotMatrixScreen, buf: Uint8Array): void {
	const { ctx, cols, rows, canvas, team } = screen;
	const { core, glow, dim } = litColors(team);
	const cw = canvas.width / cols;
	const ch = canvas.height / rows;
	ctx.fillStyle = "#000208";
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	for (let y = 0; y < rows; y++) {
		for (let x = 0; x < cols; x++) {
			const v = buf[y * cols + x]!;
			ctx.fillStyle = v >= 2 ? core : v === 1 ? glow : dim;
			const pad = v > 0 ? Math.max(0.2, cw * 0.08) : Math.max(0.45, cw * 0.18);
			ctx.fillRect(x * cw + pad, y * ch + pad, cw - pad * 2, ch - pad * 2);
		}
	}
	screen.tex.needsUpdate = true;
}

function fillAnim(
	screen: DotMatrixScreen,
	anim: MatrixAnim,
	t: number,
	goalFlash: number,
	animT: number,
): void {
	const { cols, rows, phase, team, side } = screen;
	const buf = new Uint8Array(cols * rows);
	const tt = t + phase;

	if (goalFlash > 0.02 || anim === "goalBurst") {
		const flash = Math.max(goalFlash / 2.4, 0.4);
		for (let i = 0; i < buf.length; i++) {
			const x = i % cols;
			const y = (i / cols) | 0;
			const ring = Math.hypot(x - cols * 0.5, y - rows * 0.5);
			if (ring < flash * Math.max(cols, rows) * 0.75 || Math.sin(tt * 32 + x) > 0)
				buf[i] = 2;
		}
		/** Najpierw GOAL, potem żywy wynik z meczu (jak HUD). */
		const label =
			goalFlash > 1.15 ? "GOAL!" : matchScoreLine();
		blitCentered(buf, cols, rows, label, 2);
	} else if (anim === "scorebug") {
		const pulse = Math.sin(tt * 4.2) * 0.5 + 0.5;
		for (let x = 0; x < cols; x++) {
			setPx(buf, cols, rows, x, 1, 1);
			setPx(buf, cols, rows, x, rows - 2, 1);
		}
		const phase = Math.floor(animT / 1.4) % 3;
		const label =
			phase === 0
				? matchScoreLine()
				: phase === 1
					? teamScoreLine(team)
					: team === "blue"
						? "BLUE"
						: "ORANGE";
		blitCentered(buf, cols, rows, label, pulse > 0.35 ? 2 : 1);
	} else if (anim === "carSpin") {
		const stamp = (globalTime * REFRESH_HZ) | 0;
		if (
			!sharedCarFrame ||
			sharedCarFrame.length !== cols * rows ||
			sharedCarStamp !== stamp
		) {
			if (!sharedCarFrame || sharedCarFrame.length !== cols * rows) {
				sharedCarFrame = new Uint8Array(cols * rows);
			}
			const ok = sampleRotatingCar(
				cols,
				rows,
				lastFrameDt,
				sharedCarFrame,
				0.9,
			);
			sharedCarStamp = stamp;
			if (!ok) {
				/** Fallback procedural — capture jeszcze ładuje GLB. */
				blitCar(buf, cols, rows, cols * 0.35, rows * 0.45, side);
				blitBall(buf, cols, rows, cols * 0.7, rows * 0.4, 3);
				paintBuffer(screen, buf);
				return;
			}
		}
		buf.set(sharedCarFrame);
	} else if (anim === "gameArt") {
		const artIdx =
			Math.floor(animT / 2.4) + (side > 0 ? 1 : 0) + (team === "orange" ? 3 : 0);
		const ok = sampleGameArt(cols, rows, artIdx, buf);
		if (!ok) {
			const pulse = Math.sin(tt * 3.2) * 0.5 + 0.5;
			const logoW = 11 * 2;
			const logoH = LOGO_IGNITE.length * 2;
			blitLogo(
				buf,
				cols,
				rows,
				Math.floor(cols * 0.5 - logoW * 0.5),
				Math.floor(rows * 0.42 - logoH * 0.5),
				pulse,
			);
		}
	} else if (anim === "logo") {
		const pulse = Math.sin(tt * 3.2) * 0.5 + 0.5;
		const logoW = 11 * 2;
		const logoH = LOGO_IGNITE.length * 2;
		const ox = Math.floor(cols * 0.5 - logoW * 0.5);
		const oy = Math.floor(rows * 0.42 - logoH * 0.5);
		blitLogo(buf, cols, rows, ox, oy, pulse);
		for (let x = 0; x < cols; x++) {
			setPx(buf, cols, rows, x, 0, 1);
			setPx(buf, cols, rows, x, rows - 1, 1);
		}
		for (let y = 0; y < rows; y++) {
			setPx(buf, cols, rows, 0, y, 1);
			setPx(buf, cols, rows, cols - 1, y, 1);
		}
		const igniteW = measureLedText("IGNITE", rows, fitLedGlyphH("IGNITE", cols, rows));
		const igniteH = fitLedGlyphH("IGNITE", cols, rows);
		blitText(
			buf,
			cols,
			rows,
			"IGNITE",
			Math.floor((cols - igniteW) * 0.5),
			Math.min(rows - igniteH - 1, oy + logoH + 1),
			2,
			igniteH,
		);
	} else if (anim === "ballBounce") {
		const cx = ((tt * 8) % (cols + 8)) - 4;
		const cy = 4 + Math.abs(Math.sin(tt * 4.8)) * (rows - 10);
		blitBall(buf, cols, rows, cx, cy, 5);
		for (let x = Math.floor(cx - 6); x <= cx + 6; x++) {
			setPx(buf, cols, rows, x, rows - 1, 1);
		}
	} else if (anim === "carChase") {
		const dir = side;
		const carX =
			dir > 0
				? ((tt * 11) % (cols + 20)) - 14
				: cols + 14 - ((tt * 11) % (cols + 20));
		const carY = Math.floor(rows * 0.4);
		blitCar(buf, cols, rows, carX, carY, dir);
		const bx = carX + dir * 16;
		const by = carY + Math.sin(tt * 6) * 2;
		blitBall(buf, cols, rows, bx, by, 3);
	} else if (anim === "scroll") {
		const lines = SCROLL_LINES[team];
		const line = lines[Math.floor(animT / 2.2) % lines.length]!;
		const textW = measureLedText(line, rows);
		const scroll = ((tt * 14) % (textW + cols + 4)) - 8;
		const oy = ledTextOy(rows);
		blitText(buf, cols, rows, line, Math.floor(-scroll), oy, 2);
		for (let x = 0; x < cols; x++) {
			if (((x + ((tt * 9) | 0)) & 2) === 0) {
				setPx(buf, cols, rows, x, 0, 1);
				setPx(buf, cols, rows, x, rows - 1, 1);
			}
		}
	} else if (anim === "marquee") {
		const lines = MARQUEE_LINES[team];
		const line = lines[Math.floor(animT / 6.5) % lines.length]!;
		const textW = measureLedText(line, rows);
		const scroll = ((tt * 16) % Math.max(1, textW));
		const oy = ledTextOy(rows);
		/** Pętla bez dziury — drugi odcinek za pierwszym. */
		blitText(buf, cols, rows, line, Math.floor(-scroll), oy, 2);
		blitText(buf, cols, rows, line, Math.floor(-scroll + textW), oy, 2);
		for (let x = 0; x < cols; x++) {
			const sparkle = ((x * 3 + ((tt * 18) | 0)) % 7) === 0;
			setPx(buf, cols, rows, x, 0, sparkle ? 2 : 1);
			setPx(buf, cols, rows, x, rows - 1, sparkle ? 2 : 1);
		}
		/** Małe „★” / gwiazdki po bokach. */
		const twinkle = (Math.sin(tt * 9) * 0.5 + 0.5) > 0.55 ? 2 : 1;
		setPx(buf, cols, rows, 1, oy - 1, twinkle);
		setPx(buf, cols, rows, cols - 2, oy + fitLedGlyphH(line, cols, rows), twinkle);
	} else if (anim === "dualScroll") {
		const lines = SCROLL_LINES[team];
		const top = lines[Math.floor(animT / 2.0) % lines.length]!;
		const bot =
			lines[(Math.floor(animT / 2.0) + 3) % lines.length]!;
		const topW = measureLedText(top, rows);
		const botW = measureLedText(bot, rows);
		const scrollTop = ((tt * 15) % (topW + cols + 6)) - 6;
		const scrollBot = ((tt * 13) % (botW + cols + 6)) - 6;
		const gh = fitLedGlyphH(top, cols, rows);
		const oyTop = Math.max(1, ((rows * 0.28 - gh * 0.5) | 0));
		const oyBot = Math.min(rows - gh - 1, ((rows * 0.72 - gh * 0.5) | 0));
		blitText(buf, cols, rows, top, Math.floor(-scrollTop), oyTop, 2);
		/** Dolny rząd w przeciwną stronę. */
		blitText(
			buf,
			cols,
			rows,
			bot,
			Math.floor(scrollBot - botW + cols * 0.15),
			oyBot,
			2,
		);
		/** Separator po środku. */
		const midY = ((rows - 1) / 2) | 0;
		for (let x = 0; x < cols; x++) {
			if (((x + ((tt * 12) | 0)) & 1) === 0) {
				setPx(buf, cols, rows, x, midY, 1);
			}
		}
	} else if (anim === "equalizer") {
		const bars = Math.max(8, Math.floor(cols / 3));
		const barW = Math.max(2, Math.floor(cols / bars) - 1);
		const gap = 1;
		const baseY = rows - 2;
		for (let i = 0; i < bars; i++) {
			const hx =
				0.25 +
				0.75 *
					(0.55 +
						0.45 *
							Math.sin(tt * 5.2 + i * 0.85) *
							Math.sin(tt * 2.1 + i * 0.37));
			const h = Math.max(2, Math.floor(hx * (rows - 10)));
			const x0 = 1 + i * (barW + gap);
			fillRect(buf, cols, rows, x0, baseY - h, barW, h, i % 2 === 0 ? 2 : 1);
			setPx(buf, cols, rows, x0 + (barW >> 1), baseY - h - 1, 2);
		}
		const tip = SCROLL_LINES[team][Math.floor(animT / 1.8) % SCROLL_LINES[team].length]!;
		const tipW = measureLedText(tip, rows);
		const scroll = ((tt * 18) % (tipW + cols + 4)) - 4;
		blitText(buf, cols, rows, tip, Math.floor(-scroll), 1, 2);
	} else if (anim === "strobe") {
		const flashHz = 12;
		const flash = ((tt * flashHz) | 0) & 1;
		const line = pickStrobe(team, tt, flashHz * 0.42);
		if (flash === 0) {
			buf.fill(2);
			blitCentered(buf, cols, rows, line, 0);
			for (let x = 0; x < cols; x++) {
				setPxRaw(buf, cols, rows, x, 0, 0);
				setPxRaw(buf, cols, rows, x, rows - 1, 0);
			}
			for (let y = 0; y < rows; y++) {
				setPxRaw(buf, cols, rows, 0, y, 0);
				setPxRaw(buf, cols, rows, cols - 1, y, 0);
			}
		} else {
			blitCentered(buf, cols, rows, line, 2);
			for (let x = 0; x < cols; x++) {
				if (((x + ((tt * 40) | 0)) & 3) < 2) {
					setPx(buf, cols, rows, x, 1, 2);
					setPx(buf, cols, rows, x, rows - 2, 2);
				}
			}
		}
	} else if (anim === "fanChant") {
		const beat = Math.floor(tt * 3.4);
		const line = STROBE_LINES[team][beat % STROBE_LINES[team].length]!;
		const invert = beat % 2 === 0;
		if (invert) {
			buf.fill(2);
			blitCentered(buf, cols, rows, line, 0);
		} else {
			for (let x = 0; x < cols; x++) {
				setPx(buf, cols, rows, x, 0, 2);
				setPx(buf, cols, rows, x, rows - 1, 2);
			}
			for (let y = 0; y < rows; y++) {
				setPx(buf, cols, rows, 0, y, 2);
				setPx(buf, cols, rows, cols - 1, y, 2);
			}
			blitCentered(buf, cols, rows, line, 2);
		}
	} else if (anim === "checker") {
		const line = pickStrobe(team, tt, 2.2);
		const flip = ((tt * 8) | 0) & 1;
		const cell = 3;
		for (let y = 0; y < rows; y++) {
			for (let x = 0; x < cols; x++) {
				const c = ((x / cell) | 0) + ((y / cell) | 0);
				const on = ((c + flip) & 1) === 0;
				if (on) setPx(buf, cols, rows, x, y, 2);
			}
		}
		if (flip === 0) blitCentered(buf, cols, rows, line, 0);
		else blitCentered(buf, cols, rows, line, 2);
	} else if (anim === "radar") {
		const cx = (cols - 1) * 0.5;
		const cy = (rows - 1) * 0.5;
		const ang = tt * 4.2;
		const beam = 0.22;
		for (let y = 0; y < rows; y++) {
			for (let x = 0; x < cols; x++) {
				const dx = x - cx;
				const dy = y - cy;
				const a = Math.atan2(dy, dx);
				let d = a - ang;
				while (d > Math.PI) d -= Math.PI * 2;
				while (d < -Math.PI) d += Math.PI * 2;
				const r = Math.hypot(dx, dy);
				if (Math.abs(d) < beam) setPx(buf, cols, rows, x, y, 2);
				else if (Math.abs(d) < beam * 2.4) setPx(buf, cols, rows, x, y, 1);
				if (r > 2 && Math.abs((r - (tt * 9) % 14) % 14) < 0.7) {
					setPx(buf, cols, rows, x, y, 1);
				}
			}
		}
		blitCentered(buf, cols, rows, pickStrobe(team, tt, 1.6), 2);
	} else if (anim === "dualRadar") {
		const cx = (cols - 1) * 0.5;
		const cy = (rows - 1) * 0.5;
		const a0 = tt * 3.6;
		const a1 = -tt * 2.8 + Math.PI * 0.5;
		for (let y = 0; y < rows; y++) {
			for (let x = 0; x < cols; x++) {
				const dx = x - cx;
				const dy = y - cy;
				const a = Math.atan2(dy, dx);
				const wrap = (d: number) => {
					let v = d;
					while (v > Math.PI) v -= Math.PI * 2;
					while (v < -Math.PI) v += Math.PI * 2;
					return v;
				};
				const d0 = Math.abs(wrap(a - a0));
				const d1 = Math.abs(wrap(a - a1));
				if (d0 < 0.16 || d1 < 0.16) setPx(buf, cols, rows, x, y, 2);
				else if (d0 < 0.34 || d1 < 0.34) setPx(buf, cols, rows, x, y, 1);
				const r = Math.hypot(dx, dy);
				if (((r + tt * 6) | 0) % 5 === 0) setPx(buf, cols, rows, x, y, 1);
			}
		}
		blitCentered(buf, cols, rows, pickStrobe(team, tt, 1.8), 2);
	} else if (anim === "spiral") {
		const cx = (cols - 1) * 0.5;
		const cy = (rows - 1) * 0.5;
		const spin = tt * 3.2;
		for (let y = 0; y < rows; y++) {
			for (let x = 0; x < cols; x++) {
				const dx = x - cx;
				const dy = y - cy;
				const r = Math.hypot(dx, dy);
				const a = Math.atan2(dy, dx);
				const arm = (a * 2.2 + r * 0.55 - spin) % (Math.PI * 2);
				const band = Math.abs(((arm + Math.PI * 2) % (Math.PI * 2)) - Math.PI);
				if (band < 0.35) setPx(buf, cols, rows, x, y, 2);
				else if (band < 0.7) setPx(buf, cols, rows, x, y, 1);
			}
		}
		blitCentered(buf, cols, rows, pickStrobe(team, tt, 1.7), 2);
	} else if (anim === "vortex") {
		const cx = (cols - 1) * 0.5;
		const cy = (rows - 1) * 0.5;
		const spin = tt * 5.5;
		for (let y = 0; y < rows; y++) {
			for (let x = 0; x < cols; x++) {
				const dx = x - cx;
				const dy = y - cy;
				const r = Math.hypot(dx, dy) + 0.001;
				const a = Math.atan2(dy, dx) + spin / (0.6 + r * 0.18);
				const swirl = Math.sin(a * 3 + r * 0.8);
				if (swirl > 0.55) setPx(buf, cols, rows, x, y, 2);
				else if (swirl > 0.15) setPx(buf, cols, rows, x, y, 1);
			}
		}
		blitCentered(buf, cols, rows, pickStrobe(team, tt, 2.0), 2);
	} else if (anim === "diamond") {
		const cx = (cols - 1) * 0.5;
		const cy = (rows - 1) * 0.5;
		const ang = tt * 2.4;
		const cos = Math.cos(ang);
		const sin = Math.sin(ang);
		const pulse = 6 + Math.sin(tt * 4) * 3;
		for (let y = 0; y < rows; y++) {
			for (let x = 0; x < cols; x++) {
				const dx = x - cx;
				const dy = y - cy;
				const rx = dx * cos - dy * sin;
				const ry = dx * sin + dy * cos;
				const m = Math.abs(rx) + Math.abs(ry);
				const ring = Math.abs(m - pulse);
				if (ring < 0.9) setPx(buf, cols, rows, x, y, 2);
				else if (ring < 1.8 || m < pulse * 0.35) setPx(buf, cols, rows, x, y, 1);
			}
		}
		blitCentered(buf, cols, rows, pickStrobe(team, tt, 1.5), 2);
	} else if (anim === "starBurst") {
		const cx = (cols - 1) * 0.5;
		const cy = (rows - 1) * 0.5;
		const spin = tt * 1.8;
		const rays = 10;
		for (let y = 0; y < rows; y++) {
			for (let x = 0; x < cols; x++) {
				const dx = x - cx;
				const dy = y - cy;
				const a = Math.atan2(dy, dx) + spin;
				const slot = ((a / (Math.PI * 2)) * rays + 20) % 1;
				const r = Math.hypot(dx, dy);
				if (slot < 0.28 && r > 1) setPx(buf, cols, rows, x, y, 2);
				else if (slot < 0.42 && r > 1) setPx(buf, cols, rows, x, y, 1);
				if (r < 2.2) setPx(buf, cols, rows, x, y, 2);
			}
		}
		blitCentered(buf, cols, rows, pickStrobe(team, tt, 1.9), 2);
	} else if (anim === "scanSweep") {
		const sweepY = ((tt * 14) % (rows + 4)) - 2;
		for (let y = 0; y < rows; y++) {
			const d = Math.abs(y - sweepY);
			const rowLit = d < 1.2 ? 2 : d < 2.5 ? 1 : 0;
			for (let x = 0; x < cols; x++) {
				if (rowLit) setPx(buf, cols, rows, x, y, rowLit);
				if (((x + ((tt * 30) | 0)) & 7) === 0) setPx(buf, cols, rows, x, y, 1);
			}
		}
		blitCentered(buf, cols, rows, pickStrobe(team, tt, 2.2), 2);
	} else if (anim === "helix") {
		for (let x = 0; x < cols; x++) {
			const t = x * 0.35 + tt * 4.5;
			const y0 = rows * 0.5 + Math.sin(t) * (rows * 0.32);
			const y1 = rows * 0.5 + Math.sin(t + Math.PI) * (rows * 0.32);
			setPx(buf, cols, rows, x, y0, 2);
			setPx(buf, cols, rows, x, y0 - 1, 1);
			setPx(buf, cols, rows, x, y1, 2);
			setPx(buf, cols, rows, x, y1 + 1, 1);
			if ((x + ((tt * 8) | 0)) % 6 === 0) {
				const mid = (y0 + y1) * 0.5;
				setPx(buf, cols, rows, x, mid, 1);
			}
		}
		blitCentered(buf, cols, rows, pickStrobe(team, tt, 1.4), 2);
	} else if (anim === "wave") {
		const lines = SCROLL_LINES[team];
		const line = lines[Math.floor(animT / 2.4) % lines.length]!;
		for (let y = 0; y < rows; y++) {
			for (let x = 0; x < cols; x++) {
				const n =
					Math.sin(x * 0.35 + tt * 5.5) * 0.55 +
					Math.sin(y * 0.55 - tt * 3.2) * 0.45;
				if (n > 0.35) setPx(buf, cols, rows, x, y, 2);
				else if (n > 0.05) setPx(buf, cols, rows, x, y, 1);
			}
		}
		const gh = fitLedGlyphH(line, cols, rows);
		const textW = measureLedText(line, rows, gh);
		const scroll = ((tt * 12) % (textW + cols + 4)) - 6;
		blitText(buf, cols, rows, line, Math.floor(-scroll), ledTextOy(rows, gh), 2, gh);
	} else if (anim === "rain") {
		const seed = (x: number, y: number) => {
			const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
			return n - Math.floor(n);
		};
		for (let x = 0; x < cols; x++) {
			const speed = 8 + seed(x, 1) * 14;
			const len = 3 + ((seed(x, 2) * 6) | 0);
			const head = ((tt * speed + seed(x, 3) * 40) % (rows + len)) | 0;
			for (let i = 0; i < len; i++) {
				const y = head - i;
				if (y < 0 || y >= rows) continue;
				setPx(buf, cols, rows, x, y, i === 0 ? 2 : 1);
			}
		}
		const tip = pickStrobe(team, tt, 2.5);
		const flash = ((tt * 6) | 0) & 1;
		if (flash === 0) {
			const gh = fitLedGlyphH(tip, cols, rows);
			const oy = ledTextOy(rows, gh);
			for (let y = oy - 1; y <= oy + gh; y++) {
				for (let x = 0; x < cols; x++) setPxRaw(buf, cols, rows, x, y, 0);
			}
			blitCentered(buf, cols, rows, tip, 2);
		}
	} else if (anim === "rings") {
		const cx = (cols - 1) * 0.5;
		const cy = (rows - 1) * 0.5;
		const maxR = Math.hypot(cx, cy) + 2;
		const pulse = (tt * 10) % maxR;
		for (let y = 0; y < rows; y++) {
			for (let x = 0; x < cols; x++) {
				const r = Math.hypot(x - cx, y - cy);
				const d = Math.abs(r - pulse);
				const d2 = Math.abs(r - ((pulse + maxR * 0.45) % maxR));
				if (d < 0.85 || d2 < 0.7) setPx(buf, cols, rows, x, y, 2);
				else if (d < 1.6 || d2 < 1.4) setPx(buf, cols, rows, x, y, 1);
			}
		}
		blitCentered(buf, cols, rows, pickStrobe(team, tt, 2.0), 2);
	} else if (anim === "zipper") {
		const line = pickStrobe(team, tt / 1.5, 1);
		const gh = fitLedGlyphH(line, cols, rows);
		const textW = measureLedText(line, rows, gh);
		const open = ((Math.sin(tt * 3.5) * 0.5 + 0.5) * (cols * 0.5 + 2)) | 0;
		for (let y = 0; y < rows; y++) {
			for (let x = 0; x < cols; x++) {
				const mid = cols * 0.5;
				if (x < mid - open || x > mid + open) {
					setPx(buf, cols, rows, x, y, ((x + y + ((tt * 20) | 0)) & 1) === 0 ? 2 : 1);
				}
			}
		}
		if (open > textW * 0.35) blitCentered(buf, cols, rows, line, 2);
	} else if (anim === "countdown") {
		const seq = ["3", "2", "1", "GO!", "HIT!", "BOOST!"];
		const step = Math.floor(animT / 0.65) % seq.length;
		const label = seq[step]!;
		const flash = ((tt * 14) | 0) & 1;
		if (flash === 0 || step >= 3) {
			if (step >= 3 && flash === 0) buf.fill(2);
			blitCentered(buf, cols, rows, label, step >= 3 && flash === 0 ? 0 : 2);
		} else {
			blitCentered(buf, cols, rows, label, 2);
			for (let x = 0; x < cols; x++) {
				setPx(buf, cols, rows, x, 0, 1);
				setPx(buf, cols, rows, x, rows - 1, 1);
			}
		}
	} else if (anim === "pong") {
		/** Arcade Pong — piłka + paletki. */
		const padH = Math.max(5, (rows * 0.28) | 0);
		const padY0 =
			((Math.sin(tt * 2.4) * 0.5 + 0.5) * (rows - padH - 2) + 1) | 0;
		const padY1 =
			((Math.sin(tt * 2.9 + 1.7) * 0.5 + 0.5) * (rows - padH - 2) + 1) | 0;
		fillRect(buf, cols, rows, 1, padY0, 2, padH, 2);
		fillRect(buf, cols, rows, cols - 3, padY1, 2, padH, 2);
		const bx = ((tt * 22) % ((cols - 8) * 2));
		const by = ((tt * 17) % ((rows - 6) * 2));
		const px = bx < cols - 8 ? bx + 4 : (cols - 8) * 2 - bx + 3;
		const py = by < rows - 6 ? by + 3 : (rows - 6) * 2 - by + 2;
		blitBall(buf, cols, rows, px, py, 2);
		for (let y = 0; y < rows; y += 2) setPx(buf, cols, rows, (cols / 2) | 0, y, 1);
		if (((tt * 2) | 0) % 2 === 0) {
			blitCentered(buf, cols, rows, pickStrobe(team, tt, 1.2), 2);
		}
	} else if (anim === "fireworks") {
		const bursts = 4;
		for (let b = 0; b < bursts; b++) {
			const life = (tt * 1.35 + b * 0.61) % 1.35;
			const seed = b * 17.13 + Math.floor((tt * 1.35 + b * 0.61) / 1.35);
			const cx = 6 + ((Math.sin(seed * 12.9) * 0.5 + 0.5) * (cols - 12));
			const cy = 4 + ((Math.cos(seed * 7.1) * 0.5 + 0.5) * (rows - 10));
			const n = 14;
			for (let i = 0; i < n; i++) {
				const a = (i / n) * Math.PI * 2 + seed;
				const dist = life * (7 + (i % 3) * 2);
				const fade = life < 0.15 ? life / 0.15 : 1 - (life - 0.15) / 1.2;
				if (fade <= 0) continue;
				const x = cx + Math.cos(a) * dist;
				const y = cy + Math.sin(a) * dist + life * life * 4;
				setPx(buf, cols, rows, x, y, fade > 0.45 ? 2 : 1);
			}
			if (life < 0.12) setPx(buf, cols, rows, cx, cy, 2);
		}
		if (((tt * 3) | 0) % 3 !== 1) {
			blitCentered(buf, cols, rows, pickStrobe(team, tt, 1.5), 2);
		}
	} else if (anim === "snake") {
		const len = 18;
		for (let i = 0; i < len; i++) {
			const u = tt * 2.8 - i * 0.18;
			const x = (Math.sin(u) * 0.5 + 0.5) * (cols - 4) + 2;
			const y = (Math.sin(u * 0.7 + 1.2) * 0.5 + 0.5) * (rows - 4) + 2;
			setPx(buf, cols, rows, x, y, i < 2 ? 2 : 1);
			setPx(buf, cols, rows, x + 1, y, i < 3 ? 2 : 1);
		}
		/** „Jedzenie”. */
		const fx = ((Math.sin(tt * 0.9) * 0.5 + 0.5) * (cols - 6) + 3) | 0;
		const fy = ((Math.cos(tt * 1.1) * 0.5 + 0.5) * (rows - 6) + 3) | 0;
		setPx(buf, cols, rows, fx, fy, 2);
		setPx(buf, cols, rows, fx + 1, fy, 2);
		blitCentered(buf, cols, rows, pickStrobe(team, tt, 1.3), 2);
	} else if (anim === "tunnel") {
		const cx = (cols - 1) * 0.5;
		const cy = (rows - 1) * 0.5;
		const zoom = (tt * 14) % 10;
		for (let y = 0; y < rows; y++) {
			for (let x = 0; x < cols; x++) {
				const dx = Math.abs(x - cx);
				const dy = Math.abs(y - cy);
				const m = Math.max(dx * 0.72, dy);
				const band = (m + zoom) % 5;
				if (band < 1.1) setPx(buf, cols, rows, x, y, 2);
				else if (band < 1.8) setPx(buf, cols, rows, x, y, 1);
			}
		}
		blitCentered(buf, cols, rows, pickStrobe(team, tt, 1.6), 2);
	} else if (anim === "glitch") {
		const line = pickStrobe(team, tt, 1.8);
		const gh = fitLedGlyphH(line, cols, rows);
		const tw = measureLedText(line, rows, gh);
		const baseOx = Math.floor((cols - tw) * 0.5);
		const oy = ledTextOy(rows, gh);
		/** RGB-split / slice offset na LED. */
		const slice = ((tt * 9) | 0) % 5;
		blitText(buf, cols, rows, line, baseOx + (slice - 2), oy - 1, 1, gh);
		blitText(buf, cols, rows, line, baseOx - (slice - 2), oy + 1, 1, gh);
		blitText(buf, cols, rows, line, baseOx, oy, 2, gh);
		for (let i = 0; i < 6; i++) {
			const y = ((tt * 40 + i * 17) | 0) % rows;
			const shift = ((Math.sin(tt * 30 + i) * 4) | 0);
			for (let x = 0; x < cols; x++) {
				if (((x + shift) & 3) === 0) setPx(buf, cols, rows, x, y, 1);
			}
		}
		if (((tt * 12) | 0) & 1) {
			fillRect(buf, cols, rows, 0, ((tt * 17) | 0) % rows, cols, 1, 2);
		}
	} else if (anim === "confetti") {
		for (let i = 0; i < 48; i++) {
			const sx = (i * 7.13) % cols;
			const speed = 6 + (i % 5) * 2.2;
			const y = ((tt * speed + i * 3.7) % (rows + 6)) - 2;
			const w = 1 + (i % 3);
			const h = 1 + ((i * 3) % 2);
			fillRect(buf, cols, rows, sx, y, w, h, i % 2 === 0 ? 2 : 1);
		}
		blitCentered(buf, cols, rows, pickStrobe(team, tt, 1.7), 2);
	} else if (anim === "typewriter") {
		const line = pickStrobe(team, Math.floor(animT / 2.2), 1);
		const chars = Math.min(
			line.length,
			1 + (((animT % 2.2) / 2.2) * (line.length + 1)) | 0,
		);
		const shown = line.slice(0, chars);
		const cursorOn = ((tt * 6) | 0) & 1;
		const label = cursorOn && chars < line.length ? `${shown}_` : shown || "_";
		blitCentered(buf, cols, rows, label, 2);
		for (let x = 0; x < cols; x++) {
			if (((x + ((tt * 5) | 0)) & 3) === 0) {
				setPx(buf, cols, rows, x, rows - 2, 1);
			}
		}
	} else if (anim === "slotSpin") {
		/** Trzy bębny → zatrzymanie na haśle. */
		const words = STROBE_LINES[team];
		const cycle = 3.2;
		const local = animT % cycle;
		const spinning = local < 1.6;
		const target = words[Math.floor(animT / cycle) % words.length]!;
		if (spinning) {
			for (let col = 0; col < 3; col++) {
				const reel = words[(Math.floor(tt * (14 + col * 3)) + col) % words.length]!;
				const ch = reel[Math.min(col, reel.length - 1)] ?? "!";
				const gh = Math.min(12, rows - 4);
				const ox = Math.floor(cols * (0.22 + col * 0.28));
				blitText(buf, cols, rows, ch, ox, ledTextOy(rows, gh), 2, gh);
			}
			for (let x = 0; x < cols; x++) {
				setPx(buf, cols, rows, x, 2, 1);
				setPx(buf, cols, rows, x, rows - 3, 1);
			}
		} else {
			const flash = ((tt * 10) | 0) & 1;
			if (flash) buf.fill(2);
			blitCentered(buf, cols, rows, target, flash ? 0 : 2);
		}
	} else {
		const dir = team === "blue" ? 1 : -1;
		const shift = Math.floor(tt * 10) * dir;
		for (let y = 0; y < rows; y++) {
			for (let x = 0; x < cols; x++) {
				const local = (x + shift + cols * 8) % 8;
				const arm = Math.abs(y - (rows - 1) * 0.5);
				if (local === (arm | 0) % 8 || local === ((arm | 0) + 1) % 8) {
					setPx(buf, cols, rows, x, y, 2);
				}
			}
		}
	}

	paintBuffer(screen, buf);
}

function makeScreen(
	cols: number,
	rows: number,
	team: TeamId,
	side: -1 | 1,
	phase: number,
): DotMatrixScreen | null {
	if (typeof document === "undefined") return null;
	warmLedFont();
	const cell = 6;
	const canvas = document.createElement("canvas");
	canvas.width = cols * cell;
	canvas.height = rows * cell;
	const ctx = canvas.getContext("2d", { alpha: false });
	if (!ctx) return null;

	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.magFilter = THREE.NearestFilter;
	tex.minFilter = THREE.NearestFilter;
	tex.generateMipmaps = false;

	const mat = new THREE.MeshBasicMaterial({
		map: tex,
		toneMapped: false,
		side: THREE.FrontSide,
		depthTest: true,
		depthWrite: true,
	});

	return { team, cols, rows, canvas, ctx, tex, mat, phase, side, mesh: null };
}

function mountScreenMesh(
	parent: THREE.Object3D,
	screen: DotMatrixScreen,
	width: number,
	height: number,
	x: number,
	y: number,
	screenZ: number,
	zSign: 1 | -1,
): void {
	const mesh = new THREE.Mesh(
		new THREE.PlaneGeometry(width, height),
		screen.mat,
	);
	mesh.name = `jumbotron_${screen.team}_${screen.side > 0 ? "r" : "l"}`;
	mesh.position.set(x, y, screenZ);
	if (zSign > 0) mesh.rotation.y = Math.PI;
	mesh.castShadow = false;
	mesh.receiveShadow = false;
	mesh.renderOrder = 12;
	mesh.raycast = () => {};
	parent.add(mesh);
	screen.mesh = mesh;
}

function mountBezel(
	parent: THREE.Object3D,
	team: TeamId,
	width: number,
	height: number,
	x: number,
	y: number,
	screenZ: number,
	zSign: 1 | -1,
): void {
	const body = new THREE.MeshStandardMaterial({
		color: 0x0a0c12,
		metalness: 0.7,
		roughness: 0.4,
	});
	const neon = new THREE.MeshStandardMaterial({
		color: 0x020305,
		emissive: team === "blue" ? RL.goalBlue : RL.goalOrange,
		emissiveIntensity: 2.55,
		toneMapped: false,
		metalness: 0.2,
		roughness: 0.35,
	});
	const outerW = width + BEZEL * 2;
	const outerH = height + BEZEL * 2;
	/** Obudowa wyłącznie w głąb ściany. */
	const chassisZ = screenZ + zSign * 0.07;
	const plate = new THREE.Mesh(
		new THREE.BoxGeometry(outerW, outerH, 0.07),
		body,
	);
	plate.position.set(x, y, chassisZ);
	plate.name = "jumbotronChassis";
	plate.renderOrder = 11;
	plate.raycast = () => {};
	parent.add(plate);

	const barT = 0.045;
	/** Neon flush z ekranem — nie przed hex przez z-fight. */
	const edgeZ = screenZ;
	const mkBar = (w: number, h: number, px: number, py: number) => {
		const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.025), neon);
		m.position.set(px, py, edgeZ);
		m.renderOrder = 12;
		m.raycast = () => {};
		parent.add(m);
	};
	mkBar(outerW, barT, x, y + outerH * 0.5 - barT * 0.5);
	mkBar(outerW, barT, x, y - outerH * 0.5 + barT * 0.5);
	mkBar(barT, outerH, x - outerW * 0.5 + barT * 0.5, y);
	mkBar(barT, outerH, x + outerW * 0.5 - barT * 0.5, y);
}

/** Prematch — blokuj rotację idle na skrzydłach LED. */
let prematchMatrixLock = false;

function advanceIdle(rig: DisplayRig, dt: number): void {
	if (rig.goalFlash > 0) {
		rig.goalFlash = Math.max(0, rig.goalFlash - dt);
		rig.anim = "goalBurst";
		if (rig.goalFlash <= 0) {
			rig.anim = IDLE_CYCLE[0]!.anim;
			rig.animT = 0;
		}
		return;
	}
	rig.animT += dt;
	/** Prematch show — trzymaj cue (strobe/vortex/rain), nie rotuj idle. */
	if (prematchMatrixLock) return;
	const cur = IDLE_CYCLE.find((c) => c.anim === rig.anim) ?? IDLE_CYCLE[0]!;
	if (rig.animT < cur.dur) return;
	const idx = IDLE_CYCLE.findIndex((c) => c.anim === rig.anim);
	const next = IDLE_CYCLE[(idx + 1) % IDLE_CYCLE.length]!;
	rig.anim = next.anim;
	rig.animT = 0;
}

export function buildGoalBackboardPanels(
	parent: THREE.Object3D,
	team: TeamId,
	lineZ: number,
	zSign: 1 | -1,
): void {
	const { GOAL_WIDTH, GOAL_HEIGHT, HEIGHT, HALF_WIDTH, CORNER_CUT } = RL_ARENA;
	const gw = GOAL_WIDTH / 2;
	const wingX = HALF_WIDTH - CORNER_CUT;
	const roofTop = GOAL_HEIGHT + SOCCAR_GOAL.tubeR + 0.06;
	const wallFaceZ = lineZ + zSign * RAMP_RUN;
	/**
	 * Face flush z fizyką backboardu (goalPocket screenFaceZ).
	 * Lekki inset w pole — LED przed hex glass, bez „dziury” przy wall-ride.
	 */
	const screenZ = wallFaceZ - zSign * 0.02;

	const boardBottom = roofTop + 0.02;
	const boardTop = Math.min(HEIGHT - 2.2, GOAL_HEIGHT + 11.5);
	const boardH = Math.max(2.4, boardTop - boardBottom);

	const group = new THREE.Group();
	group.name = `goalStadiumBack_${team}`;
	parent.add(group);

	const screens: DotMatrixScreen[] = [];
	/** Skrzydła od krawędzi bramki → narożnik (bez środkowego ekranu). */
	const wingInner = gw + 0.9;
	const wingOuter = wingX + 0.35;
	const wingSpan = wingOuter - wingInner;

	if (wingSpan > 1.5) {
		const wingH = boardH * 0.95;
		const wingY = boardBottom + wingH * 0.5;
		for (const xSign of [-1, 1] as const) {
			const wing = makeScreen(
				56,
				30,
				team,
				xSign,
				(team === "blue" ? 0.25 : 1.8) + xSign * 0.35,
			);
			if (!wing) continue;
			const wx = xSign * (wingInner + wingSpan * 0.5);
			mountBezel(group, team, wingSpan, wingH, wx, wingY, screenZ, zSign);
			mountScreenMesh(
				group,
				wing,
				wingSpan - 0.05,
				wingH - 0.05,
				wx,
				wingY,
				screenZ,
				zSign,
			);
			screens.push(wing);
		}
	}

	if (screens.length > 0) {
		void ensureDotMatrixCapture();
		rigs.push({
			root: group,
			screens,
			team,
			anim: "carSpin",
			animT: team === "blue" ? 0 : 1.5,
			goalFlash: 0,
		});
		for (const s of screens) fillAnim(s, "carSpin", globalTime, 0, 0);
	}
}

export function updateGoalDotMatrix(dt: number, timeSec: number): void {
	if (rigs.length === 0) return;
	globalTime = timeSec;
	lastFrameDt = dt;
	for (const rig of rigs) advanceIdle(rig, dt);
	/** LIVE RT na mapie — nie maluj LED (oprócz goal burst pod spodem i tak niewidoczny). */
	if (liveMap) {
		refreshAcc = 0;
		return;
	}
	refreshAcc += dt;
	const hz = jumbotronHold ? REFRESH_HZ * 0.35 : REFRESH_HZ;
	if (refreshAcc < 1 / hz) return;
	/** dt skumulowany od ostatniego paint — płynniejszy spin auta. */
	const stepDt = refreshAcc;
	refreshAcc = 0;
	lastFrameDt = stepDt;
	sharedCarStamp = -1;
	for (const rig of rigs) {
		for (const screen of rig.screens) {
			fillAnim(screen, rig.anim, globalTime, rig.goalFlash, rig.animT);
		}
	}
}

/** true gdy CSS3D film / LIVE RT — LED canvas może iść rzadziej (goal burst zostaje). */
let jumbotronHold = false;
/** LIVE broadcast — map = RT zamiast canvas LED. */
let liveMap: THREE.Texture | null = null;

export function setJumbotronHold(hold: boolean): void {
	jumbotronHold = hold;
}

/** Podmień mapę skrzydeł na feed LIVE (RT) albo przywróć canvas LED. */
export function setJumbotronLiveMap(map: THREE.Texture | null): void {
	liveMap = map;
	for (const rig of rigs) {
		for (const s of rig.screens) {
			s.mat.map = map ?? s.tex;
			s.mat.needsUpdate = true;
			if (s.tex) s.tex.needsUpdate = map == null;
		}
	}
}

export function isJumbotronLiveMapActive(): boolean {
	return liveMap != null;
}

export function getJumbotronScreenMeshes(): THREE.Mesh[] {
	const out: THREE.Mesh[] = [];
	for (const rig of rigs) {
		for (const s of rig.screens) {
			if (s.mesh) out.push(s.mesh);
		}
	}
	return out;
}

export function flashGoalDotMatrix(
	concedingTeam: TeamId,
	durationSec = 2.6,
): void {
	for (const rig of rigs) {
		if (rig.team !== concedingTeam) continue;
		rig.goalFlash = durationSec;
		rig.anim = "goalBurst";
	}
}

/** Pre-match show — wymuś hype/strobe na skrzydłach. */
export function setGoalDotMatrixHype(active: boolean): void {
	prematchMatrixLock = active;
	for (const rig of rigs) {
		if (active) {
			rig.goalFlash = 0;
			rig.anim = "strobe";
			rig.animT = 0;
		} else if (
			rig.anim === "strobe" ||
			rig.anim === "fanChant" ||
			rig.anim === "rain" ||
			rig.anim === "vortex" ||
			rig.anim === "equalizer" ||
			rig.anim === "helix" ||
			rig.anim === "starBurst"
		) {
			rig.anim = IDLE_CYCLE[0]!.anim;
			rig.animT = 0;
		}
	}
}

/** Prematch beat — zmień pattern LED pod climax laserów. */
export function setGoalDotMatrixPrematchCue(
	cue: "slam" | "liquid" | "climax" | "rain" | "build",
): void {
	const anim =
		cue === "slam" || cue === "build"
			? "equalizer"
			: cue === "liquid"
				? "helix"
				: cue === "climax"
					? "starBurst"
					: "rain";
	for (const rig of rigs) {
		rig.goalFlash = cue === "climax" ? 0.85 : 0;
		rig.anim = anim;
		rig.animT = 0;
	}
}

export function disposeGoalDotMatrix(): void {
	liveMap = null;
	jumbotronHold = false;
	for (const rig of rigs) {
		for (const s of rig.screens) {
			s.tex.dispose();
			s.mat.dispose();
		}
	}
	rigs = [];
	refreshAcc = 0;
	sharedCarFrame = null;
	sharedCarStamp = -1;
	disposeDotMatrixCapture();
}
