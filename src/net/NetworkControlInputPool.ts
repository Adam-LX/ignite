import type { InputFramePayload } from "./protocol";
import { NetworkControlInput } from "./NetworkControlInput";

/** Wejścia z sieci per slot — host 2v2 obsługuje do 3 zdalnych graczy. */
export class NetworkControlInputPool {
	private readonly inputs = new Map<number, NetworkControlInput>();

	reset(): void {
		this.inputs.clear();
	}

	forSlot(slot: number): NetworkControlInput {
		let input = this.inputs.get(slot);
		if (!input) {
			input = new NetworkControlInput();
			this.inputs.set(slot, input);
		}
		return input;
	}

	applyFrame(slot: number, frame: InputFramePayload): void {
		this.forSlot(slot).applyFrame(frame);
	}
}
