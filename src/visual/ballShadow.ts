import * as THREE from "three";

/** RL-style „fake shadow” pod piłką — pozycja lądowania na murawie. */
export class BallShadow {
	readonly mesh: THREE.Mesh;
	private readonly baseRadius: number;

	constructor(ballRadius: number) {
		this.baseRadius = ballRadius * 1.12;

		const tex = buildShadowTexture();
		const mat = new THREE.MeshBasicMaterial({
			map: tex,
			transparent: true,
			opacity: 0.72,
			depthWrite: false,
		});

		this.mesh = new THREE.Mesh(
			new THREE.CircleGeometry(this.baseRadius, 40),
			mat,
		);
		this.mesh.rotation.x = -Math.PI / 2;
		this.mesh.renderOrder = 3;
		this.mesh.frustumCulled = false;
	}

	update(ballPos: THREE.Vector3, floorY = 0.055): void {
		this.mesh.position.set(ballPos.x, floorY, ballPos.z);

		const height = Math.max(0, ballPos.y - floorY);
		const t = THREE.MathUtils.clamp(height / 18, 0, 1);
		const scale = THREE.MathUtils.lerp(1, 0.55, t ** 0.85);
		const opacity = THREE.MathUtils.lerp(0.68, 0.22, t ** 1.1);

		this.mesh.scale.set(scale, scale, 1);
		(this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
	}
}

function buildShadowTexture(): THREE.CanvasTexture {
	const size = 128;
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Canvas 2D unavailable");

	const g = ctx.createRadialGradient(
		size / 2,
		size / 2,
		0,
		size / 2,
		size / 2,
		size / 2,
	);
	g.addColorStop(0, "rgba(0,0,0,0.78)");
	g.addColorStop(0.42, "rgba(0,0,0,0.42)");
	g.addColorStop(1, "rgba(0,0,0,0)");
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, size, size);

	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.SRGBColorSpace;
	return tex;
}
