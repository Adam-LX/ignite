/**
 * Szczegółowy audyt wall-ride: clearance, orientacja, jerk, stick, wjazd/zjazd.
 *
 *   vite-node scripts/auditWallDetail.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import * as THREE from "three";

import RocketCar from "../src/physics/RocketCar";
import Scene from "../src/Scene";
import { RL_ARENA } from "../src/visual/arenaConstants";
import { buildArenaPhysics } from "../src/visual/arena";
import {
	RAMP_BASE_Y,
	RAMP_RUN,
	RAMP_TOP_Y,
} from "../src/visual/perimeter/constants";
import { RL_CAR, RL_HOVER } from "../src/util/rlConstants";

const DT = 1 / 60;
const OUT = "test-results/wall-detail";

class Input {
	fwd = 0;
	boost = false;
	yawVal = 0;
	jumpQ = 0;
	jumpHeld = false;
	forward = () => this.fwd;
	yaw = () => this.yawVal;
	roll = () => 0;
	isBoosting = () => this.boost;
	isShiftDown = () => false;
	isJumpHeld = () => this.jumpHeld;
	consumeRecover = () => false;
	peekJump = () => this.jumpQ > 0;
	consumeJump = () => {
		if (this.jumpQ <= 0) return false;
		this.jumpQ--;
		return true;
	};
	hasFlipDirection = () =>
		Math.abs(this.fwd) > 0.2 || Math.abs(this.yawVal) > 0.2;
	queueJump() {
		this.jumpQ = Math.min(3, this.jumpQ + 1);
	}
}

function step(scene: Scene, car: RocketCar, input: Input): void {
	car.control(input, DT);
	scene.advancePhysics(
		DT,
		(dt, sub, n) => car.integrateHover(dt, sub, n),
		(_dt, sub, n) => car.finalizeHoverStep(sub, n),
	);
	car.afterPhysics(DT);
}

function settle(scene: Scene, car: RocketCar, input: Input, n: number): void {
	input.fwd = 0;
	input.boost = false;
	for (let i = 0; i < n; i++) step(scene, car, input);
}

function makeCar(scene: Scene): RocketCar {
	return new RocketCar(scene, new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 3.6)));
}

/** Orientacja: up = −X (w stronę boiska), forward = +Y (w górę ściany). */
function poseOnWall(car: RocketCar, x: number, y: number, z: number, vy = 0): void {
	car.resetKickoffPose(x, y, z, 0);
	const up = new THREE.Vector3(-1, 0, 0);
	const forward = new THREE.Vector3(0, 1, 0);
	const right = new THREE.Vector3().crossVectors(up, forward).normalize();
	forward.crossVectors(right, up).normalize();
	const mat = new THREE.Matrix4().makeBasis(right, up, forward);
	const q = new THREE.Quaternion().setFromRotationMatrix(mat);
	car.rapierRigidBody.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
	car.rapierRigidBody.setLinvel({ x: 0, y: vy, z: 0 }, true);
}

type Finding = {
	id: string;
	severity: "ok" | "warn" | "fail";
	detail: string;
	metrics: Record<string, number>;
};

function severityIcon(s: Finding["severity"]): string {
	return s === "ok" ? "✓" : s === "warn" ? "!" : "✗";
}

async function main(): Promise<void> {
	const RAPIER = (await import("@dimforge/rapier3d-compat")).default;
	await RAPIER.init();
	mkdirSync(OUT, { recursive: true });

	const scene = new Scene();
	buildArenaPhysics(scene.rapierWorld);
	const car = makeCar(scene);
	const input = new Input();
	const findings: Finding[] = [];
	const log: Record<string, unknown>[] = [];

	const wallFaceX = RL_ARENA.HALF_WIDTH + RAMP_RUN;
	const expectedHover =
		RL_CAR.hitboxHalfY + RL_HOVER.suspensionRestLength; // ~0.52
	const wallX = wallFaceX - expectedHover;

	// ── A) Clearance na murawie ─────────────────────────────────────
	car.resetKickoffPose(0, 0.9, 0, 0);
	settle(scene, car, input, 120);
	{
		const p = car.getPosition();
		const gap = p.y; // center height above y=0 floor collider ≈ surface
		const n = car.getSurfaceNormal();
		findings.push({
			id: "grass_clearance",
			severity:
				gap > 0.25 && gap < 0.75 && Math.abs(n.y - 1) < 0.05 ? "ok" : "fail",
			detail: `centerY=${gap.toFixed(3)} expected~${expectedHover.toFixed(2)} ny=${n.y.toFixed(3)} wheels=${car.getWheelsGroundedCount()}`,
			metrics: { gap, expectedHover, ny: n.y },
		});
		log.push({ phase: "grass", ...p, gap, ny: n.y });
	}

	// ── B) Clearance / orientacja na pionowej ścianie ───────────────
	poseOnWall(car, wallX, 12, 0, 8);
	input.fwd = 1;
	input.boost = true;
	car.boostFuel = 1;
	for (let i = 0; i < 30; i++) step(scene, car, input);

	let gapSum = 0;
	let gapN = 0;
	let gapMin = 99;
	let gapMax = 0;
	let upDotMin = 1;
	let sepMax = 0;
	let jerkMax = 0;
	let prevGap = -1;
	let wallFrames = 0;
	let floatFrames = 0; // gap >> expected
	let digFrames = 0; // gap << expected (penetrating / stuck in)

	/** Stick ściska zawieszenie — na ścianie gap < restLength. */
	const wallGapTarget = 0.22;

	for (let i = 0; i < 120; i++) {
		step(scene, car, input);
		const p = car.getPosition();
		const n = car.getSurfaceNormal();
		const up = car.getUpward();
		const gap = wallFaceX - p.x; // +X wall: distance center → face
		const vn = car.getVelocity().dot(n);
		const upDot = up.dot(n);
		if (car.isOnWallOrRamp() && n.y < 0.35 && n.y > -0.25 && Math.abs(n.x) > 0.75) {
			wallFrames++;
			gapSum += gap;
			gapN++;
			gapMin = Math.min(gapMin, gap);
			gapMax = Math.max(gapMax, gap);
			upDotMin = Math.min(upDotMin, upDot);
			sepMax = Math.max(sepMax, vn);
			if (prevGap >= 0) jerkMax = Math.max(jerkMax, Math.abs(gap - prevGap));
			prevGap = gap;
			if (gap > wallGapTarget + 0.35) floatFrames++;
			if (gap < 0.05) digFrames++;
		} else if (car.isOnWallOrRamp() && n.y < 0.35) {
			wallFrames++;
			upDotMin = Math.min(upDotMin, upDot);
		}
		if (i % 5 === 0) {
			log.push({
				phase: "wall_hold",
				t: i * DT,
				x: p.x,
				y: p.y,
				gap,
				ny: n.y,
				upDot,
				vn,
				spd: car.getVelocity().length(),
				wheels: car.getWheelsGroundedCount(),
			});
		}
	}
	const gapAvg = gapN > 0 ? gapSum / gapN : 0;
	findings.push({
		id: "wall_clearance",
		severity:
			gapN > 60 &&
			gapAvg > 0.1 &&
			gapAvg < 0.45 &&
			floatFrames < 8 &&
			digFrames < 8
				? "ok"
				: gapN > 40 && gapAvg > 0.08 && gapAvg < 0.55
					? "warn"
					: "fail",
		detail: `avgGap=${gapAvg.toFixed(3)} min=${gapMin.toFixed(3)} max=${gapMax.toFixed(3)} target~${wallGapTarget} floatF=${floatFrames} digF=${digFrames}`,
		metrics: { gapAvg, gapMin, gapMax, wallGapTarget, floatFrames, digFrames },
	});
	findings.push({
		id: "wall_attitude",
		severity: upDotMin > 0.92 && wallFrames >= 80 ? "ok" : upDotMin > 0.8 ? "warn" : "fail",
		detail: `upDotMin=${upDotMin.toFixed(3)} wallFrames=${wallFrames}/120`,
		metrics: { upDotMin, wallFrames },
	});
	findings.push({
		id: "wall_stick_sep",
		severity: sepMax < 4.5 && jerkMax < 0.1 ? "ok" : sepMax < 6 ? "warn" : "fail",
		detail: `maxSep=${sepMax.toFixed(3)} maxGapJerk=${jerkMax.toFixed(4)}`,
		metrics: { sepMax, jerkMax },
	});

	// ── C) Wjazd z murawy — prędkość, gap, align ────────────────────
	car.resetKickoffPose(RL_ARENA.HALF_WIDTH - 14, 0.9, 0, Math.PI / 2);
	settle(scene, car, input, 90);
	input.fwd = 1;
	input.boost = true;
	car.boostFuel = 1;
	car.rapierRigidBody.setLinvel({ x: 18, y: 0, z: 0 }, true);

	let entryMinSpd = 99;
	let entryAtContactSpd = -1;
	let entryMaxY = 0;
	let entryUpDotMin = 1;
	let entryLostWheels = 0;
	let entryGapAtWall = -1;
	let prevY = car.getPosition().y;
	let maxYJump = 0;

	for (let i = 0; i < 240; i++) {
		step(scene, car, input);
		const p = car.getPosition();
		const n = car.getSurfaceNormal();
		const up = car.getUpward();
		const spd = car.getVelocity().length();
		const dy = p.y - prevY;
		if (p.x > RL_ARENA.HALF_WIDTH - 3 && p.y < RAMP_BASE_Y + 1.4) {
			maxYJump = Math.max(maxYJump, dy);
		}
		if (car.isOnWallOrRamp()) {
			if (entryAtContactSpd < 0) entryAtContactSpd = spd;
			entryMinSpd = Math.min(entryMinSpd, spd);
			entryUpDotMin = Math.min(entryUpDotMin, up.dot(n));
			if (car.getWheelsGroundedCount() < 2) entryLostWheels++;
			if (n.y < 0.35 && entryGapAtWall < 0) {
				entryGapAtWall = wallFaceX - p.x;
			}
		}
		entryMaxY = Math.max(entryMaxY, p.y);
		prevY = p.y;
		if (i % 4 === 0 && p.x > RL_ARENA.HALF_WIDTH - 2) {
			log.push({
				phase: "entry",
				t: i * DT,
				x: p.x,
				y: p.y,
				spd,
				ny: n.y,
				upDot: up.dot(n),
				wheels: car.getWheelsGroundedCount(),
				gap: wallFaceX - p.x,
			});
		}
	}
	findings.push({
		id: "entry_speed_retain",
		severity:
			entryAtContactSpd > 12 && entryMinSpd > 8 && entryMaxY > RAMP_TOP_Y + 8
				? "ok"
				: entryMaxY > RAMP_TOP_Y + 1
					? "warn"
					: "fail",
		detail: `contactSpd=${entryAtContactSpd.toFixed(1)} minSpd=${entryMinSpd.toFixed(1)} maxY=${entryMaxY.toFixed(1)} bump=${maxYJump.toFixed(3)}`,
		metrics: {
			entryAtContactSpd,
			entryMinSpd,
			entryMaxY,
			maxYJump,
		},
	});
	findings.push({
		id: "entry_align",
		severity:
			entryUpDotMin > 0.75 && entryLostWheels < 25
				? "ok"
				: entryUpDotMin > 0.5
					? "warn"
					: "fail",
		detail: `upDotMin=${entryUpDotMin.toFixed(3)} lostWheelFrames=${entryLostWheels} gapAtWall=${entryGapAtWall.toFixed(3)}`,
		metrics: { entryUpDotMin, entryLostWheels, entryGapAtWall },
	});

	// ── D) Zjazd ze ściany (gaz wstecz — forward lokalny = góra ściany) ──
	poseOnWall(car, wallX, 22, 0, -4);
	input.fwd = -1;
	input.boost = false;
	car.boostFuel = 0;
	for (let i = 0; i < 20; i++) step(scene, car, input);

	let descentMinY = car.getPosition().y;
	let descentStuck = 0;
	let descentUpDotMin = 1;
	let lastY = descentMinY;
	for (let i = 0; i < 150; i++) {
		input.fwd = -1;
		step(scene, car, input);
		const p = car.getPosition();
		const n = car.getSurfaceNormal();
		const up = car.getUpward();
		descentMinY = Math.min(descentMinY, p.y);
		descentUpDotMin = Math.min(descentUpDotMin, up.dot(n));
		if (Math.abs(p.y - lastY) < 0.008 && p.y > 5) descentStuck++;
		lastY = p.y;
	}
	findings.push({
		id: "descent",
		severity:
			descentMinY < 3 && descentStuck < 40 && descentUpDotMin > 0.7
				? "ok"
				: descentMinY < 6
					? "warn"
					: "fail",
		detail: `minY=${descentMinY.toFixed(2)} stuckFrames=${descentStuck} upDotMin=${descentUpDotMin.toFixed(3)}`,
		metrics: { descentMinY, descentStuck, descentUpDotMin },
	});

	// ── E) Jump detach ──────────────────────────────────────────────
	poseOnWall(car, wallX, 14, 0, 4);
	input.fwd = 1;
	input.boost = false;
	settle(scene, car, input, 25);
	input.queueJump();
	let jumpMaxSep = 0;
	let leftWall = false;
	for (let i = 0; i < 45; i++) {
		step(scene, car, input);
		const n = car.getSurfaceNormal();
		const vn = car.getVelocity().dot(n);
		jumpMaxSep = Math.max(jumpMaxSep, vn);
		if (!car.isOnWallOrRamp() && i > 3) leftWall = true;
	}
	findings.push({
		id: "wall_jump",
		severity: jumpMaxSep > 0.55 && leftWall ? "ok" : jumpMaxSep > 0.35 ? "warn" : "fail",
		detail: `maxSep=${jumpMaxSep.toFixed(3)} leftWall=${leftWall}`,
		metrics: { jumpMaxSep, leftWall: leftWall ? 1 : 0 },
	});

	// ── F) Podejście pod sufit (biała taśma) ─────────────────────────
	poseOnWall(car, wallX, RL_ARENA.HEIGHT - 8, 0, 14);
	input.fwd = 1;
	input.boost = true;
	car.boostFuel = 1;
	let ceilMaxY = car.getPosition().y;
	let ceilSep = 0;
	let ceilBounce = 0;
	let prevCy = ceilMaxY;
	for (let i = 0; i < 120; i++) {
		step(scene, car, input);
		const p = car.getPosition();
		const n = car.getSurfaceNormal();
		const vn = car.getVelocity().dot(n);
		ceilMaxY = Math.max(ceilMaxY, p.y);
		ceilSep = Math.max(ceilSep, vn);
		if (p.y < prevCy - 0.4 && prevCy > RL_ARENA.HEIGHT - 4) ceilBounce++;
		prevCy = p.y;
		if (i % 6 === 0) {
			log.push({
				phase: "ceiling_approach",
				t: i * DT,
				y: p.y,
				x: p.x,
				ny: n.y,
				vn,
				spd: car.getVelocity().length(),
			});
		}
	}
	findings.push({
		id: "ceiling_approach",
		severity:
			ceilMaxY > RL_ARENA.HEIGHT - 2.2 &&
			ceilMaxY < RL_ARENA.HEIGHT + 4 &&
			ceilBounce < 8
				? "ok"
				: ceilMaxY > RL_ARENA.HEIGHT - 4
					? "warn"
					: "fail",
		detail: `maxY=${ceilMaxY.toFixed(2)} arenaH=${RL_ARENA.HEIGHT} bounceEvents=${ceilBounce} sep=${ceilSep.toFixed(2)}`,
		metrics: { ceilMaxY, ceilBounce, ceilSep, arenaH: RL_ARENA.HEIGHT },
	});

	// ── G) Narożnik — jazda po prostej ścianie w łuk ─────────────────
	{
		/** Prosta +X kończy się ~HALF−CORNER_CUT; start przed łukiem. */
		const zStart =
			RL_ARENA.HALF_LENGTH - RL_ARENA.CORNER_CUT - 5; /* ~38.5 */
		poseOnWall(car, wallX, 9, zStart, 0);
		const up = new THREE.Vector3(-1, 0, 0);
		const forward = new THREE.Vector3(0, 0, 1); /* w stronę +Z → łuk */
		const right = new THREE.Vector3().crossVectors(up, forward).normalize();
		const fwd = new THREE.Vector3().crossVectors(right, up).normalize();
		const mat = new THREE.Matrix4().makeBasis(right, up, fwd);
		const q = new THREE.Quaternion().setFromRotationMatrix(mat);
		car.rapierRigidBody.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
		car.rapierRigidBody.setLinvel({ x: 0, y: 0, z: 12 }, true);
	}
	input.fwd = 1;
	input.boost = true;
	input.yawVal = 0;
	car.boostFuel = 1;
	for (let i = 0; i < 25; i++) step(scene, car, input);
	let cornerUpDotMin = 1;
	let cornerSep = 0;
	let cornerOnWall = 0;
	let cornerFlip = 0;
	let cornerMaxZ = car.getPosition().z;
	for (let i = 0; i < 100; i++) {
		step(scene, car, input);
		const p = car.getPosition();
		const n = car.getSurfaceNormal();
		const up = car.getUpward();
		const upDot = up.dot(n);
		cornerUpDotMin = Math.min(cornerUpDotMin, upDot);
		cornerSep = Math.max(cornerSep, car.getVelocity().dot(n));
		if (car.isOnWallOrRamp()) cornerOnWall++;
		if (upDot < 0.25) cornerFlip++;
		cornerMaxZ = Math.max(cornerMaxZ, p.z);
	}
	findings.push({
		id: "corner_hold",
		severity:
			cornerOnWall >= 70 &&
			cornerUpDotMin > 0.55 &&
			cornerFlip < 15 &&
			cornerSep < 5 &&
			cornerMaxZ > RL_ARENA.HALF_LENGTH - RL_ARENA.CORNER_CUT + 1
				? "ok"
				: cornerOnWall >= 50 && cornerFlip < 30
					? "warn"
					: "fail",
		detail: `onWall=${cornerOnWall}/100 upDotMin=${cornerUpDotMin.toFixed(3)} flipF=${cornerFlip} sep=${cornerSep.toFixed(2)} maxZ=${cornerMaxZ.toFixed(1)}`,
		metrics: {
			cornerOnWall,
			cornerUpDotMin,
			cornerFlip,
			cornerSep,
			cornerMaxZ,
		},
	});

	// ── H) Coast bez gazu — RL peel / grawitacja ────────────────────
	poseOnWall(car, wallX, 16, 0, 8);
	input.fwd = 1;
	input.boost = true;
	car.boostFuel = 1;
	for (let i = 0; i < 25; i++) step(scene, car, input);
	input.fwd = 0;
	input.boost = false;
	car.boostFuel = 0;
	let coastLeftWall = false;
	let coastMinGap = 99;
	let coastMaxSep = 0;
	for (let i = 0; i < 120; i++) {
		step(scene, car, input);
		const p = car.getPosition();
		const n = car.getSurfaceNormal();
		const gap = wallFaceX - p.x;
		const vn = car.getVelocity().dot(n);
		if (!car.isOnWallOrRamp() && i > 10) coastLeftWall = true;
		if (car.isOnWallOrRamp() && Math.abs(n.x) > 0.7) {
			coastMinGap = Math.min(coastMinGap, gap);
		}
		coastMaxSep = Math.max(coastMaxSep, vn);
		/** Oderwanie: gap wyraźnie > hover albo brak wall. */
		if (gap > expectedHover + 0.85) coastLeftWall = true;
	}
	findings.push({
		id: "coast_detach",
		severity: coastLeftWall || coastMaxSep > 1.2 ? "ok" : "fail",
		detail: `leftWall=${coastLeftWall} maxSep=${coastMaxSep.toFixed(2)} minGap=${coastMinGap === 99 ? -1 : coastMinGap.toFixed(2)}`,
		metrics: {
			coastLeftWall: coastLeftWall ? 1 : 0,
			coastMaxSep,
			coastMinGap: coastMinGap === 99 ? -1 : coastMinGap,
		},
	});

	const fails = findings.filter((f) => f.severity === "fail");
	const warns = findings.filter((f) => f.severity === "warn");
	const pass = fails.length === 0;

	const md = [
		"# Wall Detail Audit",
		"",
		`Wynik: **${pass ? "PASS" : "FAIL"}** (${fails.length} fail, ${warns.length} warn)`,
		"",
		`wallFaceX=${wallFaceX.toFixed(2)} expectedHover=${expectedHover.toFixed(3)} RAMP_TOP=${RAMP_TOP_Y.toFixed(2)}`,
		"",
		"| Check | Sev | Detail |",
		"|-------|-----|--------|",
		...findings.map(
			(f) =>
				`| ${f.id} | ${severityIcon(f.severity)} ${f.severity} | ${f.detail} |`,
		),
		"",
	].join("\n");

	writeFileSync(join(OUT, "wall-detail.md"), md);
	writeFileSync(
		join(OUT, "wall-detail.json"),
		JSON.stringify({ findings, log, wallFaceX, expectedHover }, null, 2),
	);

	console.log(md);
	for (const f of findings) {
		console.log(`  [${f.severity.toUpperCase()}] ${f.id}: ${f.detail}`);
	}
	process.exit(pass ? 0 : 1);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
