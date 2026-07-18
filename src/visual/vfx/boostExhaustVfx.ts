import * as THREE from "three";

import type { ScoringTeam } from "../../game/modes";
import type Player from "../../util/Player";
import { CAR_NEON_CYAN } from "../carPanelMaterial";
import {
	createSoftTrailMaterial,
	setSoftTrailColors,
} from "./softTrailMaterial";

const EXHAUST_SOCKETS = ["exhaust_L", "exhaust_C", "exhaust_R"] as const;

const TEAM_PALETTE = {
	blue: {
		hot: new THREE.Color(0xa8f8ff),
		mid: new THREE.Color(0x22d4ff),
		tail: new THREE.Color(0x0a4a9e),
		light: 0x55eeff,
	},
	orange: {
		hot: new THREE.Color(0xfff0aa),
		mid: new THREE.Color(0xff7722),
		tail: new THREE.Color(0x991400),
		light: 0xffaa44,
	},
} as const;

type JetSlot = {
	root: THREE.Group;
	jet: THREE.Mesh;
	material: THREE.ShaderMaterial;
};

/**
 * Poziomy strumień wydechu — płaszczyzny w osi auta (local −Z), bez billboardów.
 */
export class BoostExhaustVfx {
	private readonly visualRoot: THREE.Object3D;
	private readonly jets: JetSlot[] = [];
	private readonly rearLight: THREE.PointLight;
	private readonly palette: (typeof TEAM_PALETTE)[ScoringTeam];
	private readonly jetGeo: THREE.PlaneGeometry;
	private boostSmoothed = 0;
	private pulse = 0;

	constructor(
		visualRoot: THREE.Object3D,
		_scene: THREE.Scene,
		team: ScoringTeam,
	) {
		this.visualRoot = visualRoot;
		this.palette = TEAM_PALETTE[team];
		this.jetGeo = new THREE.PlaneGeometry(1, 1);

		for (const socketName of EXHAUST_SOCKETS) {
			const root = new THREE.Group();
			root.name = `boostJet_${socketName}`;

			const material = createSoftTrailMaterial(2.05);
			setSoftTrailColors(material, this.palette.hot, this.palette.tail, 0);

			const jet = new THREE.Mesh(this.jetGeo, material);
			jet.rotation.x = -Math.PI / 2;
			jet.position.y = -0.04;
			jet.position.z = -0.38;
			jet.frustumCulled = false;
			jet.renderOrder = 18;

			root.add(jet);

			const socket = visualRoot.getObjectByName(socketName);
			if (socket) {
				socket.add(root);
			} else {
				const fallbackZ = socketName === "exhaust_C" ? -0.52 : -0.48;
				const fallbackX =
					socketName === "exhaust_L"
						? -0.22
						: socketName === "exhaust_R"
							? 0.22
							: 0;
				root.position.set(fallbackX, 0.08, fallbackZ);
				visualRoot.add(root);
			}

			this.jets.push({ root, jet, material });
		}

		this.rearLight = new THREE.PointLight(this.palette.light, 0, 9, 2);
		this.rearLight.position.set(0, 0.14, -0.55);
		this.rearLight.castShadow = false;
		visualRoot.add(this.rearLight);
	}

	update(player: Player, boosting: boolean, dt: number): void {
		const target = boosting ? 1 : 0;
		this.boostSmoothed = THREE.MathUtils.damp(
			this.boostSmoothed,
			target,
			14,
			dt,
		);
		this.pulse = THREE.MathUtils.damp(this.pulse, boosting ? 1 : 0, 10, dt);

		const speed = player.getVelocity().length();
		const airborne = !player.isOnGround();
		const intensity =
			this.boostSmoothed * (0.6 + Math.min(1, speed / 24) * 0.4);
		const active = intensity > 0.02;

		const jetLen = (airborne ? 1.35 : 1.05) + speed * 0.055 + this.pulse * 0.45;
		const jetWidth = 0.28 + this.pulse * 0.1;
		const opacity =
			intensity * (airborne ? 0.95 : 0.78) * (0.78 + this.pulse * 0.22);

		for (const slot of this.jets) {
			slot.root.visible = active;
			slot.jet.scale.set(jetWidth, jetLen, 1);
			setSoftTrailColors(
				slot.material,
				this.palette.hot,
				this.palette.tail,
				opacity,
			);
		}

		this.rearLight.intensity = active
			? 2.2 + this.pulse * 2.6 + speed * 0.07
			: 0;

		const underglow = this.visualRoot.getObjectByName("underglowLight") as
			| THREE.SpotLight
			| undefined;
		if (underglow) {
			if (active) {
				underglow.intensity = 2.4 + this.pulse * 5.5;
				underglow.color.setHex(this.palette.light);
			} else {
				underglow.intensity = 2.4;
				underglow.color.setHex(CAR_NEON_CYAN);
			}
		}
	}

	dispose(): void {
		this.rearLight.removeFromParent();
		this.rearLight.dispose();

		for (const slot of this.jets) {
			slot.material.dispose();
			slot.root.removeFromParent();
		}
		this.jetGeo.dispose();
	}
}
