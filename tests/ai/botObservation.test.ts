import { describe, expect, it } from "vitest";
import * as THREE from "three";

import RocketCar from "../../src/physics/RocketCar";
import Scene from "../../src/Scene";
import { buildBotObservation } from "../../src/ai/learning/BotObservation";
import { POLICY_INPUT_SIZE } from "../../src/ai/learning/BotPolicy";

describe("BotObservation — recovery features", () => {
	it("ma 21 wejść z upward, kołami i upsideDown", () => {
		const scene = new Scene();
		const car = new RocketCar(scene, new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 3.6)));
		car.rapierRigidBody.setRotation({ x: 1, y: 0, z: 0, w: 0 }, true);

		const obs = buildBotObservation(car, {
			ballPos: new THREE.Vector3(0, 1, 5),
			ballVel: new THREE.Vector3(),
			team: "blue",
			role: "striker",
			isFFA: false,
		});

		expect(obs.length).toBe(POLICY_INPUT_SIZE);
		expect(obs[18]).toBeLessThan(0);
		expect(obs[20]).toBe(1);
	});
});
