/**
 * Pre-match pads — krótki countdown + roster (RL-style) przed startOnlineMatch.
 * Auta 3D: hero clones na kickoff spawnach w istniejącej arenie menu/meczu.
 */
import * as THREE from "three";

import { getModeSpec } from "../game/modes";
import { buildSpawnPositions } from "../modes/MatchController";
import { t } from "../i18n";
import type { LobbyStatePayload } from "../net/protocol";
import { PRE_MATCH_COUNTDOWN_MS } from "../net/protocol";
import type { OnlineLobbyResult } from "./MultiplayerLobby";
import type Scene from "../Scene";
import type Renderer from "../Renderer";
import {
	cloneCarMesh,
	disposeCarMeshGroup,
	loadCarModel,
} from "../visual/carVisuals";
import { loadCarCatalog, resolveCarId } from "../meta/CarCatalog";

export type PreMatchLobbyDeps = {
	scene: Scene;
	renderer: Renderer;
};

export class PreMatchLobbyScene {
	private readonly root: HTMLElement;
	private readonly countEl: HTMLElement;
	private readonly rosterEl: HTMLElement;
	private carsRoot: THREE.Group | null = null;
	private raf = 0;
	private disposed = false;

	constructor() {
		const el = document.getElementById("mp-prematch");
		const count = document.getElementById("mp-prematch-count");
		const roster = document.getElementById("mp-prematch-roster");
		if (!el || !count || !roster) {
			throw new Error("Brak #mp-prematch overlay");
		}
		this.root = el;
		this.countEl = count;
		this.rosterEl = roster;
	}

	async run(
		result: OnlineLobbyResult,
		deps: PreMatchLobbyDeps,
		onGo: () => void,
	): Promise<void> {
		this.disposed = false;
		this.root.classList.remove("hidden");
		const lobby =
			result.lobby ??
			result.roomClient.lastStartLobby ??
			result.roomClient.lobby;
		this.renderRoster(lobby);

		try {
			await this.spawnPadCars(result, lobby, deps);
		} catch (err) {
			console.warn("[PreMatch] pad cars:", err);
		}

		const endsAt =
			result.preMatchEndsAtMs ??
			result.roomClient.lastPreMatchEndsAtMs ??
			Date.now() + PRE_MATCH_COUNTDOWN_MS;

		await new Promise<void>((resolve) => {
			const tick = () => {
				if (this.disposed) {
					resolve();
					return;
				}
				const leftMs = Math.max(0, endsAt - Date.now());
				const sec = Math.ceil(leftMs / 1000);
				this.countEl.textContent = String(Math.max(1, sec));
				if (this.carsRoot) {
					this.carsRoot.rotation.y += 0.004;
					for (const child of this.carsRoot.children) {
						child.position.y +=
							Math.sin(performance.now() * 0.002 + child.id) * 0.0008;
					}
				}
				deps.renderer.render(deps.scene);
				if (leftMs <= 0) {
					resolve();
					return;
				}
				this.raf = requestAnimationFrame(tick);
			};
			this.raf = requestAnimationFrame(tick);
		});

		this.dispose(deps);
		onGo();
	}

	dispose(deps?: PreMatchLobbyDeps): void {
		this.disposed = true;
		if (this.raf) cancelAnimationFrame(this.raf);
		this.raf = 0;
		this.root.classList.add("hidden");
		if (this.carsRoot) {
			deps?.scene.threeJSScene.remove(this.carsRoot);
			for (const child of [...this.carsRoot.children]) {
				this.carsRoot.remove(child);
				disposeCarMeshGroup(child as THREE.Group);
			}
			this.carsRoot = null;
		}
	}

	private renderRoster(lobby: LobbyStatePayload | null): void {
		this.rosterEl.innerHTML = "";
		if (!lobby) return;
		for (const s of lobby.slots) {
			const chip = document.createElement("span");
			chip.className = `mp-prematch__chip mp-prematch__chip--${s.team}`;
			chip.textContent = s.isBot
				? `${s.name} · ${t("mp.slots.bot")}`
				: `${s.name} · ${s.carId}`;
			this.rosterEl.appendChild(chip);
		}
	}

	private async spawnPadCars(
		result: OnlineLobbyResult,
		lobby: LobbyStatePayload | null,
		deps: PreMatchLobbyDeps,
	): Promise<void> {
		await loadCarCatalog();
		const mode = result.mode;
		const spec = getModeSpec(mode);
		const spawns = buildSpawnPositions(mode, 0.35);
		const group = new THREE.Group();
		group.name = "preMatchPads";

		const slots = lobby?.slots ?? [];
		const n = Math.min(spec.playerCount, spawns.length, slots.length || spec.playerCount);

		for (let i = 0; i < n; i++) {
			const spawn = spawns[i]!;
			const info = slots.find((s) => s.slot === spawn.slotIndex) ?? slots[i];
			const carId = resolveCarId(info?.carId ?? "octane");
			const team = info?.team ?? spawn.visualTeam;
			const template = await loadCarModel(carId, team);
			const mesh = cloneCarMesh(template);
			disposeCarMeshGroup(template);
			mesh.position.copy(spawn.position);
			mesh.position.y += 0.15;
			mesh.rotation.y = spawn.yaw;
			mesh.scale.setScalar(1.05);
			group.add(mesh);
		}

		this.carsRoot = group;
		deps.scene.threeJSScene.add(group);

		const cam = deps.renderer.threeJSCamera;
		cam.position.set(0, 12, 28);
		cam.lookAt(0, 1.2, 0);
	}
}
