import * as THREE from "three";

import { getDefaultCarId } from "../meta/CarCatalog";
import { assetUrl } from "../util/assetUrl";
import { loadCarModel } from "../visual/CarModel";
import { MENU_BRAND_LOGO } from "./menuAssets";

const STORAGE_KEY = "ignite.seenBootCinematic.v1";
const LOGO_URL = assetUrl(MENU_BRAND_LOGO);
const LOGO_STING_URL = assetUrl("/assets/video/ignite_logo_sting.mp4");
const BALL_ALBEDO = assetUrl("/assets/textures/ball_cyber_albedo.jpg");
const BALL_ALBEDO_FALLBACK = assetUrl("/assets/textures/ball_cyber_albedo.png");
const BALL_RADIUS = 0.92;
/** Max czas na assety 3D — potem prosty fallback (auto+piłka zawsze widoczne). */
const ASSET_TIMEOUT_MS = 8000;

const DUR_BASE = {
	/** Czysta czerń przed wykopem — bez auta w kadrze. */
	idle: 0.7,
	approach: 0.55,
	flight: 1.15,
	impact: 0.22,
	morph: 1.05,
	holdMin: 0.55,
	fade: 0.85,
} as const;

/** Skala piłki: mała w oddali → ~naturalna przy ekranie (perspektywa + lekki grow). */
const BALL_SCALE_FAR = 0.38;
const BALL_SCALE_NEAR = 1.05;
const BALL_SCALE_IMPACT = 1.18;

/** `?introSlow=3` — spowolnienie do nagrań / DC clipów. */
function cinematicScale(): number {
	try {
		const raw = new URLSearchParams(location.search).get("introSlow");
		const n = raw ? Number(raw) : 1;
		return Number.isFinite(n) && n >= 1 && n <= 8 ? n : 1;
	} catch {
		return 1;
	}
}

const _scale = cinematicScale();
const DUR = {
	idle: DUR_BASE.idle * _scale,
	approach: DUR_BASE.approach * _scale,
	flight: DUR_BASE.flight * _scale,
	impact: DUR_BASE.impact * _scale,
	morph: DUR_BASE.morph * _scale,
	holdMin: DUR_BASE.holdMin * _scale,
	fade: DUR_BASE.fade * _scale,
} as const;

export function hasSeenBootCinematic(): boolean {
	try {
		return localStorage.getItem(STORAGE_KEY) === "1";
	} catch {
		return false;
	}
}

export function markBootCinematicSeen(): void {
	try {
		localStorage.setItem(STORAGE_KEY, "1");
	} catch {
		/* private mode */
	}
}

/**
 * Cold boot: 3D wykop piłki (domyślnie).
 * `?videoIntro=1` / `?cinematicIntro=1` — SM FramePack mp4.
 * `?skipIntro=1` / autostart / e2e / garageAudit — pomija całe intro.
 */
export function shouldPlayBootCinematic(
	params = new URLSearchParams(location.search),
): boolean {
	if (params.get("skipIntro") === "1") return false;
	if (params.get("autostart")) return false;
	if (params.get("onlineE2e")) return false;
	if (params.get("garageAudit") === "1") return false;
	if (params.get("videoIntro") === "1" || params.get("cinematicIntro") === "1") {
		return false;
	}
	/** Jawne wyłączenie 3D (np. ?oldIntro=0). */
	if (params.get("oldIntro") === "0") return false;
	return true;
}

function easeInCubic(t: number): number {
	return t * t * t;
}

function easeOutCubic(t: number): number {
	return 1 - (1 - t) ** 3;
}

function easeInOutCubic(t: number): number {
	return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function easeOutQuad(t: number): number {
	return 1 - (1 - t) * (1 - t);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
	const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
	return t * t * (3 - 2 * t);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const id = window.setTimeout(() => reject(new Error("timeout")), ms);
		p.then(
			(v) => {
				clearTimeout(id);
				resolve(v);
			},
			(e) => {
				clearTimeout(id);
				reject(e);
			},
		);
	});
}

/**
 * Smuga + afterimage za piłką intro (czarne tło).
 * Additive cyan→amber — czytelna kinetyczna „prędkość” bez post-process.
 */
class BootBallStreak {
	private readonly root = new THREE.Group();
	private readonly ghosts: THREE.Mesh[] = [];
	private readonly streak: THREE.Mesh;
	private readonly streakMat: THREE.MeshBasicMaterial;
	private readonly history: THREE.Vector3[] = [];
	private readonly prev = new THREE.Vector3();
	private readonly vel = new THREE.Vector3();
	private readonly axis = new THREE.Vector3(0, 1, 0);
	private readonly lookQuat = new THREE.Quaternion();
	private readonly ghostGeo: THREE.SphereGeometry;
	private seeded = false;
	private strength = 0;

	constructor(scene: THREE.Scene) {
		this.root.name = "bootBallStreak";
		scene.add(this.root);

		this.ghostGeo = new THREE.SphereGeometry(BALL_RADIUS, 20, 14);
		for (let i = 0; i < 10; i++) {
			const mat = new THREE.MeshBasicMaterial({
				color: new THREE.Color().setHSL(0.08 + i * 0.012, 0.85, 0.55),
				transparent: true,
				opacity: 0,
				depthWrite: false,
				blending: THREE.AdditiveBlending,
			});
			const ghost = new THREE.Mesh(this.ghostGeo, mat);
			ghost.visible = false;
			ghost.frustumCulled = false;
			this.root.add(ghost);
			this.ghosts.push(ghost);
		}

		this.streakMat = new THREE.MeshBasicMaterial({
			color: 0xffb060,
			transparent: true,
			opacity: 0,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			side: THREE.DoubleSide,
		});
		this.streak = new THREE.Mesh(
			new THREE.CylinderGeometry(0.12, 0.55, 1, 12, 1, true),
			this.streakMat,
		);
		this.streak.rotation.x = Math.PI / 2;
		this.streak.visible = false;
		this.streak.frustumCulled = false;
		this.root.add(this.streak);
	}

	/** strength 0–1: jasność / długość. */
	update(pos: THREE.Vector3, ballScale: number, strength: number, dt: number): void {
		const target = THREE.MathUtils.clamp(strength, 0, 1);
		this.strength = THREE.MathUtils.lerp(
			this.strength,
			target,
			1 - Math.exp(-(target > this.strength ? 14 : 7) * dt),
		);

		if (!this.seeded) {
			this.prev.copy(pos);
			this.seeded = true;
		}
		this.vel.subVectors(pos, this.prev);
		const step = this.vel.length();
		this.prev.copy(pos);

		if (this.strength < 0.02 && target < 0.02) {
			this.hideAll();
			return;
		}

		if (step > 0.008) {
			this.history.unshift(pos.clone());
			if (this.history.length > 14) this.history.length = 14;
		} else if (this.history.length > 0 && this.strength < 0.15) {
			this.history.pop();
		}

		const k = this.strength;
		for (let i = 0; i < this.ghosts.length; i++) {
			const ghost = this.ghosts[i]!;
			const sample = this.history[i + 1];
			if (!sample || k < 0.04) {
				ghost.visible = false;
				continue;
			}
			const fade = 1 - (i + 1) / (this.ghosts.length + 1);
			const mat = ghost.material as THREE.MeshBasicMaterial;
			ghost.visible = true;
			ghost.position.copy(sample);
			const s = ballScale * (0.92 - i * 0.055) * (0.55 + 0.45 * fade);
			ghost.scale.setScalar(Math.max(0.12, s));
			mat.opacity = k * fade * fade * 0.42;
			mat.color.setHSL(0.07 + fade * 0.08, 0.9, 0.48 + fade * 0.18);
		}

		if (step > 0.012 && k > 0.08) {
			this.vel.normalize();
			const len = THREE.MathUtils.lerp(0.35, 2.6, k) * (0.7 + ballScale * 0.45);
			this.streak.visible = true;
			this.streak.position.copy(pos).addScaledVector(this.vel, -len * 0.48);
			this.lookQuat.setFromUnitVectors(this.axis, this.vel);
			this.streak.quaternion.copy(this.lookQuat);
			this.streak.scale.set(
				0.55 + k * 0.7,
				len,
				0.55 + k * 0.7,
			);
			this.streakMat.opacity = 0.18 + k * 0.55;
			this.streakMat.color.setHSL(0.08 + k * 0.04, 0.95, 0.62);
		} else {
			this.streakMat.opacity = THREE.MathUtils.lerp(
				this.streakMat.opacity,
				0,
				1 - Math.exp(-10 * dt),
			);
			if (this.streakMat.opacity < 0.02) this.streak.visible = false;
		}
	}

	clear(): void {
		this.history.length = 0;
		this.seeded = false;
		this.strength = 0;
		this.hideAll();
	}

	dispose(): void {
		this.root.removeFromParent();
		this.ghostGeo.dispose();
		this.streak.geometry.dispose();
		this.streakMat.dispose();
		for (const g of this.ghosts) {
			(g.material as THREE.MeshBasicMaterial).dispose();
		}
	}

	private hideAll(): void {
		this.streak.visible = false;
		this.streakMat.opacity = 0;
		for (const g of this.ghosts) g.visible = false;
	}
}

export type BootCinematicHandle = {
	/** Kick → morph zakończony, logo na czerni (WebGL już zwolniony). */
	whenLogoReady: Promise<void>;
	/** Fade logo → cleanup. Wołać po załadowaniu gry. */
	finish(): Promise<void>;
	skip(): void;
};

/**
 * Intro PRZED ładowaniem gry (osobny WebGL tylko na wykop):
 * auto wkopuje piłkę → logo; potem `finish()` po loadzie.
 */
export function beginIgniteBootCinematic(
	host: HTMLElement = document.body,
): BootCinematicHandle {
	const root = document.createElement("div");
	root.id = "ignite-boot-cinematic";
	root.setAttribute("role", "presentation");
	root.style.cssText =
		"position:fixed;inset:0;z-index:10040;background:#000;cursor:default;overflow:hidden;";

	const canvas = document.createElement("canvas");
	canvas.style.cssText = "display:block;width:100%;height:100%;opacity:0;";
	root.appendChild(canvas);

	const flash = document.createElement("div");
	flash.style.cssText = [
		"position:absolute",
		"inset:0",
		"z-index:2",
		"pointer-events:none",
		"opacity:0",
		"background:radial-gradient(circle at 50% 48%, #fff 0%, #ffe8c8 28%, #ff9a3a 55%, transparent 78%), #fff",
		"mix-blend-mode:screen",
	].join(";");
	root.appendChild(flash);

	const logoEl = document.createElement("img");
	logoEl.src = LOGO_URL;
	logoEl.alt = "Ignite";
	logoEl.draggable = false;
	logoEl.style.cssText = [
		"position:absolute",
		"left:50%",
		"top:48%",
		"width:min(820px,78vw)",
		"height:auto",
		"transform:translate(-50%,-50%) scale(0.92)",
		"opacity:0",
		"pointer-events:none",
		"z-index:3",
		"filter:drop-shadow(0 0 28px rgba(255,140,40,0.35))",
		"transition:none",
		"will-change:opacity,transform,filter",
	].join(";");
	root.appendChild(logoEl);

	const stingEl = document.createElement("video");
	stingEl.src = LOGO_STING_URL;
	stingEl.muted = true;
	stingEl.defaultMuted = true;
	stingEl.playsInline = true;
	stingEl.preload = "auto";
	stingEl.setAttribute("muted", "");
	stingEl.setAttribute("playsinline", "");
	stingEl.setAttribute("webkit-playsinline", "");
	stingEl.setAttribute("aria-hidden", "true");
	stingEl.style.cssText = [
		"position:absolute",
		"inset:0",
		"width:100%",
		"height:100%",
		"object-fit:cover",
		"opacity:0",
		"pointer-events:none",
		"z-index:3",
		"background:#000",
		"transition:none",
		"will-change:opacity",
	].join(";");
	root.appendChild(stingEl);

	const skipHint = document.createElement("div");
	skipHint.textContent = "Spacja — pomiń wykop";
	skipHint.style.cssText =
		"position:absolute;right:1.25rem;bottom:1.1rem;z-index:4;font:600 0.72rem/1 system-ui,sans-serif;letter-spacing:0.08em;text-transform:uppercase;color:rgba(255,255,255,0.35);pointer-events:none;opacity:0;";
	root.appendChild(skipHint);

	host.appendChild(root);

	let disposed = false;
	let skipped = false;
	let logoReady = false;
	/** true = full-bleed mp4 sting; false = PNG + dotychczasowy fade */
	let useStingVideo = false;
	let resolveStingReady!: () => void;
	const whenStingReady = new Promise<void>((r) => {
		resolveStingReady = r;
	});
	let resolveLogoReady!: () => void;
	const whenLogoReady = new Promise<void>((r) => {
		resolveLogoReady = r;
	});
	let raf = 0;
	let renderer: THREE.WebGLRenderer | null = null;

	const setLogo = (opacity: number, scale: number): void => {
		if (useStingVideo) {
			stingEl.style.opacity = String(opacity);
			return;
		}
		logoEl.style.opacity = String(opacity);
		logoEl.style.transform = `translate(-50%, -50%) scale(${scale})`;
	};

	const startLogoSting = async (): Promise<void> => {
		if (disposed) {
			resolveStingReady();
			return;
		}
		try {
			await new Promise<void>((resolve, reject) => {
				if (stingEl.error) {
					reject(stingEl.error);
					return;
				}
				if (stingEl.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
					resolve();
					return;
				}
				const onReady = (): void => {
					cleanup();
					resolve();
				};
				const onErr = (): void => {
					cleanup();
					reject(new Error("sting media error"));
				};
				const cleanup = (): void => {
					stingEl.removeEventListener("canplaythrough", onReady);
					stingEl.removeEventListener("loadeddata", onReady);
					stingEl.removeEventListener("error", onErr);
					window.clearTimeout(timer);
				};
				stingEl.addEventListener("canplaythrough", onReady, {
					once: true,
				});
				stingEl.addEventListener("loadeddata", onReady, { once: true });
				stingEl.addEventListener("error", onErr, { once: true });
				const timer = window.setTimeout(onErr, 2800);
			});
			if (disposed) return;
			stingEl.currentTime = 0;
			await stingEl.play();
			if (disposed) return;
			useStingVideo = true;
			logoEl.style.opacity = "0";
			stingEl.style.opacity = "1";
		} catch {
			useStingVideo = false;
			stingEl.pause();
			stingEl.style.opacity = "0";
			setLogo(1, 1.04);
		} finally {
			resolveStingReady();
		}
	};

	const markLogoReady = (): void => {
		if (logoReady) return;
		logoReady = true;
		canvas.style.opacity = "0";
		flash.style.opacity = "0";
		skipHint.style.opacity = "0";
		/** Pod paskiem ładowania (#loading ~10055). */
		root.style.zIndex = "10030";
		root.style.cursor = "default";
		/** PNG zostaje widoczne do czasu play(); przy fail zostaje jako fallback. */
		if (logoEl.style.opacity === "0" || Number(logoEl.style.opacity) < 0.5) {
			logoEl.style.opacity = "1";
			logoEl.style.transform = "translate(-50%, -50%) scale(1.04)";
		}
		void startLogoSting();
		resolveLogoReady();
	};

	const cleanupGl = (): void => {
		if (renderer) {
			renderer.dispose();
			renderer = null;
		}
		canvas.remove();
	};

	const cleanupAll = (): void => {
		if (disposed) return;
		disposed = true;
		window.removeEventListener("resize", resize);
		window.removeEventListener("keydown", onKey);
		cancelAnimationFrame(raf);
		cleanupGl();
		root.remove();
		document.documentElement.classList.remove(
			"ignite-boot-cinematic",
			"ignite-boot-cinematic-ready",
		);
		markLogoReady();
	};

	/**
	 * Skip tylko wykop 3D → logo. Po logoReady klik/spacja NIE kasują logo
	 * (logo trzyma się do finish() po loadzie).
	 */
	const skipToLogo = (): void => {
		if (disposed || logoReady) return;
		skipped = true;
		markBootCinematicSeen();
		cancelAnimationFrame(raf);
		cleanupGl();
		markLogoReady();
	};

	const onKey = (e: KeyboardEvent): void => {
		if (logoReady || disposed) return;
		if (e.code === "Space" || e.code === "Escape" || e.code === "Enter") {
			e.preventDefault();
			skipToLogo();
		}
	};

	const resize = (): void => {
		if (!renderer) return;
		const w = Math.max(1, window.innerWidth);
		const h = Math.max(1, window.innerHeight);
		renderer.setSize(w, h, false);
	};

	window.addEventListener("keydown", onKey);
	window.addEventListener("resize", resize);

	/** Public abort (boot fail / finally) — zdejmij overlay. Nie wołać z kliknięcia. */
	const skip = (): void => {
		skipped = true;
		markBootCinematicSeen();
		cleanupAll();
	};

	void (async () => {
		try {
			renderer = new THREE.WebGLRenderer({
				canvas,
				antialias: true,
				alpha: false,
				powerPreference: "high-performance",
			});
			renderer.setClearColor(0x000000, 1);
			renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
			renderer.outputColorSpace = THREE.SRGBColorSpace;
			renderer.toneMapping = THREE.ACESFilmicToneMapping;
			renderer.toneMappingExposure = 1.2;
			resize();

			const scene = new THREE.Scene();
			scene.background = new THREE.Color(0x000000);
			const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 80);
			camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
			camera.updateProjectionMatrix();

			const key = new THREE.DirectionalLight(0xfff0e0, 3.2);
			key.position.set(2.5, 6, 5);
			scene.add(key);
			const fill = new THREE.DirectionalLight(0x6a9fff, 1.1);
			fill.position.set(-4, 3, 2);
			scene.add(fill);
			scene.add(new THREE.AmbientLight(0x405060, 0.55));
			const rim = new THREE.PointLight(0xff8a3a, 2.4, 22, 2);
			rim.position.set(0, 2.4, 4);
			scene.add(rim);
			const carSpot = new THREE.SpotLight(0xffffff, 4.5, 18, 0.55, 0.35, 1);
			carSpot.position.set(1.5, 5, 4);
			scene.add(carSpot);
			scene.add(carSpot.target);

			const carHome = new THREE.Vector3(-0.35, 0, -1.1);
			/** Piłka dalej od kamery = mała na starcie; leci w stronę obiektywu. */
			const ballHome = new THREE.Vector3(0.15, BALL_RADIUS * BALL_SCALE_FAR, 0.85);
			const ballImpact = new THREE.Vector3(0.04, BALL_RADIUS * 0.55, 1.55);
			/** Tuż przed kamerą (~z 7.2) — wypełnia kadr perspektywą, bez sztucznego ×3.6. */
			const ballCam = new THREE.Vector3(0, 1.2, 6.55);
			const camFlightStart = new THREE.Vector3(0.15, 1.55, 7.85);
			const camFlightEnd = new THREE.Vector3(0, 1.28, 7.15);

			const makeFallbackCar = (): THREE.Group => {
				const g = new THREE.Group();
				const body = new THREE.Mesh(
					new THREE.BoxGeometry(2.1, 0.55, 3.2),
					new THREE.MeshStandardMaterial({
						color: 0x2a6dff,
						metalness: 0.55,
						roughness: 0.35,
					}),
				);
				body.position.y = 0.45;
				g.add(body);
				const cabin = new THREE.Mesh(
					new THREE.BoxGeometry(1.5, 0.4, 1.4),
					new THREE.MeshStandardMaterial({
						color: 0x101820,
						metalness: 0.2,
						roughness: 0.5,
					}),
				);
				cabin.position.set(0, 0.85, -0.15);
				g.add(cabin);
				return g;
			};

			const texLoader = new THREE.TextureLoader();
			let carTpl: THREE.Group;
			let ballTex: THREE.Texture | null = null;
			try {
				const loaded = await withTimeout(
					Promise.all([
						loadCarModel(getDefaultCarId(), "blue"),
						texLoader
							.loadAsync(BALL_ALBEDO)
							.catch(() => texLoader.loadAsync(BALL_ALBEDO_FALLBACK)),
					]),
					ASSET_TIMEOUT_MS,
				);
				carTpl = loaded[0];
				ballTex = loaded[1];
			} catch (err) {
				console.warn(
					"[Ignite] boot cinematic assets slow/fail — fallback mesh",
					err,
				);
				carTpl = makeFallbackCar();
			}

			if (disposed || skipped) return;

			console.info("[Ignite] boot cinematic: kick sequence");
			const car = carTpl.clone(true);
			car.traverse((o) => {
				o.frustumCulled = false;
				if (o instanceof THREE.Mesh) {
					o.castShadow = false;
					o.receiveShadow = false;
				}
			});
			car.rotation.y = Math.PI * 0.12;
			car.scale.setScalar(1.35);
			car.position.copy(carHome);
			scene.add(car);
			carSpot.target.position.copy(carHome);

			if (ballTex) ballTex.colorSpace = THREE.SRGBColorSpace;
			const ball = new THREE.Mesh(
				new THREE.SphereGeometry(BALL_RADIUS, 48, 32),
				new THREE.MeshStandardMaterial({
					map: ballTex ?? undefined,
					color: ballTex ? 0xffffff : 0xd8e8ff,
					metalness: 0.18,
					roughness: 0.4,
					emissive: new THREE.Color(0x143040),
					emissiveIntensity: 0.7,
					transparent: true,
					opacity: 1,
				}),
			);
			ball.position.copy(ballHome);
			ball.visible = false;
			scene.add(ball);

			const ballStreak = new BootBallStreak(scene);
			const pushStreak = (strength: number, dt: number): void => {
				ballStreak.update(ball.position, ball.scale.x, strength, dt);
			};

			/** Canvas niewidoczny aż do fade-in po czerni. */
			canvas.style.opacity = "0";
			car.visible = false;

			let t = 0;
			let last = performance.now();
			let holdReachedAt = -1;
			let frameDt = 1 / 60;

			const updateScene = (time: number): "playing" | "logo" => {
				let u = time;
				if (u < DUR.idle) {
					/** Od czerni — nic nie widać (ani auto, ani piłka, ani hint). */
					car.visible = false;
					ball.visible = false;
					ballStreak.clear();
					setLogo(0, 0.92);
					flash.style.opacity = "0";
					canvas.style.opacity = "0";
					skipHint.style.opacity = "0";
					camera.position.set(3.6, 2.15, 5.8);
					camera.lookAt(-0.1, 0.55, 0.2);
					return "playing";
				}
				u -= DUR.idle;
				if (u < DUR.approach) {
					const p = easeInCubic(u / DUR.approach);
					/** Fade-in z czerni; auto dopiero tuż przed kopnięciem. */
					const reveal = smoothstep(0.08, 0.4, p);
					canvas.style.opacity = String(reveal);
					skipHint.style.opacity = String(0.35 * reveal);
					car.visible = reveal > 0.15 && p > 0.2;
					ball.visible = reveal > 0.05;
					car.position.lerpVectors(
						carHome,
						new THREE.Vector3(-0.05, 0, 0.55),
						p,
					);
					car.rotation.y = Math.PI * 0.12 * (1 - p * 0.85);
					ball.position.lerpVectors(
						ballHome,
						ballImpact,
						Math.min(1, p * 0.7),
					);
					ball.scale.setScalar(
						THREE.MathUtils.lerp(
							BALL_SCALE_FAR,
							BALL_SCALE_FAR * 1.15,
							p,
						),
					);
					(ball.material as THREE.MeshStandardMaterial).opacity = 1;
					ball.rotation.x = 0.15 - p * 1.6;
					/** Lekka smuga już przy podejściu — buduje „prędkość”. */
					pushStreak(0.25 + p * 0.45, frameDt);
					camera.position.lerpVectors(
						new THREE.Vector3(3.6, 2.15, 5.8),
						camFlightStart,
						easeInOutCubic(p),
					);
					camera.lookAt(0, 0.7, 1.2);
					if (p > 0.88) {
						camera.position.x += (Math.random() - 0.5) * 0.06;
						camera.position.y += (Math.random() - 0.5) * 0.04;
					}
					carSpot.target.position.copy(car.position);
					setLogo(0, 0.92);
					flash.style.opacity = "0";
					return "playing";
				}
				u -= DUR.approach;
				if (u < DUR.flight) {
					canvas.style.opacity = "1";
					/** easeOut: szybki start, potem piłka „doleciała” i rośnie przy ekranie. */
					const p = easeOutCubic(u / DUR.flight);
					car.visible = p < 0.28;
					ball.visible = true;
					(ball.material as THREE.MeshStandardMaterial).opacity = 1;
					ball.position.lerpVectors(ballImpact, ballCam, p);
					ball.rotation.x = -0.8 - p * 9;
					ball.rotation.y = p * 4.2;
					/**
					 * Mała → większa wraz ze zbliżaniem (perspektywa + grow).
					 * Bez skoku ×3.6 — to wyglądało jak balloon, nie lot.
					 */
					const grow = easeInCubic(p);
					ball.scale.setScalar(
						THREE.MathUtils.lerp(BALL_SCALE_FAR, BALL_SCALE_NEAR, grow),
					);
					/** Peak smugi w locie — afterimage + ribbon. */
					pushStreak(0.75 + (1 - p) * 0.25, frameDt);
					camera.position.lerpVectors(
						camFlightStart,
						camFlightEnd,
						easeInOutCubic(p),
					);
					camera.lookAt(ball.position);
					rim.intensity = 2.4 + p * 2.2;
					setLogo(0, 0.92);
					flash.style.opacity = "0";
					return "playing";
				}
				u -= DUR.flight;
				if (u < DUR.impact) {
					const p = u / DUR.impact;
					car.visible = false;
					ball.visible = true;
					ball.position.copy(ballCam);
					ball.scale.setScalar(
						THREE.MathUtils.lerp(BALL_SCALE_NEAR, BALL_SCALE_IMPACT, p),
					);
					pushStreak(0.35 * (1 - p), frameDt);
					/**
					 * Hit flash: pełny biały punch w kadrze, szybki decay.
					 * peak ≈ 0 → 1 w pierwszych ~20%, potem opada.
					 */
					const flashPeak =
						p < 0.18
							? easeOutCubic(p / 0.18)
							: 1 - easeInCubic((p - 0.18) / 0.82);
					flash.style.opacity = String(0.15 + 0.92 * flashPeak);
					camera.position.set(
						(Math.random() - 0.5) * 0.1,
						camFlightEnd.y + (Math.random() - 0.5) * 0.06,
						camFlightEnd.z,
					);
					camera.lookAt(ball.position);
					rim.intensity = 6.5 + flashPeak * 4;
					setLogo(0, 0.92);
					return "playing";
				}
				u -= DUR.impact;
				if (u < DUR.morph) {
					/** Lekki morph: piłka mięknie w logo, bez pancake-squash. */
					const p = easeInOutCubic(u / DUR.morph);
					car.visible = false;
					ball.position.copy(ballCam);
					const s = THREE.MathUtils.lerp(BALL_SCALE_IMPACT, 1.55, p);
					ball.scale.set(
						s * (1 + p * 0.35),
						s * (1 - p * 0.22),
						s * (1 + p * 0.12),
					);
					(ball.material as THREE.MeshStandardMaterial).opacity =
						1 - easeInCubic(p);
					ball.visible = p < 0.88;
					pushStreak(0.12 * (1 - p), frameDt);
					setLogo(
						smoothstep(0.12, 0.55, p),
						THREE.MathUtils.lerp(0.88, 1.04, easeOutCubic(p)),
					);
					camera.position.copy(camFlightEnd);
					camera.lookAt(ballCam);
					rim.intensity = 4.2 - p * 2.4;
					canvas.style.opacity = String(1 - easeOutQuad(p) * 0.92);
					flash.style.opacity = String(0.12 * (1 - p));
					return "playing";
				}

				car.visible = false;
				ball.visible = false;
				ballStreak.clear();
				canvas.style.opacity = "0";
				flash.style.opacity = "0";
				if (holdReachedAt < 0) holdReachedAt = time;
				const held = time - holdReachedAt;
				const breath = 1 + Math.sin(held * 2.4) * 0.012;
				setLogo(1, 1.04 * breath);
				return held >= DUR.holdMin ? "logo" : "playing";
			};

			await new Promise<void>((resolve) => {
				const tick = (now: number): void => {
					if (disposed || skipped) {
						resolve();
						return;
					}
					const dt = Math.min(0.05, (now - last) / 1000);
					last = now;
					frameDt = dt;
					t += dt;
					const phase = updateScene(t);
					renderer?.render(scene, camera);
					if (phase === "logo") {
						ballStreak.dispose();
						resolve();
						return;
					}
					raf = requestAnimationFrame(tick);
				};
				raf = requestAnimationFrame(tick);
			});

			if (disposed || skipped) {
				ballStreak.dispose();
				return;
			}

			/** Zwolnij WebGL zanim gra stworzy własny kontekst. */
			ballStreak.dispose();
			cleanupGl();
			markBootCinematicSeen();
			markLogoReady();
		} catch (err) {
			console.warn("[Ignite] boot cinematic failed — logo only", err);
			cleanupGl();
			markBootCinematicSeen();
			markLogoReady();
		}
	})();

	return {
		whenLogoReady,
		skip,
		finish(): Promise<void> {
			return whenLogoReady.then(async () => {
				if (disposed) return;
				await whenStingReady;
				if (disposed) return;

				if (useStingVideo) {
					/** Daj stingowi dobiec do końca (load gry często kończy się wcześniej). */
					await new Promise<void>((resolve) => {
						if (disposed || stingEl.ended || stingEl.error) {
							resolve();
							return;
						}
						const done = (): void => {
							cleanup();
							resolve();
						};
						const cleanup = (): void => {
							stingEl.removeEventListener("ended", done);
							stingEl.removeEventListener("error", done);
							window.clearTimeout(timer);
						};
						stingEl.addEventListener("ended", done, { once: true });
						stingEl.addEventListener("error", done, { once: true });
						const remainMs = Number.isFinite(stingEl.duration)
							? Math.max(
									0,
									(stingEl.duration - stingEl.currentTime) *
										1000 +
										120,
								)
							: 7800;
						const timer = window.setTimeout(done, remainMs);
					});
				} else {
					/** Breath, potem miękki dissolve logo → menu (bez twardego cut). */
					const t0 = performance.now();
					await new Promise<void>((resolve) => {
						const tick = (now: number): void => {
							if (disposed) {
								resolve();
								return;
							}
							const held = (now - t0) / 1000;
							const breath = 1 + Math.sin(held * 2.4) * 0.012;
							setLogo(1, 1.04 * breath);
							if (held >= 0.35) {
								resolve();
								return;
							}
							raf = requestAnimationFrame(tick);
						};
						raf = requestAnimationFrame(tick);
					});
				}

				if (disposed) return;
				const fadeStart = performance.now();
				await new Promise<void>((resolve) => {
					const tick = (now: number): void => {
						if (disposed) {
							resolve();
							return;
						}
						const fade = easeOutQuad(
							THREE.MathUtils.clamp(
								(now - fadeStart) / 1000 / DUR.fade,
								0,
								1,
							),
						);
						if (useStingVideo) {
							setLogo(1 - fade, 1);
						} else {
							/** Lekkie przebicie: logo delikatnie rośnie i znika w menu. */
							setLogo(1 - fade, 1.04 + fade * 0.14);
							logoEl.style.filter = `drop-shadow(0 0 ${28 + fade * 40}px rgba(255,140,40,${0.35 * (1 - fade)})) blur(${fade * 6}px)`;
						}
						root.style.opacity = String(1 - fade);
						if (fade >= 1) {
							cleanupAll();
							resolve();
							return;
						}
						raf = requestAnimationFrame(tick);
					};
					raf = requestAnimationFrame(tick);
				});
			});
		},
	};
}

/** @deprecated użyj beginIgniteBootCinematic — zostawione dla prostych testów. */
export async function playIgniteBootCinematic(
	host: HTMLElement = document.body,
): Promise<void> {
	const handle = beginIgniteBootCinematic(host);
	await handle.whenLogoReady;
	await handle.finish();
}
