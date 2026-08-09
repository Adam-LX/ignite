import { describe, expect, it } from "vitest";
import * as THREE from "three";

import {
	computeStrikeApproachTarget,
	isAlignedForShot,
	isBetweenBallAndGoal,
} from "../../src/ai/botTactics";

const enemy = new THREE.Vector3(0, 0, 60);
const own = new THREE.Vector3(0, 0, -60);
const out = new THREE.Vector3();

describe("computeStrikeApproachTarget", () => {
	it("blisko — cel za piłką w stronę bramki (przebicie)", () => {
		const bot = new THREE.Vector3(0, 0, 0);
		const ball = new THREE.Vector3(0, 0.5, 2);
		computeStrikeApproachTarget(
			bot,
			ball,
			new THREE.Vector3(0, 0, 0),
			enemy,
			own,
			out,
		);
		expect(out.z).toBeGreaterThan(ball.z);
	});

	it("przed piłką — okrążenie (cel z boku / z tyłu)", () => {
		const ball = new THREE.Vector3(0, 0.5, 10);
		const bot = new THREE.Vector3(0, 0, 20); // między piłką a bramką +Z
		expect(isBetweenBallAndGoal(bot, ball, enemy)).toBe(true);
		computeStrikeApproachTarget(
			bot,
			ball,
			new THREE.Vector3(0, 0, 2),
			enemy,
			own,
			out,
		);
		expect(Math.abs(out.x)).toBeGreaterThan(2);
		expect(out.z).toBeLessThan(bot.z);
	});

	it("clearance — podjeżdża od strony własnej bramki (żeby wypchnąć)", () => {
		const ball = new THREE.Vector3(0, 1, -40);
		const bot = new THREE.Vector3(0, 0, -35);
		const vel = new THREE.Vector3(0, 0, -8);
		computeStrikeApproachTarget(bot, ball, vel, enemy, own, out);
		expect(out.z).toBeLessThan(ball.z);
	});
});

describe("isAlignedForShot", () => {
	it("nos w stronę bramki przez piłkę", () => {
		const bot = new THREE.Vector3(0, 0, 0);
		const ball = new THREE.Vector3(0, 0.5, 3);
		const fwd = new THREE.Vector3(0, 0, 1);
		expect(isAlignedForShot(bot, fwd, ball, enemy)).toBe(true);
	});

	it("nos w bok — brak align", () => {
		const bot = new THREE.Vector3(0, 0, 0);
		const ball = new THREE.Vector3(0, 0.5, 3);
		const fwd = new THREE.Vector3(1, 0, 0);
		expect(isAlignedForShot(bot, fwd, ball, enemy)).toBe(false);
	});
});
