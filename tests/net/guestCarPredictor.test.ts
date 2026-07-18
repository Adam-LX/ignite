import { describe, expect, it } from "vitest";

import {
	GuestCarPredictor,
	guestPredictionActive,
} from "../../src/net/GuestCarPredictor";
import type { CarSnapshotPayload } from "../../src/net/protocol";

function mockCar(pos: { x: number; y: number; z: number }) {
	const state = { ...pos };
	return {
		player: {
			getPosition: () => ({ ...state }),
			rapierRigidBody: {
				translation: () => ({ ...state }),
				setTranslation: (t: { x: number; y: number; z: number }) => {
					state.x = t.x;
					state.y = t.y;
					state.z = t.z;
				},
				setRotation: () => {},
				setLinvel: () => {},
				setAngvel: () => {},
			},
			boostFuel: 1,
			syncWithRigidBody: () => {},
		},
	} as Parameters<GuestCarPredictor["ingestAuthority"]>[1];
}

const snap = (x: number): CarSnapshotPayload => ({
	slot: 0,
	pos: { x, y: 1, z: 0 },
	quat: { x: 0, y: 0, z: 0, w: 1 },
	linvel: { x: 0, y: 0, z: 0 },
	angvel: { x: 0, y: 0, z: 0 },
	boost: 1,
	boosting: false,
});

describe("guestPredictionActive", () => {
	it("aktywne w playing", () => {
		expect(
			guestPredictionActive({
				phase: "playing",
				kickoffTick: null,
				kickoffIgnite: false,
				replayActive: false,
			}),
		).toBe(true);
	});

	it("wyłączone przy kickoff countdown", () => {
		expect(
			guestPredictionActive({
				phase: "playing",
				kickoffTick: 3,
				kickoffIgnite: false,
				replayActive: false,
			}),
		).toBe(false);
	});
});

describe("GuestCarPredictor", () => {
	it("ściąga błąd predykcji w reconcile", () => {
		const predictor = new GuestCarPredictor();
		const car = mockCar({ x: 0, y: 1, z: 0 });
		predictor.ingestAuthority(snap(0), car);
		car.player.rapierRigidBody.setTranslation({ x: 3, y: 1, z: 0 });
		predictor.ingestAuthority(snap(0), car);

		for (let i = 0; i < 40; i++) predictor.reconcile(car, 1 / 60);

		const pos = car.player.getPosition();
		expect(Math.abs(pos.x)).toBeLessThan(0.35);
	});
});
