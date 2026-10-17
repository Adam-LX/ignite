import * as THREE from "three";

const MAX_POINTS = 48;
const STEP = 0.12;
const LIFE = 0.72;
const HALF_W = 0.32;

const VERT = /* glsl */ `
attribute float aFade;
attribute float aSide;
varying float vFade;
varying float vSide;
void main() {
  vFade = aFade;
  vSide = aSide;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vFade;
varying float vSide;
void main() {
  /** Soft edge + silny zanik wzdłuż (dalej od wozu → przezroczyste). */
  float edge = 1.0 - abs(vSide);
  float soft = smoothstep(0.0, 1.0, edge);
  soft = pow(soft, 1.65);
  float along = pow(clamp(vFade, 0.0, 1.0), 2.15);
  float alpha = uOpacity * soft * along;
  if (alpha < 0.012) discard;
  vec3 tip = uColor * 1.2;
  vec3 tail = mix(uColor, vec3(0.45, 0.55, 1.0), 0.55) * 0.25;
  vec3 col = mix(tail, tip, along * soft);
  gl_FragColor = vec4(col, alpha);
}
`;

type Point = { pos: THREE.Vector3; born: number };

/**
 * Freestyle / aerial trail — camera-facing wstęga z gradientem zaniku.
 */
export class FreestyleTrailVfx {
	private readonly root = new THREE.Group();
	private readonly mesh: THREE.Mesh;
	private readonly mat: THREE.ShaderMaterial;
	private readonly positions: Float32Array;
	private readonly fades: Float32Array;
	private readonly sides: Float32Array;
	private readonly points: Point[] = [];
	private acc = 0;
	private clock = 0;
	private readonly _along = new THREE.Vector3();
	private readonly _side = new THREE.Vector3();
	private readonly _toCam = new THREE.Vector3();
	private readonly _worldUp = new THREE.Vector3(0, 1, 0);

	constructor(scene: THREE.Scene) {
		this.root.name = "freestyleTrail";
		scene.add(this.root);
		const maxVerts = MAX_POINTS * 2;
		this.positions = new Float32Array(maxVerts * 3);
		this.fades = new Float32Array(maxVerts);
		this.sides = new Float32Array(maxVerts);
		const geo = new THREE.BufferGeometry();
		geo.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
		geo.setAttribute("aFade", new THREE.BufferAttribute(this.fades, 1));
		geo.setAttribute("aSide", new THREE.BufferAttribute(this.sides, 1));
		this.mat = new THREE.ShaderMaterial({
			uniforms: {
				uColor: { value: new THREE.Color(0x7af0ff) },
				uOpacity: { value: 0.4 },
			},
			vertexShader: VERT,
			fragmentShader: FRAG,
			transparent: true,
			depthWrite: false,
			depthTest: true,
			blending: THREE.AdditiveBlending,
			side: THREE.DoubleSide,
			toneMapped: false,
		});
		this.mesh = new THREE.Mesh(geo, this.mat);
		this.mesh.frustumCulled = false;
		this.mesh.visible = false;
		this.mesh.renderOrder = 11;
		this.root.add(this.mesh);
	}

	update(
		worldPos: THREE.Vector3,
		_carRight: THREE.Vector3,
		airborne: boolean,
		boosting: boolean,
		speed: number,
		dt: number,
		roll = 0,
		camera?: THREE.Camera,
	): void {
		this.clock += dt;
		while (this.points.length && this.clock - this.points[0]!.born > LIFE) {
			this.points.shift();
		}

		const rolling = Math.abs(roll) > 0.22;
		const want =
			airborne &&
			worldPos.y > 1.15 &&
			speed > 5.5 &&
			((!boosting && speed > 6.5) || rolling);
		if (want) {
			this.acc += dt;
			if (this.acc >= STEP) {
				this.acc = 0;
				this.points.push({ pos: worldPos.clone(), born: this.clock });
				if (this.points.length > MAX_POINTS) this.points.shift();
			}
		} else {
			this.acc = 0;
		}

		if (this.points.length < 2) {
			this.mesh.visible = false;
			return;
		}
		this.mesh.visible = true;
		this.mat.uniforms.uColor!.value.set(rolling ? 0xffc878 : 0x7af0ff);
		this.mat.uniforms.uOpacity!.value = rolling ? 0.32 : 0.26;
		if (camera) camera.updateMatrixWorld();

		const n = this.points.length;
		let vi = 0;
		for (let i = 0; i < n; i++) {
			const p = this.points[i]!;
			const age = this.clock - p.born;
			/** 1 przy aucie (świeży), 0 na końcu smugi. */
			const fade = THREE.MathUtils.clamp(1 - age / LIFE, 0, 1);
			/** Szerokość też maleje z daleka. */
			/** Ogon węższy — wstęga „znika” z daleka, nie ucina się jak karta. */
			const halfW =
				HALF_W * (0.08 + 0.92 * fade * fade) * (rolling ? 1.12 : 1);

			if (i === 0) this._along.subVectors(this.points[1]!.pos, p.pos);
			else if (i === n - 1)
				this._along.subVectors(p.pos, this.points[i - 1]!.pos);
			else
				this._along.subVectors(
					this.points[i + 1]!.pos,
					this.points[i - 1]!.pos,
				);
			if (this._along.lengthSq() < 1e-8) this._along.set(0, 0, 1);
			else this._along.normalize();

			if (camera) {
				this._toCam.copy(camera.position).sub(p.pos);
				this._side.crossVectors(this._along, this._toCam);
				if (this._side.lengthSq() < 1e-8) {
					this._side
						.setFromMatrixColumn(camera.matrixWorld, 0)
						.cross(this._along);
				}
			} else {
				this._side.crossVectors(this._along, this._worldUp);
			}
			if (this._side.lengthSq() < 1e-8) this._side.set(1, 0, 0);
			this._side.normalize().multiplyScalar(halfW);

			for (const side of [-1, 1] as const) {
				this.positions[vi * 3] = p.pos.x + this._side.x * side;
				this.positions[vi * 3 + 1] = p.pos.y + this._side.y * side;
				this.positions[vi * 3 + 2] = p.pos.z + this._side.z * side;
				this.fades[vi] = fade;
				this.sides[vi] = side;
				vi++;
			}
		}

		const idx: number[] = [];
		for (let i = 0; i < n - 1; i++) {
			const a = i * 2;
			idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
		}
		this.mesh.geometry.setIndex(idx);
		this.mesh.geometry.setDrawRange(0, idx.length);
		(
			this.mesh.geometry.getAttribute("position") as THREE.BufferAttribute
		).needsUpdate = true;
		(
			this.mesh.geometry.getAttribute("aFade") as THREE.BufferAttribute
		).needsUpdate = true;
		(
			this.mesh.geometry.getAttribute("aSide") as THREE.BufferAttribute
		).needsUpdate = true;
		this.mesh.geometry.computeBoundingSphere();
	}

	dispose(): void {
		this.mesh.geometry.dispose();
		this.mat.dispose();
		this.root.removeFromParent();
	}
}
