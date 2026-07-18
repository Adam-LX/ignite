import * as THREE from "three";

import { t } from "../i18n";
import { applyStaticI18n } from "../i18n/staticDom";
import { equipCosmetic, getInstanceProvenance } from "../meta/PlayerInventory";
import {
	getCosmeticNameKey,
	getCosmeticRarity,
	getInstanceDisplayRarity,
	getPaintDisplayRarity,
	getPaintRarityLabelKey,
	getCrateGlbPath,
	provenanceLineKey,
	type CosmeticRef,
} from "../meta/CosmeticCatalog";
import { getArenaEntry } from "../arena/ArenaCatalog";
import { getPaintEntry } from "../meta/PaintCatalog";
import type { DropResult } from "../meta/DropTable";
import { paintCssHex, paintTrailCssGradient } from "../visual/applyPaintCosmetic";
import { createGltfLoader } from "../util/gltfLoader";
import { mountCarThumbnail } from "./carThumbnail";

type Phase =
	| "hidden"
	| "drop"
	| "suspense"
	| "idle"
	| "charge"
	| "open"
	| "reveal"
	| "done";

const RARITY_GLOW: Record<string, string> = {
	common: "#9aa8b8",
	rare: "#44aaff",
	epic: "#cc66ff",
	legendary: "#ffb020",
};

const PAINT_TIER_GLOW: Record<string, string> = {
	common: "#9aa8b8",
	uncommon: "#66dd88",
	rare: "#44aaff",
	veryRare: "#cc66ff",
	legendary: "#ffb020",
};

/** 3D skrzynka + reveal itemu po meczu. */
export class CrateRevealOverlay {
	private readonly root: HTMLElement;
	private readonly canvasHost: HTMLElement;
	private visible = false;
	private phase: Phase = "hidden";
	private phaseT = 0;
	private item: CosmeticRef | null = null;
	private queue: CosmeticRef[] = [];
	private queueTotal = 0;
	private raf = 0;
	private onGarage: ((ref: CosmeticRef) => void) | null = null;
	private onDismiss: (() => void) | null = null;
	private onRevealSound:
		| ((rarity: "common" | "rare" | "epic" | "legendary") => void)
		| null = null;
	private onLiveBackdrop: ((active: boolean) => void) | null = null;
	private onPhaseAudio:
		| ((phase: "drop" | "suspense" | "charge" | "open" | "hide") => void)
		| null = null;
	private thumbSeq = 0;

	private renderer: THREE.WebGLRenderer | null = null;
	private scene: THREE.Scene | null = null;
	private camera: THREE.PerspectiveCamera | null = null;
	private readonly camBase = new THREE.Vector3(0, 0.05, 2.5);
	private readonly camLook = new THREE.Vector3(0, 0.05, 0);
	private shakeRemain = 0;
	private shakeAmp = 0;
	private crateRoot: THREE.Group | null = null;
	private lidPivot: THREE.Group | null = null;
	private mirrorRoot: THREE.Group | null = null;
	private mirrorLidPivot: THREE.Group | null = null;
	/** Lokalna wysokość „podłogi” (dół AABB skrzynki przy y=0). */
	private mirrorFloorY = -0.5;
	private crateBaseY = 0;
	private lastNow = 0;
	private orbitSparks: {
		el: HTMLElement;
		angle: number;
		speed: number;
		rx: number;
		ry: number;
		wobble: number;
		wobbleSpeed: number;
		fade: number;
		fadeSpeed: number;
		baseOpacity: number;
	}[] = [];

	constructor() {
		const el = document.createElement("div");
		el.id = "crate-reveal";
		el.className = "crate-reveal hidden";
		el.setAttribute("role", "dialog");
		el.setAttribute("aria-modal", "true");
		document.body.appendChild(el);
		this.root = el;
		this.canvasHost = document.createElement("div");
		this.canvasHost.className = "crate-reveal__canvas";
		this.renderShell();
	}

	setCallbacks(
		onGarage: (ref: CosmeticRef) => void,
		onDismiss: () => void,
		onRevealSound?: (rarity: "common" | "rare" | "epic" | "legendary") => void,
		onLiveBackdrop?: (active: boolean) => void,
		onPhaseAudio?: (phase: "drop" | "suspense" | "charge" | "open" | "hide") => void,
	): void {
		this.onGarage = onGarage;
		this.onDismiss = onDismiss;
		this.onRevealSound = onRevealSound ?? null;
		this.onLiveBackdrop = onLiveBackdrop ?? null;
		this.onPhaseAudio = onPhaseAudio ?? null;
	}

	isVisible(): boolean {
		return this.visible;
	}

	showDrop(drop: Extract<DropResult, { kind: "crate" }>): void {
		this.queue = [...drop.items];
		this.queueTotal = drop.items.length;
		this.revealNextFromQueue();
	}

	private revealNextFromQueue(): void {
		const next = this.queue.shift();
		if (!next) {
			this.hide(true);
			return;
		}
		this.presentItem(next);
	}

	private presentItem(item: CosmeticRef): void {
		this.item = item;
		this.phase = "drop";
		this.phaseT = 0;
		const wasHidden = !this.visible;
		this.visible = true;
		this.thumbSeq += 1;
		this.clearOrbitSparks();
		this.root.classList.remove(
			"hidden",
			"crate-reveal--revealed",
			"crate-reveal--burst",
			"crate-reveal--enter",
			"crate-reveal--opening",
			"crate-reveal--idle",
			"crate-reveal--suspense",
			"crate-reveal--charge",
			"crate-reveal--landed",
			"crate-reveal--shake",
		);
		void this.root.offsetWidth;
		this.root.classList.add("crate-reveal--open", "crate-reveal--sealed");
		this.root.style.setProperty("--crate-tension", "0");
		document.body.classList.add("crate-drop-open");
		if (wasHidden) this.onLiveBackdrop?.(true);
		requestAnimationFrame(() => {
			this.root.classList.add("crate-reveal--enter");
			// Krótki flash przy materializacji okna.
			this.root.classList.remove("crate-reveal--burst");
			void this.root.offsetWidth;
			this.root.classList.add("crate-reveal--burst");
		});
		this.onPhaseAudio?.("drop");

		const glowRarity = getInstanceDisplayRarity(item);
		this.root.dataset.rarity = glowRarity;
		this.root.style.setProperty(
			"--crate-rarity",
			RARITY_GLOW[glowRarity] ?? "#44aaff",
		);
		/* Fanfara dopiero przy kliknięciu / otwarciu — nie na samym dropie. */

		const itemRarity = getCosmeticRarity(item);
		const paintTier = item.paintId ? getPaintDisplayRarity(item) : null;

		const name = t(getCosmeticNameKey(item) as never);
		const titleEl = this.root.querySelector("#crate-reveal-title");
		const nameEl = this.root.querySelector("#crate-reveal-item");
		const itemRarityEl = this.root.querySelector<HTMLElement>("#crate-reveal-item-rarity");
		const paintTierEl = this.root.querySelector<HTMLElement>("#crate-reveal-paint-tier");
		const paintEl = this.root.querySelector("#crate-reveal-paint");
		const batchEl = this.root.querySelector<HTMLElement>("#crate-reveal-batch");
		const swatchEl = this.root.querySelector<HTMLElement>("[data-crate-paint-swatch]");
		const card = this.root.querySelector("[data-crate-item-card]");
		card?.classList.add("hidden");
		card?.setAttribute("aria-hidden", "true");

		const thumbHost = this.root.querySelector<HTMLElement>("[data-crate-item-thumb]");
		if (thumbHost) {
			thumbHost.replaceChildren();
			thumbHost.className = "crate-reveal__item-thumb";
			thumbHost.style.background = "";
		}

		if (titleEl) titleEl.textContent = t("crate.title");
		if (nameEl) nameEl.textContent = name;
		const provEl = this.root.querySelector("#crate-reveal-provenance");
		if (provEl) {
			const prov = getInstanceProvenance(item);
			const key = provenanceLineKey(prov);
			let arenaLabel = "";
			if (prov?.arenaId) {
				const arena = getArenaEntry(prov.arenaId);
				arenaLabel = arena
					? t(arena.nameKey as never)
					: prov.arenaId;
			}
			provEl.textContent = arenaLabel
				? t("crate.provenanceWithArena" as never, {
						where: t(key as never),
						arena: arenaLabel,
					})
				: t("crate.provenance" as never, { where: t(key as never) });
		}
		if (itemRarityEl) {
			itemRarityEl.textContent = t(`inventory.rarity.${itemRarity}` as never);
			itemRarityEl.className = `crate-reveal__tag crate-reveal__tag--item crate-reveal__tag--${itemRarity}`;
		}
		if (paintTierEl) {
			if (paintTier && item.paintId) {
				paintTierEl.hidden = false;
				paintTierEl.textContent = t(getPaintRarityLabelKey(item.paintId) as never);
				paintTierEl.className = `crate-reveal__tag crate-reveal__tag--paint crate-reveal__tag--${paintTier}`;
				const paintRaw = getPaintEntry(item.paintId)?.rarity ?? "common";
				this.root.style.setProperty(
					"--crate-paint-tier",
					PAINT_TIER_GLOW[paintRaw] ?? "#44aaff",
				);
			} else {
				paintTierEl.hidden = true;
			}
		}
		if (paintEl) {
			if (item.paintId) {
				const paint = getPaintEntry(item.paintId);
				paintEl.textContent = paint
					? t(paint.nameKey as never)
					: item.paintId;
				paintEl.classList.remove("crate-reveal__paint--standard");
			} else {
				paintEl.textContent = t("garage.unpainted");
				paintEl.classList.add("crate-reveal__paint--standard");
			}
		}
		if (swatchEl) {
			const hex = paintCssHex(item.paintId);
			if (hex) {
				swatchEl.style.background = hex;
				swatchEl.hidden = false;
			} else {
				swatchEl.hidden = true;
			}
		}
		if (batchEl) {
			if (this.queueTotal > 1) {
				const idx = this.queueTotal - this.queue.length;
				batchEl.hidden = false;
				batchEl.textContent = t("crate.batchProgress", {
					current: idx,
					total: this.queueTotal,
				});
			} else {
				batchEl.hidden = true;
			}
		}

		const continueBtn = this.root.querySelector<HTMLButtonElement>(
			"[data-crate-continue]",
		);
		if (continueBtn) {
			continueBtn.textContent =
				this.queue.length > 0
					? t("crate.nextCrate")
					: t("crate.continue");
		}

		applyStaticI18n(this.root);
		void this.initScene().then(() => {
			if (this.visible) this.startLoop();
		});
	}

	hide(callDismiss = true): void {
		if (!this.visible) return;
		this.visible = false;
		this.phase = "hidden";
		this.queue = [];
		this.queueTotal = 0;
		this.thumbSeq += 1;
		cancelAnimationFrame(this.raf);
		this.root.classList.remove(
			"crate-reveal--open",
			"crate-reveal--revealed",
			"crate-reveal--burst",
			"crate-reveal--enter",
			"crate-reveal--opening",
			"crate-reveal--idle",
			"crate-reveal--sealed",
			"crate-reveal--suspense",
			"crate-reveal--charge",
			"crate-reveal--landed",
			"crate-reveal--shake",
		);
		this.root.classList.add("hidden");
		document.body.classList.remove("crate-drop-open");
		this.onPhaseAudio?.("hide");
		this.onLiveBackdrop?.(false);
		this.disposeScene();
		if (callDismiss) this.onDismiss?.();
	}

	/** ESC / Wróć — otwórz od razu albo następna skrzynka. */
	dismissViaBack(): void {
		if (!this.visible) return;
		if (
			this.phase === "drop" ||
			this.phase === "suspense" ||
			this.phase === "idle" ||
			this.phase === "charge"
		) {
			this.beginOpen(true);
			return;
		}
		if (this.phase === "open") {
			this.enterReveal();
			return;
		}
		this.disposeScene();
		this.root.classList.remove("crate-reveal--revealed");
		if (this.queue.length > 0) {
			this.revealNextFromQueue();
		} else {
			this.hide(true);
		}
	}

	private kindEmoji(kind: CosmeticRef["kind"]): string {
		switch (kind) {
			case "trail":
				return "✦";
			case "wheel":
				return "◎";
			case "topper":
				return "▲";
			case "decal":
				return "◈";
			case "goalExplosion":
				return "💥";
			case "arena":
				return "▣";
			default:
				return "🚗";
		}
	}

	private renderShell(): void {
		this.root.innerHTML = `
      <div class="crate-reveal__backdrop" aria-hidden="true">
        <div class="crate-reveal__grid"></div>
        <div class="crate-reveal__aurora"></div>
        <div class="crate-reveal__flames"></div>
        <div class="crate-reveal__embers"></div>
        <div class="crate-reveal__vignette"></div>
        <div class="crate-reveal__flash"></div>
      </div>
      <div class="crate-reveal__screen-sparks" data-crate-screen-sparks aria-hidden="true"></div>
      <div class="crate-reveal__frame">
        <div class="crate-reveal__grudge" aria-hidden="true"></div>
        <div class="crate-reveal__panel">
          <div class="crate-reveal__border-run" aria-hidden="true">
            <div class="crate-reveal__border-run-spin"></div>
          </div>
          <div class="crate-reveal__panel-glow" aria-hidden="true"></div>
        <div class="crate-reveal__stage" data-crate-stage>
          <div class="crate-reveal__stage-wall" aria-hidden="true"></div>
          <div class="crate-reveal__stage-gold" aria-hidden="true"></div>
          <div class="crate-reveal__stage-bolts" aria-hidden="true"></div>
          <div class="crate-reveal__stage-spiral crate-reveal__stage-spiral--a" aria-hidden="true"></div>
          <div class="crate-reveal__stage-spiral crate-reveal__stage-spiral--b" aria-hidden="true"></div>
          <div class="crate-reveal__stage-spiral crate-reveal__stage-spiral--c" aria-hidden="true"></div>
          <div class="crate-reveal__stage-horizon" aria-hidden="true"></div>
          <div class="crate-reveal__stage-floor" aria-hidden="true"></div>
          <div class="crate-reveal__stage-ring" aria-hidden="true"></div>
          <div class="crate-reveal__stage-ring crate-reveal__stage-ring--outer" aria-hidden="true"></div>
          <div class="crate-reveal__canvas-wrap"></div>
          <div class="crate-reveal__tension" aria-hidden="true">
            <div class="crate-reveal__tension-ring"></div>
            <div class="crate-reveal__tension-ring crate-reveal__tension-ring--b"></div>
          </div>
          <div class="crate-reveal__shockwave" data-crate-shockwave aria-hidden="true"></div>
          <div class="crate-reveal__sparkles" data-crate-sparkles aria-hidden="true"></div>
          <button type="button" class="crate-reveal__open-hit" data-crate-open aria-label="${t("crate.clickToOpen")}">
            <span class="crate-reveal__open-hint" data-crate-hint data-i18n="crate.suspenseHint">${t("crate.suspenseHint")}</span>
          </button>
          <div class="crate-reveal__item-card hidden" data-crate-item-card aria-hidden="true">
            <div class="crate-reveal__prize-halo" aria-hidden="true"></div>
            <div class="crate-reveal__prize-bloom" aria-hidden="true"></div>
            <div class="crate-reveal__orbit-sparks crate-reveal__orbit-sparks--back" data-crate-orbit-back aria-hidden="true"></div>
            <div class="crate-reveal__item-thumb" data-crate-item-thumb></div>
            <div class="crate-reveal__orbit-sparks crate-reveal__orbit-sparks--front" data-crate-orbit-front aria-hidden="true"></div>
          </div>
        </div>
        <div class="crate-reveal__headline">
          <div class="crate-reveal__headline-shine" aria-hidden="true"></div>
          <p class="crate-reveal__kicker" data-i18n="crate.newDrop">${t("crate.newDrop")}</p>
          <p id="crate-reveal-batch" class="crate-reveal__batch" hidden></p>
          <h2 id="crate-reveal-title" class="crate-reveal__title">${t("crate.title")}</h2>
        </div>
        <div class="crate-reveal__loot" data-crate-loot>
          <div class="crate-reveal__tags">
            <span id="crate-reveal-item-rarity" class="crate-reveal__tag"></span>
            <span id="crate-reveal-paint-tier" class="crate-reveal__tag" hidden></span>
          </div>
          <div class="crate-reveal__paint-row">
            <span class="crate-reveal__paint-swatch" data-crate-paint-swatch aria-hidden="true"></span>
            <p id="crate-reveal-paint" class="crate-reveal__paint"></p>
          </div>
          <p id="crate-reveal-item" class="crate-reveal__item">—</p>
          <p id="crate-reveal-provenance" class="crate-reveal__provenance"></p>
        </div>
        <div class="crate-reveal__actions" data-crate-actions>
          <button type="button" class="ui-ignite-back crate-reveal__back" data-crate-back aria-label="${t("ui.back")}">
            <span class="ui-ignite-back__shine" aria-hidden="true"></span>
            <span class="ui-ignite-back__icon" aria-hidden="true">←</span>
            <span class="ui-ignite-back__label" data-i18n="ui.back">${t("ui.back")}</span>
          </button>
          <button type="button" class="crate-reveal__btn crate-reveal__btn--primary" data-crate-equip data-i18n="crate.equipNow">${t("crate.equipNow")}</button>
          <button type="button" class="crate-reveal__btn" data-crate-garage data-i18n="crate.toGarage">${t("crate.toGarage")}</button>
          <button type="button" class="crate-reveal__btn crate-reveal__btn--ghost" data-crate-continue data-i18n="crate.continue">${t("crate.continue")}</button>
        </div>
      </div>
      </div>`;

		const wrap = this.root.querySelector(".crate-reveal__canvas-wrap");
		wrap?.appendChild(this.canvasHost);

		this.root.querySelector("[data-crate-open]")?.addEventListener("click", (e) => {
			e.stopPropagation();
			this.beginOpen(false);
		});
		this.root.querySelector("[data-crate-back]")?.addEventListener("click", () => {
			this.dismissViaBack();
		});
		this.root.querySelector("[data-crate-equip]")?.addEventListener("click", () => {
			if (this.item) equipCosmetic(this.item);
			this.openGarage();
		});
		this.root.querySelector("[data-crate-garage]")?.addEventListener("click", () => {
			this.openGarage();
		});
		this.root.querySelector("[data-crate-continue]")?.addEventListener("click", () => {
			this.disposeScene();
			this.root.classList.remove("crate-reveal--revealed");
			if (this.queue.length > 0) {
				this.revealNextFromQueue();
			} else {
				this.hide(true);
			}
		});
	}

	private openGarage(): void {
		const ref = this.item;
		this.hide(false);
		if (ref) this.onGarage?.(ref);
	}

	private async initScene(): Promise<void> {
		this.disposeScene();
		// Poczekaj na layout panelu (enter animation) — inaczej stage bywa 0×0.
		await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
		if (!this.visible) return;

		let w = this.canvasHost.clientWidth;
		let h = this.canvasHost.clientHeight;
		if (w < 32 || h < 32) {
			w = 560;
			h = 400;
		}

		this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		this.renderer.setSize(w, h, false);
		this.renderer.setClearColor(0x000000, 0);
		this.canvasHost.replaceChildren(this.renderer.domElement);

		this.scene = new THREE.Scene();
		this.camera = new THREE.PerspectiveCamera(36, w / h, 0.05, 80);
		this.camBase.set(0, 0.05, 2.5);
		this.camLook.set(0, 0.05, 0);
		this.camera.position.copy(this.camBase);
		this.camera.lookAt(this.camLook);
		this.shakeRemain = 0;
		this.shakeAmp = 0;

		const amb = new THREE.AmbientLight(0xffffff, 0.7);
		const key = new THREE.DirectionalLight(0xffaa66, 1.65);
		key.position.set(2.2, 4.2, 3.2);
		const rim = new THREE.DirectionalLight(0x3dffe8, 1.25);
		rim.position.set(-3.2, 2.2, -2.4);
		const fill = new THREE.PointLight(0xff6622, 1.35, 12);
		fill.position.set(0, 0.15, 1.8);
		this.scene.add(amb, key, rim, fill);

		this.crateRoot = new THREE.Group();
		this.lidPivot = new THREE.Group();
		this.lidPivot.userData.crateLidPivot = true;
		this.lidPivot.position.set(0, 0.42, -0.18);
		this.crateRoot.add(this.lidPivot);
		this.scene.add(this.crateRoot);

		try {
			const loader = createGltfLoader();
			const gltf = await loader.loadAsync(getCrateGlbPath());
			if (!this.visible || !this.crateRoot || !this.camera) return;
			const model = gltf.scene;
			// Stała skala (wcześniej 1.35 ucinało; 1.0 + kamera dalej = całość w kadrze).
			model.scale.setScalar(1.0);
			model.position.set(0, 0, 0);
			// Wycentruj AABB modelu w origin — idealny środek kadru.
			model.updateMatrixWorld(true);
			const box = new THREE.Box3().setFromObject(model);
			if (!box.isEmpty()) {
				const c = box.getCenter(new THREE.Vector3());
				model.position.sub(c);
			}
			this.crateRoot.add(model);
		} catch (err) {
			console.warn("[crate] GLB load failed, fallback box", err);
			if (!this.visible || !this.crateRoot) return;
			const fallback = new THREE.Group();
			this.crateRoot.add(fallback);
			this.buildFallbackCrate(fallback);
		}

		if (this.crateRoot) {
			this.setupMirrorReflection();
			this.crateBaseY = 0;
			this.crateRoot.position.set(0, 2.6, 0);
			this.crateRoot.scale.setScalar(1);
			this.syncMirrorReflection();
		}
		this.resizeRendererToHost();
	}

	private resizeRendererToHost(): void {
		if (!this.renderer || !this.camera) return;
		const w = Math.max(1, this.canvasHost.clientWidth || 560);
		const h = Math.max(1, this.canvasHost.clientHeight || 400);
		this.renderer.setSize(w, h, false);
		this.camera.aspect = w / h;
		this.camera.updateProjectionMatrix();
	}

	private buildFallbackCrate(host: THREE.Group = this.crateRoot!): void {
		if (!this.lidPivot) return;
		const bodyMat = new THREE.MeshStandardMaterial({
			color: 0x1a2438,
			metalness: 0.65,
			roughness: 0.35,
			emissive: 0xff6622,
			emissiveIntensity: 0.12,
		});
		const trimMat = new THREE.MeshStandardMaterial({
			color: 0x22ccff,
			emissive: 0x22ccff,
			emissiveIntensity: 0.55,
			metalness: 0.8,
			roughness: 0.2,
		});
		const body = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.82, 1.35), bodyMat);
		body.position.y = 0.15;
		const lid = new THREE.Mesh(new THREE.BoxGeometry(1.38, 0.26, 1.38), bodyMat.clone());
		lid.position.set(0, 0.26, 0);
		this.lidPivot.add(lid);
		for (const [px, pz] of [
			[0.69, 0],
			[-0.69, 0],
			[0, 0.69],
			[0, -0.69],
		] as const) {
			const edge = new THREE.Mesh(
				new THREE.BoxGeometry(px === 0 ? 1.4 : 0.08, 0.86, pz === 0 ? 1.4 : 0.08),
				trimMat,
			);
			edge.position.set(px * 0.5, 0.15, pz * 0.5);
			host.add(edge);
		}
		host.add(body);
	}

	/** Lustrzane odbicie pionowe — skrzynka „stoi na podłodze”. */
	private setupMirrorReflection(): void {
		if (!this.scene || !this.crateRoot) return;
		if (this.mirrorRoot) {
			this.scene.remove(this.mirrorRoot);
			this.mirrorRoot = null;
			this.mirrorLidPivot = null;
		}

		this.crateRoot.updateMatrixWorld(true);
		const box = new THREE.Box3().setFromObject(this.crateRoot);
		this.mirrorFloorY = box.isEmpty() ? -0.5 : box.min.y;

		const mirror = this.crateRoot.clone(true);
		this.applyMirrorMaterials(mirror);
		let mirrorLid: THREE.Group | null = null;
		mirror.traverse((obj) => {
			if (obj.userData.crateLidPivot) mirrorLid = obj as THREE.Group;
		});
		this.mirrorRoot = mirror;
		this.mirrorLidPivot = mirrorLid;
		this.scene.add(mirror);
	}

	private applyMirrorMaterials(root: THREE.Object3D): void {
		root.traverse((obj) => {
			const mesh = obj as THREE.Mesh;
			if (!mesh.isMesh || !mesh.material) return;
			const srcMats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
			const next = srcMats.map((mat) => {
				const c = mat.clone();
				c.transparent = true;
				c.opacity = Math.min(0.48, (c.opacity ?? 1) * 0.45);
				c.depthWrite = false;
				c.side = THREE.DoubleSide;
				if (c instanceof THREE.MeshStandardMaterial || c instanceof THREE.MeshPhysicalMaterial) {
					c.metalness = Math.min(1, c.metalness * 0.55);
					c.roughness = Math.min(1, c.roughness + 0.28);
					c.emissiveIntensity *= 0.4;
					c.envMapIntensity = Math.min(c.envMapIntensity ?? 1, 0.35);
				}
				return c;
			});
			mesh.material = next.length === 1 ? next[0]! : next;
			mesh.renderOrder = -2;
			mesh.castShadow = false;
			mesh.receiveShadow = false;
		});
	}

	private syncMirrorReflection(): void {
		if (!this.crateRoot || !this.mirrorRoot) return;
		const src = this.crateRoot;
		const m = this.mirrorRoot;
		m.visible = src.visible;
		const sy = Math.abs(src.scale.y) || 1;
		// Odbicie względem płaszczyzny y = mirrorFloorY (przy skali 1).
		m.position.set(
			src.position.x,
			2 * this.mirrorFloorY * sy - src.position.y,
			src.position.z,
		);
		m.rotation.copy(src.rotation);
		m.scale.set(src.scale.x, -sy, src.scale.z);
		if (this.lidPivot && this.mirrorLidPivot) {
			this.mirrorLidPivot.position.copy(this.lidPivot.position);
			this.mirrorLidPivot.rotation.copy(this.lidPivot.rotation);
			this.mirrorLidPivot.scale.copy(this.lidPivot.scale);
		}
	}

	private triggerCameraShake(amp: number, durationSec: number): void {
		this.shakeAmp = Math.max(this.shakeAmp, amp);
		this.shakeRemain = Math.max(this.shakeRemain, durationSec);
	}

	private pulsePanelShake(): void {
		this.root.classList.remove("crate-reveal--shake");
		void this.root.offsetWidth;
		this.root.classList.add("crate-reveal--shake");
	}

	private updateCameraShake(dt: number): void {
		if (!this.camera) return;
		if (this.shakeRemain <= 0) {
			this.shakeAmp = 0;
			this.camera.position.copy(this.camBase);
			this.camera.lookAt(this.camLook);
			return;
		}
		this.shakeRemain = Math.max(0, this.shakeRemain - dt);
		const falloff = this.shakeRemain > 0 ? Math.min(1, this.shakeRemain * 3.2) : 0;
		const a = this.shakeAmp * falloff;
		this.camera.position.set(
			this.camBase.x + (Math.random() - 0.5) * a * 2.4,
			this.camBase.y + (Math.random() - 0.5) * a * 1.8,
			this.camBase.z + (Math.random() - 0.5) * a * 0.9,
		);
		this.camera.lookAt(
			this.camLook.x + (Math.random() - 0.5) * a * 0.35,
			this.camLook.y + (Math.random() - 0.5) * a * 0.25,
			this.camLook.z,
		);
	}

	private startLoop(): void {
		const tick = (now: number) => {
			if (!this.visible) return;
			const dt = Math.min(0.05, (now - (this.lastNow || now)) / 1000);
			this.lastNow = now;
			this.phaseT += dt;
			this.updateAnim(dt);
			this.syncMirrorReflection();
			this.updateCameraShake(dt);
			if (this.renderer && this.scene && this.camera) {
				this.renderer.render(this.scene, this.camera);
			}
			this.raf = requestAnimationFrame(tick);
		};
		this.lastNow = performance.now();
		this.raf = requestAnimationFrame(tick);
	}

	private setHint(key: "crate.suspenseHint" | "crate.clickToOpen" | "crate.chargeHint"): void {
		const hint = this.root.querySelector<HTMLElement>("[data-crate-hint]");
		const btn = this.root.querySelector<HTMLButtonElement>("[data-crate-open]");
		const label = t(key);
		if (hint) hint.textContent = label;
		if (btn) btn.setAttribute("aria-label", label);
	}

	private beginOpen(skipFx: boolean): void {
		if (!this.visible) return;
		if (this.phase === "suspense" || this.phase === "drop") {
			if (!skipFx) return;
		}
		if (
			this.phase !== "idle" &&
			this.phase !== "suspense" &&
			this.phase !== "drop"
		) {
			return;
		}

		if (skipFx) {
			this.phase = "open";
			this.phaseT = 0;
			this.root.classList.remove(
				"crate-reveal--idle",
				"crate-reveal--suspense",
				"crate-reveal--charge",
			);
			this.root.classList.add("crate-reveal--opening");
			if (this.lidPivot) this.lidPivot.rotation.x = -1.45;
			if (this.crateRoot) this.crateRoot.visible = false;
			const rarity = (this.root.dataset.rarity ?? "rare") as
				| "common"
				| "rare"
				| "epic"
				| "legendary";
			this.onRevealSound?.(rarity);
			this.enterReveal();
			return;
		}

		this.phase = "charge";
		this.phaseT = 0;
		this.root.classList.remove("crate-reveal--idle", "crate-reveal--suspense");
		this.root.classList.add("crate-reveal--charge");
		this.setHint("crate.chargeHint");
		this.onPhaseAudio?.("charge");
		this.triggerCameraShake(0.045, 0.28);
		this.pulsePanelShake();
		void this.mountPrizeThumb({ keepHidden: true });
	}

	private finishChargeIntoOpen(): void {
		this.phase = "open";
		this.phaseT = 0;
		this.root.classList.remove("crate-reveal--charge");
		this.root.classList.add("crate-reveal--opening");
		this.onPhaseAudio?.("open");

		if (this.crateRoot) {
			this.crateRoot.rotation.z = 0;
			this.crateRoot.rotation.x = 0;
			this.crateRoot.position.y = this.crateBaseY;
			this.crateRoot.scale.setScalar(1);
			this.crateRoot.visible = true;
		}

		const rarity = (this.root.dataset.rarity ?? "rare") as
			| "common"
			| "rare"
			| "epic"
			| "legendary";
		this.onRevealSound?.(rarity);
		this.burstSparkles();
		this.pulseShockwave();
		this.triggerCameraShake(0.12, 0.55);
		this.pulsePanelShake();
		this.root.classList.remove("crate-reveal--burst");
		void this.root.offsetWidth;
		this.root.classList.add("crate-reveal--burst");
	}

	private pulseShockwave(): void {
		const wave = this.root.querySelector<HTMLElement>("[data-crate-shockwave]");
		if (!wave) return;
		wave.classList.remove("crate-reveal__shockwave--boom");
		void wave.offsetWidth;
		wave.classList.add("crate-reveal__shockwave--boom");
	}

	private burstSparkles(): void {
		const stageHost = this.root.querySelector<HTMLElement>("[data-crate-sparkles]");
		const screenHost = this.root.querySelector<HTMLElement>("[data-crate-screen-sparks]");
		this.fillSparkHost(stageHost, 36, 0.48);
		this.fillSparkHost(screenHost, 96, 0.92);
	}

	private fillSparkHost(
		host: HTMLElement | null,
		count: number,
		spread: number,
	): void {
		if (!host) return;
		host.replaceChildren();
		for (let i = 0; i < count; i++) {
			const s = document.createElement("span");
			s.className = "crate-reveal__spark";
			const angle = Math.random() * Math.PI * 2;
			const dist = 30 + Math.random() * 120 * spread;
			const ox = (Math.random() - 0.5) * 40 * spread;
			const oy = (Math.random() - 0.5) * 36 * spread;
			s.style.setProperty("--sx", `${ox + Math.cos(angle) * dist}vw`);
			s.style.setProperty("--sy", `${oy + Math.sin(angle) * dist * 0.7}vh`);
			s.style.setProperty("--sd", `${0.55 + Math.random() * 0.95}s`);
			s.style.setProperty("--ss", `${0.8 + Math.random() * 1.8}`);
			s.style.left = `${12 + Math.random() * 76}%`;
			s.style.top = `${18 + Math.random() * 64}%`;
			if (i % 4 === 0) s.classList.add("crate-reveal__spark--big");
			if (i % 5 === 0) s.classList.add("crate-reveal__spark--streak");
			host.appendChild(s);
		}
		host.classList.remove("crate-reveal__sparkles--burst");
		void host.offsetWidth;
		host.classList.add("crate-reveal__sparkles--burst");
	}

	private enterReveal(): void {
		this.phase = "reveal";
		this.phaseT = 0;
		if (this.crateRoot) {
			this.crateRoot.visible = false;
			this.crateRoot.scale.setScalar(0.01);
		}
		if (this.lidPivot) this.lidPivot.rotation.x = -1.45;
		this.root.classList.remove(
			"crate-reveal--sealed",
			"crate-reveal--opening",
			"crate-reveal--idle",
			"crate-reveal--suspense",
			"crate-reveal--charge",
		);
		this.root.classList.add("crate-reveal--revealed");
		this.root.style.removeProperty("--crate-tension");
		this.startOrbitSparks();
		void this.mountPrizeThumb({ keepHidden: false });
	}

	private clearOrbitSparks(): void {
		for (const s of this.orbitSparks) s.el.remove();
		this.orbitSparks = [];
		this.root.querySelector("[data-crate-orbit-back]")?.replaceChildren();
		this.root.querySelector("[data-crate-orbit-front]")?.replaceChildren();
	}

	/** Iskry krążące po elipsie wokół dropu — warstwa za i przed modelem. */
	private startOrbitSparks(): void {
		this.clearOrbitSparks();
		const back = this.root.querySelector<HTMLElement>("[data-crate-orbit-back]");
		const front = this.root.querySelector<HTMLElement>("[data-crate-orbit-front]");
		if (!back || !front) return;
		const count = 72;
		for (let i = 0; i < count; i++) {
			const el = document.createElement("span");
			el.className = "crate-reveal__orbit-spark";
			const size = 3 + Math.random() * 11;
			el.style.width = `${size}px`;
			el.style.height = `${size * (0.5 + Math.random() * 1.2)}px`;
			if (Math.random() < 0.32) el.classList.add("crate-reveal__orbit-spark--streak");
			if (Math.random() < 0.25) el.classList.add("crate-reveal__orbit-spark--hot");
			const ring = Math.random();
			const rx =
				ring < 0.28
					? 14 + Math.random() * 10
					: ring < 0.7
						? 28 + Math.random() * 12
						: 40 + Math.random() * 14;
			const ry = rx * (0.72 + Math.random() * 0.18);
			const angle = Math.random() * Math.PI * 2;
			// Start: dolna połowa elipsy → front, górna → back.
			(Math.sin(angle) > 0 ? front : back).appendChild(el);
			this.orbitSparks.push({
				el,
				angle,
				speed: (0.55 + Math.random() * 1.85) * (Math.random() < 0.5 ? 1 : -1),
				rx,
				ry,
				wobble: Math.random() * Math.PI * 2,
				wobbleSpeed: 1.5 + Math.random() * 4,
				fade: Math.random() * Math.PI * 2,
				fadeSpeed: 1.8 + Math.random() * 3.6,
				baseOpacity: 0.45 + Math.random() * 0.55,
			});
		}
		this.updateOrbitSparks(0);
	}

	private updateOrbitSparks(dt: number): void {
		const back = this.root.querySelector<HTMLElement>("[data-crate-orbit-back]");
		const front = this.root.querySelector<HTMLElement>("[data-crate-orbit-front]");
		const cx = 50;
		const cy = 50;
		for (const s of this.orbitSparks) {
			s.angle += s.speed * dt;
			s.wobble += s.wobbleSpeed * dt;
			s.fade += s.fadeSpeed * dt;
			const wobX = Math.sin(s.wobble) * (1.2 + s.rx * 0.035);
			const wobY = Math.cos(s.wobble * 1.37) * (0.9 + s.ry * 0.04);
			const x = cx + Math.cos(s.angle) * s.rx + wobX;
			const y = cy + Math.sin(s.angle) * s.ry + wobY;
			const pulse = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(s.fade));
			const flicker = 0.8 + 0.2 * Math.sin(s.fade * 2.7 + s.wobble);
			const opacity = Math.min(1, s.baseOpacity * pulse * flicker);
			const scale = 0.65 + 0.75 * pulse;
			const depth = Math.sin(s.angle);
			const wantFront = depth > 0.08;
			const host = wantFront ? front : back;
			if (host && s.el.parentElement !== host) host.appendChild(s.el);
			s.el.style.left = `${x}%`;
			s.el.style.top = `${y}%`;
			s.el.style.transform = `translate(-50%, -50%) scale(${scale}) rotate(${s.angle * 48}deg)`;
			s.el.style.opacity = String(opacity * (wantFront ? 0.95 : 0.72));
		}
	}

	private async mountPrizeThumb(opts: { keepHidden?: boolean } = {}): Promise<void> {
		const item = this.item;
		const card = this.root.querySelector("[data-crate-item-card]");
		const thumbHost = this.root.querySelector<HTMLElement>("[data-crate-item-thumb]");
		if (!item || !card || !thumbHost) return;

		const seq = this.thumbSeq;
		const alreadyLoaded = thumbHost.childElementCount > 0 || thumbHost.textContent;
		if (!alreadyLoaded) {
			thumbHost.replaceChildren();
			thumbHost.className = "crate-reveal__item-thumb crate-reveal__item-thumb--prize";
			thumbHost.style.background = "";

			if (item.kind === "car") {
				await mountCarThumbnail(thumbHost, item.itemId, item.paintId, {
					transparent: true,
					large: true,
				});
			} else if (item.kind === "trail" && item.paintId) {
				thumbHost.className =
					"crate-reveal__item-thumb crate-reveal__item-thumb--prize crate-reveal__icon crate-reveal__icon--trail";
				const grad = paintTrailCssGradient(item.paintId);
				thumbHost.style.background = grad ?? "";
				thumbHost.textContent = "✦";
			} else {
				thumbHost.className = `crate-reveal__item-thumb crate-reveal__item-thumb--prize crate-reveal__icon crate-reveal__icon--${item.kind}`;
				thumbHost.textContent = this.kindEmoji(item.kind);
			}
		} else {
			thumbHost.classList.add("crate-reveal__item-thumb--prize");
		}

		if (seq !== this.thumbSeq || !this.visible) return;
		if (opts.keepHidden) return;
		card.classList.remove("hidden");
		card.setAttribute("aria-hidden", "false");
	}

	private updateAnim(dt: number): void {
		if (!this.crateRoot || !this.lidPivot) return;

		if (this.phase === "drop") {
			const t = Math.min(1, this.phaseT / 0.55);
			const ease = 1 - (1 - t) ** 3;
			const bounce = t > 0.82 ? Math.sin((t - 0.82) * 24) * 0.09 * (1 - t) : 0;
			this.crateRoot.position.y = THREE.MathUtils.lerp(2.85, this.crateBaseY, ease) + bounce;
			// Bardzo szybki spin → zwalnianie.
			const spin = THREE.MathUtils.lerp(26, 1.6, ease * ease);
			this.crateRoot.rotation.y += dt * spin;
			this.crateRoot.rotation.z = Math.sin(this.phaseT * 40) * 0.06 * (1 - t);
			const squash = t > 0.88 ? 1 - (t - 0.88) * 0.4 : 1;
			this.crateRoot.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
			if (t >= 1) {
				this.crateRoot.scale.setScalar(1);
				this.crateRoot.rotation.z = 0;
				this.crateRoot.rotation.x = 0;
				this.phase = "suspense";
				this.phaseT = 0;
				this.root.classList.add("crate-reveal--suspense", "crate-reveal--landed");
				this.setHint("crate.suspenseHint");
				this.onPhaseAudio?.("suspense");
				void this.mountPrizeThumb({ keepHidden: true });
			}
		} else if (this.phase === "suspense") {
			// Narastające napięcie: coraz mocniejszy drżący spin.
			const heat = Math.min(1, this.phaseT / 1.55);
			const shake = 0.02 + heat * 0.09;
			this.crateRoot.rotation.y += dt * (0.7 + heat * 2.8);
			this.crateRoot.rotation.z = Math.sin(this.phaseT * (14 + heat * 28)) * shake;
			this.crateRoot.rotation.x = Math.cos(this.phaseT * (11 + heat * 20)) * shake * 0.7;
			this.crateRoot.position.y =
				this.crateBaseY + Math.sin(this.phaseT * (3 + heat * 8)) * (0.03 + heat * 0.06);
			const breathe = 1 + Math.sin(this.phaseT * 6) * 0.025 * heat;
			this.crateRoot.scale.setScalar(breathe);
			this.root.style.setProperty("--crate-tension", String(heat));
			if (this.phaseT >= 1.55) {
				this.crateRoot.rotation.z = 0;
				this.crateRoot.rotation.x = 0;
				this.crateRoot.scale.setScalar(1);
				this.phase = "idle";
				this.phaseT = 0;
				this.root.classList.remove("crate-reveal--suspense");
				this.root.classList.add("crate-reveal--idle");
				this.setHint("crate.clickToOpen");
			}
		} else if (this.phase === "idle") {
			this.crateRoot.rotation.y += dt * 0.85;
			this.crateRoot.position.y =
				this.crateBaseY + Math.sin(this.phaseT * 2.4) * 0.045;
			this.crateRoot.scale.setScalar(1 + Math.sin(this.phaseT * 3.2) * 0.018);
			this.crateRoot.visible = true;
		} else if (this.phase === "charge") {
			const t = Math.min(1, this.phaseT / 0.62);
			const shake = 0.05 + t * 0.14;
			this.crateRoot.rotation.y += dt * (1.2 + t * 5);
			this.crateRoot.rotation.z = Math.sin(this.phaseT * 48) * shake;
			this.crateRoot.rotation.x = Math.cos(this.phaseT * 42) * shake * 0.75;
			this.crateRoot.position.y = this.crateBaseY + Math.sin(this.phaseT * 30) * 0.05;
			this.crateRoot.scale.setScalar(1 + t * 0.22);
			this.root.style.setProperty("--crate-tension", String(0.55 + t * 0.45));
			if (t >= 1) {
				this.finishChargeIntoOpen();
			}
		} else if (this.phase === "open") {
			const t = Math.min(1, this.phaseT / 0.72);
			const lidT = Math.min(1, t / 0.42);
			this.lidPivot.rotation.x = THREE.MathUtils.lerp(0, -1.65, lidT * lidT);
			this.crateRoot.rotation.y += dt * (2.2 + t * 6);
			this.crateRoot.rotation.z = Math.sin(t * 40) * 0.12 * (1 - t);

			if (t < 0.38) {
				const swell = 1 + (t / 0.38) * 0.28;
				this.crateRoot.scale.setScalar(swell);
				this.crateRoot.position.y = this.crateBaseY + t * 0.12;
			} else {
				const boom = (t - 0.38) / 0.62;
				const ease = boom * boom;
				this.crateRoot.scale.setScalar(THREE.MathUtils.lerp(1.28, 0.02, ease));
				this.crateRoot.position.y = this.crateBaseY + boom * 0.35;
				if (boom > 0.55) {
					this.crateRoot.visible = boom < 0.92;
				}
			}

			if (t >= 1) {
				this.enterReveal();
			}
		} else if (this.phase === "reveal") {
			if (this.crateRoot) this.crateRoot.visible = false;
			this.updateOrbitSparks(dt);
		}
	}

	private disposeScene(): void {
		cancelAnimationFrame(this.raf);
		this.clearOrbitSparks();
		if (this.renderer) {
			this.renderer.dispose();
			this.canvasHost.replaceChildren();
		}
		this.renderer = null;
		this.scene = null;
		this.camera = null;
		this.shakeRemain = 0;
		this.shakeAmp = 0;
		this.crateRoot = null;
		this.lidPivot = null;
		this.mirrorRoot = null;
		this.mirrorLidPivot = null;
	}
}
