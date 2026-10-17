/**
 * Trance scanner sheets — szerokie kolorowe „ściany” światła (ASOT / Transmission).
 * Czytelny cyan/magenta bez white-crush; beat punch z pulse.
 */
import * as THREE from "three";

import { PLAYFIELD_SURFACE_Y, RL_ARENA } from "../arenaConstants";

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
uniform float uPulse;
uniform float uScan;
varying vec2 vUv;

void main() {
  float edge = abs(vUv.x - 0.5) * 2.0;
  float blade = pow(1.0 - clamp(edge / 0.55, 0.0, 1.0), 1.8);
  float along = smoothstep(0.0, 0.08, vUv.y) * smoothstep(1.0, 0.75, vUv.y);
  float scan = fract(vUv.y * 3.0 - uTime * (2.5 + uScan) + uPulse);
  float band = smoothstep(0.0, 0.12, scan) * smoothstep(0.55, 0.2, scan);
  float alpha = uOpacity * blade * along * mix(0.65, 1.25, band) * (0.85 + uPulse * 0.4);
  if (alpha < 0.01) discard;
  /** Czysty hue — zero white add. */
  vec3 col = uColor * (0.7 + blade * 0.55 + band * 0.35);
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.92));
}
`;

type Sheet = {
	mesh: THREE.Mesh;
	mat: THREE.ShaderMaterial;
	baseYaw: number;
	phase: number;
	cyan: boolean;
};

export class StadiumTranceScanners {
	readonly root = new THREE.Group();
	private readonly sheets: Sheet[] = [];
	private readonly geo: THREE.PlaneGeometry;

	constructor() {
		this.root.name = "stadiumTranceScanners";
		this.geo = new THREE.PlaneGeometry(1, 1, 1, 1);
		const hw = RL_ARENA.HALF_WIDTH;
		const hl = RL_ARENA.HALF_LENGTH;
		const specs: { x: number; z: number; yaw: number; cyan: boolean }[] = [
			{ x: -hw * 0.92, z: 0, yaw: Math.PI * 0.5, cyan: true },
			{ x: hw * 0.92, z: 0, yaw: -Math.PI * 0.5, cyan: false },
			{ x: 0, z: -hl * 0.95, yaw: 0, cyan: true },
			{ x: 0, z: hl * 0.95, yaw: Math.PI, cyan: false },
		];
		for (let i = 0; i < specs.length; i++) {
			const s = specs[i]!;
			const mat = new THREE.ShaderMaterial({
				uniforms: {
					uColor: {
						value: s.cyan
							? new THREE.Color(0.05, 1.35, 1.55)
							: new THREE.Color(1.55, 0.05, 1.25),
					},
					uOpacity: { value: 0 },
					uTime: { value: 0 },
					uPulse: { value: 0 },
					uScan: { value: 0.5 + i * 0.2 },
				},
				vertexShader: VERT,
				fragmentShader: FRAG,
				transparent: true,
				depthWrite: false,
				depthTest: false,
				blending: THREE.AdditiveBlending,
				side: THREE.DoubleSide,
				toneMapped: false,
			});
			const mesh = new THREE.Mesh(this.geo, mat);
			mesh.position.set(s.x, PLAYFIELD_SURFACE_Y + 10, s.z);
			mesh.frustumCulled = false;
			mesh.renderOrder = 26;
			mesh.visible = false;
			this.root.add(mesh);
			this.sheets.push({
				mesh,
				mat,
				baseYaw: s.yaw,
				phase: i * 1.1,
				cyan: s.cyan,
			});
		}
	}

	update(t: number, showU: number, pulse: number): void {
		/**
		 * Build → liquid: rosnące ściany; DROP: pełne pierdolnięcie;
		 * celebration: puls; settle: fade.
		 */
		const build = THREE.MathUtils.smoothstep(showU, 0.1, 0.28);
		const liquid = THREE.MathUtils.smoothstep(showU, 0.28, 0.48);
		const drop =
			THREE.MathUtils.smoothstep(showU, 0.48, 0.55) *
			(1 - THREE.MathUtils.smoothstep(showU, 0.72, 0.88));
		const celeb =
			THREE.MathUtils.smoothstep(showU, 0.68, 0.75) *
			(1 - THREE.MathUtils.smoothstep(showU, 0.88, 0.98));
		const presence = Math.max(build * 0.7, liquid * 1.0, drop * 1.45, celeb * 0.95);
		const kick = pulse * pulse; // hard trance punch

		for (let i = 0; i < this.sheets.length; i++) {
			const s = this.sheets[i]!;
			const g = t * (0.55 + kick * 1.8) + s.phase;
			const nod = Math.sin(g) * 0.22 + Math.sin(g * 2.3) * 0.08;
			s.mesh.rotation.set(nod * 0.35, s.baseYaw + Math.sin(g * 0.7) * 0.12, 0);
			const span = 26 + liquid * 12 + drop * 18 + kick * 8;
			const tall = 18 + drop * 8;
			s.mesh.scale.set(span * 0.15, tall, 1);
			const op =
				presence *
				(0.32 + kick * 0.45 + (s.cyan ? liquid * 0.14 : drop * 0.18));
			s.mat.uniforms.uOpacity!.value = Math.min(0.95, op);
			s.mat.uniforms.uTime!.value = t;
			s.mat.uniforms.uPulse!.value = pulse;
			s.mesh.visible = op > 0.03;
			/** DROP: gold lean on magenta side for impact. */
			if (drop > 0.4 && !s.cyan) {
				(s.mat.uniforms.uColor!.value as THREE.Color).setRGB(1.7, 0.85, 0.1);
			} else if (s.cyan) {
				(s.mat.uniforms.uColor!.value as THREE.Color).setRGB(0.05, 1.35, 1.55);
			} else {
				(s.mat.uniforms.uColor!.value as THREE.Color).setRGB(1.55, 0.05, 1.25);
			}
		}
	}

	dispose(): void {
		for (const s of this.sheets) {
			s.mat.dispose();
			s.mesh.removeFromParent();
		}
		this.geo.dispose();
		this.root.removeFromParent();
	}
}
