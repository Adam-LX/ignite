import type { BotDrive } from "../BotBehavior";

export const POLICY_INPUT_SIZE = 21;
export const POLICY_HIDDEN_SIZE = 32;
export const POLICY_OUTPUT_SIZE = 12;
/** Wcześniejsze wersje wag — migracja w fromData(). */
export const POLICY_LEGACY_INPUT_SIZES = [18] as const;
export const POLICY_LEGACY_OUTPUT_SIZES = [4, 8] as const;

export type BotPolicyData = {
	version: 1;
	generation: number;
	fitness: number;
	w1: number[];
	b1: number[];
	w2: number[];
	b2: number[];
};

const _hidden = new Array<number>(POLICY_HIDDEN_SIZE);

function tanh(x: number): number {
	return Math.tanh(x);
}

function sigmoid(x: number): number {
	return 1 / (1 + Math.exp(-x));
}

function inferLegacyInputSize(data: BotPolicyData, hiddenSize: number): number {
	if (hiddenSize <= 0) return POLICY_INPUT_SIZE;
	const fromW1 = Math.floor(data.w1.length / hiddenSize);
	if ((POLICY_LEGACY_INPUT_SIZES as readonly number[]).includes(fromW1)) {
		return fromW1;
	}
	return Math.min(fromW1, POLICY_INPUT_SIZE);
}

function migratePolicyWeights(policy: BotPolicy, data: BotPolicyData): void {
	const { w1, b1, w2, b2 } = policy.weights;
	const oldHidden = data.b1.length;
	const oldOutputs = data.b2.length;
	const oldInputSize = inferLegacyInputSize(data, oldHidden);

	for (let h = 0; h < Math.min(oldHidden, POLICY_HIDDEN_SIZE); h++) {
		for (let i = 0; i < POLICY_INPUT_SIZE; i++) {
			if (i < oldInputSize) {
				w1[h * POLICY_INPUT_SIZE + i] = data.w1[h * oldInputSize + i] ?? 0;
			} else {
				w1[h * POLICY_INPUT_SIZE + i] = 0;
			}
		}
	}

	for (let h = 0; h < POLICY_HIDDEN_SIZE; h++) {
		b1[h] = h < oldHidden ? (data.b1[h] ?? 0) : 0;
	}

	for (let o = 0; o < POLICY_OUTPUT_SIZE; o++) {
		for (let h = 0; h < POLICY_HIDDEN_SIZE; h++) {
			const dst = o * POLICY_HIDDEN_SIZE + h;
			if (o < oldOutputs && h < oldHidden) {
				w2[dst] = data.w2[o * oldHidden + h] ?? 0;
			} else {
				w2[dst] = 0;
			}
		}
		b2[o] = o < oldOutputs ? (data.b2[o] ?? 0) : 0;
	}
}

export class BotPolicy {
	generation = 0;
	fitness = 0;

	private readonly w1: Float32Array;
	private readonly b1: Float32Array;
	private readonly w2: Float32Array;
	private readonly b2: Float32Array;

	constructor(seed?: number) {
		this.w1 = new Float32Array(POLICY_INPUT_SIZE * POLICY_HIDDEN_SIZE);
		this.b1 = new Float32Array(POLICY_HIDDEN_SIZE);
		this.w2 = new Float32Array(POLICY_HIDDEN_SIZE * POLICY_OUTPUT_SIZE);
		this.b2 = new Float32Array(POLICY_OUTPUT_SIZE);
		if (seed !== undefined) {
			this.randomize(seed);
		} else {
			this.randomize(Date.now() % 1_000_000);
		}
	}

	static fromData(data: BotPolicyData): BotPolicy {
		const policy = new BotPolicy(42);
		policy.generation = data.generation;
		policy.fitness = data.fitness;

		const needsMigration =
			data.b1.length !== POLICY_HIDDEN_SIZE ||
			data.b2.length !== POLICY_OUTPUT_SIZE ||
			data.w1.length !== POLICY_INPUT_SIZE * POLICY_HIDDEN_SIZE;

		if (needsMigration) {
			migratePolicyWeights(policy, data);
		} else {
			policy.w1.set(data.w1);
			policy.b1.set(data.b1);
			policy.w2.set(data.w2);
			policy.b2.set(data.b2);
		}
		return policy;
	}

	toData(): BotPolicyData {
		return {
			version: 1,
			generation: this.generation,
			fitness: this.fitness,
			w1: [...this.w1],
			b1: [...this.b1],
			w2: [...this.w2],
			b2: [...this.b2],
		};
	}

	clone(): BotPolicy {
		const copy = BotPolicy.fromData(this.toData());
		return copy;
	}

	predict(
		obs: Float32Array | number[],
		out = new Float32Array(POLICY_OUTPUT_SIZE),
	): Float32Array {
		for (let h = 0; h < POLICY_HIDDEN_SIZE; h++) {
			let sum = this.b1[h]!;
			const row = h * POLICY_INPUT_SIZE;
			for (let i = 0; i < POLICY_INPUT_SIZE; i++) {
				sum += obs[i]! * this.w1[row + i]!;
			}
			_hidden[h] = tanh(sum);
		}

		for (let o = 0; o < POLICY_OUTPUT_SIZE; o++) {
			let sum = this.b2[o]!;
			const row = o * POLICY_HIDDEN_SIZE;
			for (let h = 0; h < POLICY_HIDDEN_SIZE; h++) {
				sum += _hidden[h]! * this.w2[row + h]!;
			}
			out[o] = tanh(sum);
		}
		return out;
	}

	driveFromOutputs(outputs: Float32Array): BotDrive {
		const forwardRaw = outputs[4] ?? outputs[0] ?? 0;
		const yawRaw = outputs[5] ?? outputs[1] ?? 0;
		const boostRaw = outputs[2] ?? 0;
		const jumpRaw = outputs[3] ?? 0;

		return {
			forward: forwardRaw > 0.12 ? 1 : forwardRaw < -0.12 ? -1 : 0,
			yaw: yawRaw > 0.12 ? 1 : yawRaw < -0.12 ? -1 : 0,
			forwardAxis: forwardRaw,
			yawAxis: yawRaw,
			boost: sigmoid(boostRaw) > 0.48,
			jump: sigmoid(jumpRaw) > 0.52,
		};
	}

	predictDrive(obs: Float32Array | number[]): BotDrive {
		return this.driveFromOutputs(this.predict(obs));
	}

	mutate(rate: number, rng = Math.random): void {
		const jitter = (w: Float32Array) => {
			for (let i = 0; i < w.length; i++) {
				if (rng() < rate) {
					w[i] = w[i]! + (rng() * 2 - 1) * 0.35;
				}
			}
		};
		jitter(this.w1);
		jitter(this.b1);
		jitter(this.w2);
		jitter(this.b2);
	}

	crossover(other: BotPolicy, rng = Math.random): BotPolicy {
		const child = this.clone();
		child.generation = Math.max(this.generation, other.generation) + 1;
		child.fitness = 0;
		const blend = (a: Float32Array, b: Float32Array) => {
			for (let i = 0; i < a.length; i++) {
				a[i] = rng() < 0.5 ? a[i]! : b[i]!;
			}
		};
		blend(child.w1, other.w1);
		blend(child.b1, other.b1);
		blend(child.w2, other.w2);
		blend(child.b2, other.b2);
		child.mutate(0.08, rng);
		return child;
	}

	reinforce(
		obs: Float32Array,
		outputs: Float32Array,
		reward: number,
		learningRate = 0.015,
	): void {
		if (Math.abs(reward) < 1e-6) return;
		const lr = learningRate * Math.sign(reward) * Math.min(Math.abs(reward), 3);

		for (let o = 0; o < POLICY_OUTPUT_SIZE; o++) {
			const row = o * POLICY_HIDDEN_SIZE;
			for (let h = 0; h < POLICY_HIDDEN_SIZE; h++) {
				this.w2[row + h]! += lr * outputs[o]! * _hidden[h]!;
			}
			this.b2[o]! += lr * outputs[o]!;
		}

		for (let h = 0; h < POLICY_HIDDEN_SIZE; h++) {
			const row = h * POLICY_INPUT_SIZE;
			let delta = 0;
			for (let o = 0; o < POLICY_OUTPUT_SIZE; o++) {
				delta += this.w2[o * POLICY_HIDDEN_SIZE + h]! * outputs[o]!;
			}
			for (let i = 0; i < POLICY_INPUT_SIZE; i++) {
				this.w1[row + i]! += lr * delta * obs[i]!;
			}
			this.b1[h]! += lr * delta;
		}
	}

	copyFrom(other: BotPolicy): void {
		this.generation = other.generation;
		this.fitness = other.fitness;
		this.w1.set(other.w1);
		this.b1.set(other.b1);
		this.w2.set(other.w2);
		this.b2.set(other.b2);
	}

	get weights(): {
		w1: Float32Array;
		b1: Float32Array;
		w2: Float32Array;
		b2: Float32Array;
	} {
		return { w1: this.w1, b1: this.b1, w2: this.w2, b2: this.b2 };
	}

	private randomize(seed: number): void {
		let s = seed >>> 0;
		const rnd = () => {
			s = (s * 1_664_525 + 1_013_904_223) >>> 0;
			return s / 0xffffffff;
		};
		const fill = (arr: Float32Array, scale: number) => {
			for (let i = 0; i < arr.length; i++) {
				arr[i] = (rnd() * 2 - 1) * scale;
			}
		};
		fill(this.w1, 0.45);
		fill(this.b1, 0.1);
		fill(this.w2, 0.45);
		fill(this.b2, 0.1);
	}
}
