/** Spike względem średniego basu — cisza między kickami, mocny hit na uderzeniu. */
export class MusicBeatAnalyzer {
	private readonly freq: Uint8Array;
	private avgLevel = 0.04;
	private punch = 0;
	private lastHitMs = 0;

	constructor(fftSize = 512) {
		this.freq = new Uint8Array(fftSize / 2);
	}

	tick(analyser: AnalyserNode): number {
		analyser.getByteFrequencyData(this.freq);

		let sub = 0;
		const subN = Math.min(10, this.freq.length);
		for (let i = 0; i < subN; i++) {
			sub += this.freq[i]!;
		}
		sub /= subN * 255;

		let bass = 0;
		const bassN = Math.min(32, this.freq.length);
		for (let i = 0; i < bassN; i++) {
			bass += this.freq[i]!;
		}
		bass /= bassN * 255;

		const level = sub * 0.55 + bass * 0.45;

		// Bazowa linia — wolno, żeby nie „gonić” muzyki i nie blokować hitów
		this.avgLevel = this.avgLevel * 0.93 + level * 0.07;

		const floor = Math.max(0.02, this.avgLevel);
		const relative = level / floor;
		const jump = level - this.avgLevel;
		const now = performance.now();
		const refractory = now - this.lastHitMs > 75;

		if (refractory && relative > 1.14 && jump > 0.012) {
			const strength = (relative - 1) * 0.95 + jump * 9;
			this.punch = Math.min(1.45, 0.55 + strength);
			this.lastHitMs = now;
			this.avgLevel = this.avgLevel * 0.55 + level * 0.45;
		} else {
			this.punch *= 0.55;
		}

		if (this.punch < 0.03) return 0;
		return Math.min(1, this.punch);
	}
}
