import * as THREE from "three";

import { getDecalEntry, getTrailEntry } from "../meta/CosmeticCatalog";
import { getPaintEntry } from "../meta/PaintCatalog";
import {
	getEquippedDecalId,
	getEquippedGoalExplosionId,
	getEquippedPaintId,
	getEquippedTrailId,
	getEquippedWheelId,
} from "../meta/PlayerInventory";

function parseHex(hex: string): number {
	const n = Number.parseInt(hex.replace(/^0x/i, ""), 16);
	return Number.isFinite(n) ? n : 0xffffff;
}

function paintColors(paintId: string | null): {
	body: number;
	accent: number;
} | null {
	if (!paintId) return null;
	const entry = getPaintEntry(paintId);
	if (!entry) return null;
	return {
		body: parseHex(entry.hex),
		accent: parseHex(entry.accentHex),
	};
}

const TEAM_ACCENT = {
	blue: 0x1ec8ee,
	orange: 0xff5522,
} as const;

/** Malowanie karoserii — paint hex na panelach, team zostaje na drobnych akcentach. */
export function applyPaintToCar(
	root: THREE.Object3D,
	paintId: string | null,
	team: "blue" | "orange" = "blue",
): void {
	const colors = paintColors(paintId);
	if (!colors) return;

	root.traverse((obj) => {
		if (!(obj instanceof THREE.Mesh)) return;
		const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
		for (const mat of mats) {
			if (!(mat instanceof THREE.MeshStandardMaterial)) continue;
			const label = `${mat.name}|${obj.name}`.toLowerCase();
			if (label.includes("dark") || label.includes("inset")) {
				mat.color.setHex(colors.accent);
				mat.emissive.setHex(colors.accent).multiplyScalar(0.04);
			} else if (
				label.includes("paint") ||
				label.includes("body") ||
				label.includes("hood") ||
				label.includes("cabin") ||
				label.includes("spoiler") ||
				label.includes("scoop") ||
				label.includes("fender") ||
				label.includes("pylon") ||
				obj.name === "body"
			) {
				mat.color.setHex(colors.body);
				mat.emissive.setHex(colors.body);
				mat.emissiveIntensity = 0.1;
				mat.metalness = Math.min(mat.metalness, 0.32);
				mat.roughness = Math.max(mat.roughness, 0.4);
				mat.envMapIntensity = Math.max(mat.envMapIntensity || 1, 1.2);
				if (mat instanceof THREE.MeshPhysicalMaterial) {
					mat.iridescence = 0;
					mat.transmission = 0;
				}
			}
		}
	});

	const accents = root.getObjectByName("teamAccents");
	if (accents) {
		accents.traverse((obj) => {
			if (!(obj instanceof THREE.Mesh)) return;
			const mat = obj.material;
			if (!(mat instanceof THREE.MeshStandardMaterial)) return;
			const teamColor = TEAM_ACCENT[team];
			mat.color.setHex(teamColor);
			mat.emissive.setHex(teamColor);
		});
	}
}

/** Gradient smugi z hue malowania. */
export function applyPaintToTrailColors(
	paintId: string | null,
	baseTrailId?: string,
): {
	head: THREE.Color;
	core: THREE.Color;
	mid: THREE.Color;
	tail: THREE.Color;
} {
	const trailId = baseTrailId ?? getEquippedTrailId();
	const entry = getTrailEntry(trailId);
	const head = new THREE.Color();
	const core = new THREE.Color();
	const mid = new THREE.Color();
	const tail = new THREE.Color();

	if (entry?.colors) {
		head.set(parseHex(entry.colors.head));
		core.set(parseHex(entry.colors.core));
		mid.set(parseHex(entry.colors.mid));
		tail.set(parseHex(entry.colors.tail));
	} else {
		head.set(0xb8ffff);
		core.set(0xffeeaa);
		mid.set(0xff7722);
		tail.set(0xcc4499);
	}

	const colors = paintColors(paintId ?? getEquippedPaintId("trail"));
	if (!colors) {
		return { head, core, mid, tail };
	}

	const paint = new THREE.Color(colors.body);
	const hsl = { h: 0, s: 0, l: 0 };
	paint.getHSL(hsl);

	const shift = (c: THREE.Color, dh: number, dl: number) => {
		const h = { h: 0, s: 0, l: 0 };
		c.getHSL(h);
		c.setHSL((h.h + dh + 1) % 1, Math.min(1, h.s * 1.05), THREE.MathUtils.clamp(h.l + dl, 0.08, 0.92));
	};

	head.set(paint);
	shift(head, 0.02, 0.18);
	core.copy(paint);
	mid.copy(paint);
	shift(mid, -0.04, -0.12);
	tail.copy(paint);
	shift(tail, -0.08, -0.22);

	return { head, core, mid, tail };
}

export function applyPaintToWheel(
	root: THREE.Object3D,
	wheelId?: string,
	paintId?: string | null,
): void {
	const id = wheelId ?? getEquippedWheelId();
	if (id === "default") return;
	const colors = paintColors(paintId ?? getEquippedPaintId("wheel"));
	const tint = colors?.body ?? 0xcccccc;

	root.traverse((node) => {
		const n = node.name.toLowerCase();
		if (!n.includes("wheel") && !n.includes("rim")) return;
		if (!(node instanceof THREE.Mesh)) return;
		const mats = Array.isArray(node.material) ? node.material : [node.material];
		for (const mat of mats) {
			if (!(mat instanceof THREE.MeshStandardMaterial)) continue;
			mat.color.setHex(tint);
			mat.emissive.setHex(tint);
			mat.emissiveIntensity = colors ? 0.55 : 0.12;
		}
	});
}

export function applyPaintToTopper(
	root: THREE.Object3D,
	_topperId?: string,
	paintId?: string | null,
): void {
	const topper = root.getObjectByName("cosmetic_topper");
	if (!topper) return;
	const colors = paintColors(paintId ?? getEquippedPaintId("topper"));
	if (!colors) return;

	topper.traverse((node) => {
		if (!(node instanceof THREE.Mesh)) return;
		const mat = node.material;
		if (!(mat instanceof THREE.MeshStandardMaterial)) return;
		mat.color.setHex(colors.body);
		mat.emissive.setHex(colors.body);
		mat.emissiveIntensity = 0.75;
	});
}

export function applyPaintToDecal(
	root: THREE.Object3D,
	decalId?: string,
	paintId?: string | null,
): void {
	const id = decalId ?? getEquippedDecalId();
	const entry = getDecalEntry(id);
	if (!entry?.tint) return;
	const colors = paintColors(paintId ?? getEquippedPaintId("decal"));

	root.traverse((node) => {
		if (!(node instanceof THREE.Mesh)) return;
		if (!node.name.toLowerCase().includes("body")) return;
		const mats = Array.isArray(node.material) ? node.material : [node.material];
		for (const mat of mats) {
			if (!(mat instanceof THREE.MeshStandardMaterial)) continue;
			if (colors) {
				const c = new THREE.Color(colors.body);
				mat.emissive.copy(c);
				mat.emissiveIntensity = entry.emissive * 1.15;
			}
		}
	});
}

/** Przesunięcie hue bloom/flash goal FX. */
export function getGoalExplosionPaintHueShift(
	paintId?: string | null,
): number {
	const pid = paintId ?? getEquippedPaintId("goalExplosion");
	const colors = paintColors(pid);
	if (!colors) return 0;
	const c = new THREE.Color(colors.body);
	const hsl = { h: 0, s: 0, l: 0 };
	c.getHSL(hsl);
	return hsl.h * Math.PI * 2;
}

export function getGoalExplosionPresetId(): string {
	return getEquippedGoalExplosionId();
}

/** CSS hex dla UI swatch (#rrggbb). */
export function paintCssHex(paintId: string | null): string | null {
	const colors = paintColors(paintId);
	if (!colors) return null;
	return `#${colors.body.toString(16).padStart(6, "0")}`;
}

/** Gradient CSS dla trail w UI. */
export function paintTrailCssGradient(paintId: string | null): string | null {
	const hex = paintCssHex(paintId);
	if (!hex) return null;
	return `linear-gradient(135deg, ${hex}, ${hex}88)`;
}
