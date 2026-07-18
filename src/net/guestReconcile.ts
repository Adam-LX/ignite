import type { CarEntity } from "../game/CarEntity";
import type { CarSnapshotPayload } from "./protocol";
import { GuestCarPredictor } from "./GuestCarPredictor";

/** Pula reconciliacji gościa — jeden predictor na slot (2v2: do 4). */
export class GuestReconcilePool {
	private readonly predictors = new Map<number, GuestCarPredictor>();

	reset(): void {
		this.predictors.clear();
	}

	resetSlot(slot: number): void {
		this.predictors.delete(slot);
	}

	get(slot: number): GuestCarPredictor {
		let predictor = this.predictors.get(slot);
		if (!predictor) {
			predictor = new GuestCarPredictor();
			this.predictors.set(slot, predictor);
		}
		return predictor;
	}

	ingestAuthority(
		slot: number,
		snap: CarSnapshotPayload,
		car: CarEntity,
	): void {
		this.get(slot).ingestAuthority(snap, car);
	}

	reconcile(slot: number, car: CarEntity, dt: number): void {
		this.get(slot).reconcile(car, dt);
	}

	applyAuthority(slot: number, car: CarEntity): void {
		this.get(slot).applyAuthority(car);
	}
}
