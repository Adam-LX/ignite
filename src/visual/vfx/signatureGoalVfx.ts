import * as THREE from "three";

/**
 * Ignite Signature — unikalny burst przy stylowym golu (aerial / flip / air-roll).
 * Nie ma w RL: podwójna helisa + ignite chevron flash.
 */
export class SignatureGoalVfx {
	private readonly root = new THREE.Group();
	private readonly helixA: THREE.Mesh;
	private readonly helixB: THREE.Mesh;
	private readonly chevron: THREE.Mesh;
	private life = 0;

	constructor(scene: THREE.Scene) {
		this.root.name = "signatureGoalVfx";
		scene.add(this.root);

		const tubeMat = (color: number) =>
			new THREE.MeshBasicMaterial({
				color,
				transparent: true,
				opacity: 0,
				depthWrite: false,
				blending: THREE.AdditiveBlending,
				toneMapped: false,
			});

		const helixPts = (phase: number): THREE.Vector3[] => {
			const pts: THREE.Vector3[] = [];
			for (let i = 0; i < 48; i++) {
				const t = i / 47;
				const a = t * Math.PI * 5 + phase;
				const r = 0.35 + t * 2.8;
				pts.push(
					new THREE.Vector3(Math.cos(a) * r, t * 4.2, Math.sin(a) * r),
				);
			}
			return pts;
		};

		this.helixA = new THREE.Mesh(
			new THREE.TubeGeometry(
				new THREE.CatmullRomCurve3(helixPts(0)),
				48,
				0.07,
				5,
				false,
			),
			tubeMat(0xff9a3a),
		);
		this.helixB = new THREE.Mesh(
			new THREE.TubeGeometry(
				new THREE.CatmullRomCurve3(helixPts(Math.PI)),
				48,
				0.055,
				5,
				false,
			),
			tubeMat(0x55e8ff),
		);

		const chevronGeo = new THREE.BufferGeometry();
		const c = new Float32Array([
			0, 2.2, 0, -1.4, 0.4, 0, -0.55, 0.4, 0, 0, 1.15, 0, 0.55, 0.4, 0, 1.4,
			0.4, 0,
		]);
		chevronGeo.setAttribute("position", new THREE.BufferAttribute(c, 3));
		chevronGeo.setIndex([0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5]);
		this.chevron = new THREE.Mesh(
			chevronGeo,
			new THREE.MeshBasicMaterial({
				color: 0xffc878,
				transparent: true,
				opacity: 0,
				depthWrite: false,
				blending: THREE.AdditiveBlending,
				side: THREE.DoubleSide,
				toneMapped: false,
			}),
		);

		this.root.add(this.helixA, this.helixB, this.chevron);
		this.root.visible = false;
	}

	trigger(worldPos: THREE.Vector3, team: "blue" | "orange"): void {
		this.root.position.copy(worldPos);
		this.root.position.y += 0.6;
		this.root.visible = true;
		this.life = 1.55;
		const hot = team === "blue" ? 0x7ec8ff : 0xffb060;
		(this.helixA.material as THREE.MeshBasicMaterial).color.set(hot);
		(this.helixB.material as THREE.MeshBasicMaterial).color.set(0xffe080);
		(this.chevron.material as THREE.MeshBasicMaterial).color.set(0xfff0c8);
		this.helixA.scale.setScalar(0.25);
		this.helixB.scale.setScalar(0.25);
		this.chevron.scale.setScalar(0.4);
	}

	update(dt: number): void {
		if (this.life <= 0) {
			this.root.visible = false;
			return;
		}
		this.life -= dt;
		const t = 1 - this.life / 1.55;
		const fade = (1 - t) ** 1.25;
		this.helixA.rotation.y += dt * 2.8;
		this.helixB.rotation.y -= dt * 3.2;
		this.chevron.rotation.y += dt * 1.4;
		this.helixA.scale.setScalar(0.25 + t * 2.6);
		this.helixB.scale.setScalar(0.25 + t * 2.9);
		this.chevron.scale.setScalar(0.4 + t * 3.4);
		this.chevron.position.y = 1.2 + t * 2.8;
		(this.helixA.material as THREE.MeshBasicMaterial).opacity = 0.85 * fade;
		(this.helixB.material as THREE.MeshBasicMaterial).opacity = 0.7 * fade;
		(this.chevron.material as THREE.MeshBasicMaterial).opacity = 0.95 * fade;
	}

	dispose(): void {
		this.helixA.geometry.dispose();
		(this.helixA.material as THREE.Material).dispose();
		this.helixB.geometry.dispose();
		(this.helixB.material as THREE.Material).dispose();
		this.chevron.geometry.dispose();
		(this.chevron.material as THREE.Material).dispose();
		this.root.removeFromParent();
	}
}
