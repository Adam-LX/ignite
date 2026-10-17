/**
 * MatchRealtimeRT — GPU BVH lighting (three-realtime-rt), TYLKO gdy gpuRealtimeRt ON.
 *
 * Bezpieczeństwa:
 * - brak ArenaRtProxy
 * - InstancedMesh ukryte na czas RT
 * - renderer.toneMapping = NoToneMapping podczas rt.render (composite ma własne ACES)
 * - auto-disable po compile > 800ms lub błędzie
 * - konserwatywny renderScale + fireflyClamp
 */

import * as THREE from "three";
import { RealtimeRaytracer } from "three-realtime-rt";

import {
	isPathTraceLookEnabled,
	isGpuRealtimeRtEnabled,
} from "../../util/presentationPrefs";
import { resolveGraphicsSettings } from "../../util/graphicsProfile";
import { disposeArenaRtProxy } from "./ArenaRtProxy";
import { tagSceneForRealtimeRt } from "./pathTraceSceneFilter";

export type RealtimeRtStats = {
	backend: "realtime-rt" | "fallback" | "warming";
	ms: number;
	compiled: boolean;
	excluded: number;
	staticVerts: number;
};

const RT_EMISSIVE_SCALE = 0.65;
const MAX_COMPILE_MS = 800;
/** Po N klatkach > tego progu — auto-disable GPU RT (film hybrid zostaje). */
const MAX_FRAME_MS = 42;
const MAX_HITCH_STREAK = 10;

export class MatchRealtimeRT {
	private rt: RealtimeRaytracer | null = null;
	private readonly renderer: THREE.WebGLRenderer;
	private sceneCompiled: THREE.Scene | null = null;
	private initFailed = false;
	private enabled = false;
	private suspended = false;
	private warmFrames = 0;
	private readonly WARM_FRAMES = 12;
	private lastExcluded = 0;
	private lastStaticVerts = 0;
	private dynamicMeshes: THREE.Mesh[] = [];
	private readonly emissiveBackup = new Map<
		THREE.MeshStandardMaterial,
		number
	>();
	private readonly hideStack: { obj: THREE.Object3D; visible: boolean }[] =
		[];
	private lightsDirty = true;
	private frameCounter = 0;
	private hitchStreak = 0;
	private lastStats: RealtimeRtStats = {
		backend: "fallback",
		ms: 0,
		compiled: false,
		excluded: 0,
		staticVerts: 0,
	};

	constructor(renderer: THREE.WebGLRenderer) {
		this.renderer = renderer;
	}

	isActive(): boolean {
		return (
			this.enabled &&
			!this.suspended &&
			this.rt !== null &&
			!this.initFailed &&
			this.sceneCompiled !== null &&
			this.warmFrames <= 0
		);
	}

	getLastStats(): RealtimeRtStats {
		return this.lastStats;
	}

	setSuspended(v: boolean): void {
		/** Tylko przy przejściu suspended→active resetuj warm — inaczej pętla klatek nigdy nie skończy warming. */
		if (this.suspended === v) return;
		this.suspended = v;
		if (!v) this.warmFrames = this.WARM_FRAMES;
	}

	syncEnabled(): void {
		const want =
			isPathTraceLookEnabled() &&
			isGpuRealtimeRtEnabled() &&
			!this.initFailed;
		this.enabled = want;
		if (want) this.ensureRt();
	}

	private ensureRt(): void {
		if (this.rt || this.initFailed) return;
		try {
			if (!RealtimeRaytracer.isSupported(this.renderer)) {
				this.initFailed = true;
				return;
			}
			const tier = RealtimeRaytracer.detectTier(this.renderer);
			const q = resolveGraphicsSettings().quality;
			const base = RealtimeRaytracer.recommendedOptions(tier);
			const opts = {
				...base,
				preset: "motion" as const,
				adaptiveQuality: true,
				targetFps: 60,
				/** Ambient+sky razem = white-out na otwartej arenie — trzymamy nisko. */
				ambient: true,
				gi: true,
				denoise: true,
				specular: true,
				reflections: true,
				restir: false,
				giHalfRate: true,
				fireflyClamp: 1.8,
				denoiseIterations: 2,
				maxHistory: 16,
				renderScale: q === "high" ? 0.36 : 0.28,
				renderScaleMax: 0.48,
				gbufferMaterialPooling: false,
				sky: {
					enabled: true,
					intensity: 0.22,
					zenith: new THREE.Color(0.08, 0.12, 0.22),
					horizon: new THREE.Color(0.22, 0.14, 0.08),
					sunColor: new THREE.Color(1.0, 0.82, 0.55),
					sunDir: new THREE.Vector3(0.25, 0.92, 0.2).normalize(),
				},
				volumetric: { enabled: false },
			};
			this.rt = new RealtimeRaytracer(
				this.renderer,
				opts as ConstructorParameters<typeof RealtimeRaytracer>[1],
			);
			const db = this.renderer.getDrawingBufferSize(new THREE.Vector2());
			this.rt.setSize(db.x, db.y);
		} catch (err) {
			console.error("[ignite] RealtimeRaytracer init failed", err);
			this.initFailed = true;
			this.rt = null;
			this.enabled = false;
		}
	}

	setSize(w: number, h: number): void {
		this.rt?.setSize(w, h);
	}

	invalidateScene(): void {
		this.sceneCompiled = null;
		this.warmFrames = this.WARM_FRAMES;
		this.lightsDirty = true;
	}

	notifyLightsChanged(): void {
		this.lightsDirty = true;
	}

	renderFrame(scene: THREE.Scene, camera: THREE.Camera): boolean {
		this.syncEnabled();
		if (!this.enabled || this.suspended || this.initFailed || !this.rt) {
			this.lastStats = {
				backend: "fallback",
				ms: 0,
				compiled: false,
				excluded: this.lastExcluded,
				staticVerts: this.lastStaticVerts,
			};
			return false;
		}

		disposeArenaRtProxy(scene);

		if (this.warmFrames > 0) {
			this.warmFrames--;
			this.lastStats = {
				backend: "warming",
				ms: 0,
				compiled: this.sceneCompiled === scene,
				excluded: this.lastExcluded,
				staticVerts: this.lastStaticVerts,
			};
			if (this.warmFrames === 6 && this.sceneCompiled !== scene) {
				this.compileNow(scene);
			}
			if (this.warmFrames === 0 && this.sceneCompiled === scene) {
				this.rt.resetAccumulation();
			}
			return false;
		}

		if (this.sceneCompiled !== scene) {
			this.compileNow(scene);
			if (this.sceneCompiled !== scene) return false;
			this.rt.resetAccumulation();
		}

		const t0 = performance.now();
		const prevTone = this.renderer.toneMapping;
		const prevExp = this.renderer.toneMappingExposure;
		try {
			this.frameCounter++;
			this.hideRtUnsafe(scene);
			/** Composite RT ma własne ACES — bez double tonemap (white-out). */
			this.renderer.toneMapping = THREE.NoToneMapping;
			this.renderer.toneMappingExposure = 1;

			if (this.dynamicMeshes.length > 0) {
				this.rt.updateDynamic();
			}
			if (this.lightsDirty || (this.frameCounter & 31) === 0) {
				this.rt.updateLights(scene);
				this.lightsDirty = false;
			}
			this.rt.render(scene, camera);

			const ms = performance.now() - t0;
			if (ms > MAX_FRAME_MS) {
				this.hitchStreak++;
				if (this.hitchStreak >= MAX_HITCH_STREAK) {
					console.warn(
						`[ignite] RT hitch streak ${this.hitchStreak}× >${MAX_FRAME_MS}ms — disable GPU RT`,
					);
					this.initFailed = true;
					this.enabled = false;
					this.hitchStreak = 0;
					return false;
				}
			} else {
				this.hitchStreak = 0;
			}
			this.lastStats = {
				backend: "realtime-rt",
				ms,
				compiled: false,
				excluded: this.lastExcluded,
				staticVerts: this.lastStaticVerts,
			};
			return true;
		} catch (err) {
			console.error("[ignite] realtime-rt frame failed", err);
			this.initFailed = true;
			this.enabled = false;
			return false;
		} finally {
			this.renderer.toneMapping = prevTone;
			this.renderer.toneMappingExposure = prevExp;
			this.restoreRtUnsafe();
		}
	}

	private hideRtUnsafe(scene: THREE.Scene): void {
		this.hideStack.length = 0;
		scene.traverse((obj) => {
			if (!obj.visible) return;
			if (
				obj.userData?.arenaRtProxy === true ||
				/arenaRtProxy|pitchPlanarReflector/i.test(obj.name || "")
			) {
				this.hideStack.push({ obj, visible: true });
				obj.visible = false;
				return;
			}
			if (obj instanceof THREE.InstancedMesh) {
				this.hideStack.push({ obj, visible: true });
				obj.visible = false;
			}
		});
	}

	private restoreRtUnsafe(): void {
		for (const s of this.hideStack) s.obj.visible = s.visible;
		this.hideStack.length = 0;
	}

	private compileNow(scene: THREE.Scene): void {
		if (!this.rt) return;
		disposeArenaRtProxy(scene);
		const t0 = performance.now();
		this.hideRtUnsafe(scene);
		const tagged = tagSceneForRealtimeRt(scene);
		this.dynamicMeshes = tagged.dynamic;
		this.lastExcluded = tagged.excluded;
		this.lastStaticVerts = tagged.staticVerts;
		this.clampEmissivesForCompile(scene);
		try {
			if (tagged.staticVerts < 800) {
				console.warn(
					`[ignite] RT BVH too empty (verts=${tagged.staticVerts}) — disable GPU RT`,
				);
				this.initFailed = true;
				this.sceneCompiled = null;
				this.enabled = false;
				return;
			}
			this.rt.compileScene(scene, {
				dynamicMeshes: this.dynamicMeshes,
			});
			const ms = performance.now() - t0;
			if (ms > MAX_COMPILE_MS) {
				console.warn(
					`[ignite] RT compile ${ms.toFixed(0)}ms > ${MAX_COMPILE_MS} — disable GPU RT for session`,
				);
				this.initFailed = true;
				this.sceneCompiled = null;
				this.enabled = false;
				return;
			}
			this.sceneCompiled = scene;
			this.lightsDirty = true;
			this.lastStats = {
				backend: "realtime-rt",
				ms,
				compiled: true,
				excluded: this.lastExcluded,
				staticVerts: this.lastStaticVerts,
			};
			console.info(
				`[ignite] RT compile ${ms.toFixed(0)}ms · verts=${tagged.staticVerts} dyn=${tagged.dynamic.length}`,
			);
		} catch (err) {
			console.error("[ignite] RT compile failed", err);
			this.initFailed = true;
			this.sceneCompiled = null;
			this.enabled = false;
		} finally {
			this.restoreEmissives();
			this.restoreRtUnsafe();
		}
	}

	private clampEmissivesForCompile(scene: THREE.Scene): void {
		this.emissiveBackup.clear();
		scene.traverse((obj) => {
			if (!(obj instanceof THREE.Mesh) || obj.userData?.rtExclude) return;
			const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
			for (const m of mats) {
				if (!(m instanceof THREE.MeshStandardMaterial)) continue;
				if (m.emissiveIntensity <= 0.08) continue;
				this.emissiveBackup.set(m, m.emissiveIntensity);
				m.emissiveIntensity *= RT_EMISSIVE_SCALE;
			}
		});
	}

	private restoreEmissives(): void {
		for (const [m, v] of this.emissiveBackup) m.emissiveIntensity = v;
		this.emissiveBackup.clear();
	}

	dispose(): void {
		this.restoreRtUnsafe();
		this.restoreEmissives();
		this.rt?.dispose();
		this.rt = null;
		this.sceneCompiled = null;
		this.dynamicMeshes = [];
	}
}
