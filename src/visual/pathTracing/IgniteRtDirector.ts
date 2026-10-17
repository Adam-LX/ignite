/**
 * IgniteRtDirector — produkcyjny stack wizuali „path tracing look”.
 *
 * Warstwa A (domyślna, pathTraceLook ON): film hybrid
 *   premiumPost + planar wet murawa + lacquer + soft shadows recipe
 *   — płynne, spektakularne, bez BVH freeze.
 *
 * Warstwa B (gpuRealtimeRt): GPU BVH beauty + planar wet composit na wierzch.
 *   Full-frame RT sam w sobie chował reflector i skipował premiumPost → sucha murawa.
 *   Teraz: RT render → compositePitchPlanarOverRt (autoClear=false).
 *   Gdy RT warming/fail → fallback film-hybrid (premiumPost).
 *
 * NIGDY layers.set na geometrii meczu.
 */

import * as THREE from "three";

import {
	isPathTraceLookEnabled,
	isGpuRealtimeRtEnabled,
} from "../../util/presentationPrefs";
import { resolveGraphicsSettings } from "../../util/graphicsProfile";
import { MatchRealtimeRT } from "./MatchRealtimeRT";
import type { RealtimeRtStats } from "./MatchRealtimeRT";
import {
	mountPitchPlanarReflection,
	disposePitchPlanarReflection,
	updatePitchPlanarReflection,
	compositePitchPlanarOverRt,
} from "./PitchPlanarReflection";
import { disposePathTraceAreaLights } from "./PathTraceAreaLights";
import { applyPathTraceLacquer } from "./pathTraceLacquer";
import { disposeArenaRtProxy } from "./ArenaRtProxy";
import { ensureMatchGeometryVisible } from "./ensureMatchGeometryVisible";
import { repairSceneLayers } from "./repairSceneLayers";
import { StadiumEnvProbe } from "./StadiumEnvProbe";
import type { PtDebugBackend } from "./pathTraceDebugHud";

export type RtDirectorFrameResult = {
	/** true = RT narysował klatkę; false = użyj premiumPost */
	usedRealtimeRt: boolean;
	backend: PtDebugBackend;
	stats: RealtimeRtStats | null;
};

export class IgniteRtDirector {
	private readonly realtime: MatchRealtimeRT;
	private readonly envProbe = new StadiumEnvProbe();
	private layersRepaired = false;
	private planarFrame = 0;
	/** Najwcześniejsza klatka na force CubeCamera bake (anti-hitch). */
	private envBakeDue = 180;
	private gpuBgLogged = false;

	constructor(renderer: THREE.WebGLRenderer) {
		this.realtime = new MatchRealtimeRT(renderer);
	}

	getRealtime(): MatchRealtimeRT {
		return this.realtime;
	}

	setSuspended(v: boolean): void {
		this.realtime.setSuspended(v);
	}

	invalidate(): void {
		this.realtime.invalidateScene();
		this.layersRepaired = false;
		/**
		 * NIE zeruj planarFrame — po prematch invalidate + bake na klatce 8
		 * = CubeCamera/PMREM hitch w countdown (freeze na początku meczu).
		 */
		this.gpuBgLogged = false;
		this.envBakeDue = Math.max(this.envBakeDue, this.planarFrame + 180);
	}

	syncEnabled(): void {
		this.realtime.syncEnabled();
	}

	setSize(w: number, h: number): void {
		this.realtime.setSize(w, h);
	}

	dispose(): void {
		this.realtime.dispose();
		disposePitchPlanarReflection();
		disposePathTraceAreaLights();
		this.envProbe.dispose();
	}

	/**
	 * Film hybrid albo GPU RT + planar wet composit.
	 */
	prepareAndMaybeRenderRt(
		renderer: THREE.WebGLRenderer,
		scene: THREE.Scene,
		camera: THREE.Camera,
	): RtDirectorFrameResult {
		disposeArenaRtProxy(scene);
		disposePathTraceAreaLights();

		if (!this.layersRepaired) {
			repairSceneLayers(scene);
			this.layersRepaired = true;
		}
		ensureMatchGeometryVisible(scene);

		const film = isPathTraceLookEnabled();
		const wantGpu = film && isGpuRealtimeRtEnabled();

		if (!film) {
			disposePitchPlanarReflection();
			this.realtime.setSuspended(true);
			this.gpuBgLogged = false;
			return {
				usedRealtimeRt: false,
				backend: "off",
				stats: null,
			};
		}

		const q = resolveGraphicsSettings().quality;
		const buf = renderer.getDrawingBufferSize(new THREE.Vector2());

		mountPitchPlanarReflection(scene, q, buf.x, buf.y);
		this.planarFrame++;
		if (this.planarFrame === 1) {
			console.info(
				"[ignite] film-hybrid prep · planar wet + lacquer + env probe",
			);
		}
		if (this.planarFrame === 1 || (this.planarFrame & 31) === 0) {
			updatePitchPlanarReflection(renderer, scene, camera);
			applyPathTraceLacquer(scene);
		}
		/**
		 * IBL: cold-start + okresowy refresh + lekkie śledzenie kamery
		 * (odbicia lamp/neonów wędrują po lakierze, nie stoją jak cubemap z midfield).
		 */
		const due =
			this.planarFrame >= this.envBakeDue &&
			(this.planarFrame === this.envBakeDue ||
				this.planarFrame % 480 === 0);
		if (due) {
			this.envProbe.setProbePosition(
				camera.position.x * 0.28,
				4.2 + Math.min(2.5, Math.max(0, camera.position.y - 4) * 0.15),
				camera.position.z * 0.28,
			);
			this.envProbe.update(renderer, scene, true);
			if (this.planarFrame === this.envBakeDue) {
				this.envBakeDue = this.planarFrame + 480;
			}
		} else {
			this.envProbe.update(renderer, scene, false);
		}

		if (!wantGpu) {
			this.realtime.setSuspended(true);
			this.gpuBgLogged = false;
			return {
				usedRealtimeRt: false,
				backend: "film-hybrid",
				stats: null,
			};
		}

		this.realtime.setSuspended(false);
		if (!this.gpuBgLogged) {
			this.gpuBgLogged = true;
			console.info(
				"[ignite] GPU RT ON — beauty BVH + planar wet composit (murawa zostaje)",
			);
		}

		const drew = this.realtime.renderFrame(scene, camera);
		const stats = this.realtime.getLastStats();

		if (!drew) {
			/** warming / compile / hitch → film-hybrid (premiumPost w Renderer). */
			const backend: PtDebugBackend =
				stats.backend === "warming" ? "warming" : "film-hybrid";
			return {
				usedRealtimeRt: false,
				backend,
				stats,
			};
		}

		compositePitchPlanarOverRt(renderer, scene, camera);
		return {
			usedRealtimeRt: true,
			backend: "realtime-rt",
			stats,
		};
	}
}
