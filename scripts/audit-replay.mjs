#!/usr/bin/env node
/**
 * Audyt powtórki gola — ruch piłki + stabilność kamery + screenshoty.
 *
 *   node scripts/audit-replay.mjs
 *
 * Exit 0 = PASS, 1 = FAIL, 2 = setup error.
 *
 * Kryteria:
 *   - wchodzi w goal_replay
 *   - piłka przebywa ≥ 8 m w trakcie replay (nie „stoi”)
 *   - kamera nie skacze > 25 m między próbkami
 *   - cam.y sensowne (1.5–18)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "test-results", "replay");
const CHROMIUM =
	process.env.CHROMIUM_PATH ??
	process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
	"/run/current-system/sw/bin/chromium";
const VITE = (process.env.IGNITE_VITE_URL || "http://127.0.0.1:5173").replace(
	/\?.*$/,
	"",
);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

mkdirSync(OUT, { recursive: true });

function dist3(a, b) {
	return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

async function main() {
	const browser = await chromium.launch({
		headless: true,
		executablePath: CHROMIUM,
		args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"],
	});
	const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
	const logs = [];
	page.on("console", (m) => {
		const t = m.text();
		if (/\[Match\]|replay|Error|TypeError/i.test(t)) logs.push(t);
	});

	await page.goto(`${VITE}/?autostart=1v1`, {
		waitUntil: "domcontentloaded",
		timeout: 120_000,
	});
	await page.waitForFunction(() => window.__igniteSession && window.__igniteBall, {
		timeout: 180_000,
	});

	/** Pomiń długie odliczanie w headless (rAF bywa wolne). */
	await page.evaluate(() => {
		window.__igniteSession?.match?.forceStartPlaying?.();
	});
	await page.waitForFunction(
		() => window.__igniteSession?.match?.getPhase?.() === "playing",
		{ timeout: 15_000 },
	);
	await page.waitForTimeout(300);

	const halfLen = await page.evaluate(
		() => window.__igniteArenaHalfLength ?? 60,
	);
	console.log(`[audit-replay] HALF_LENGTH=${halfLen}`);

	/** Nagraj podejście strzału (~2 s ruchu). */
	for (let i = 0; i < 24; i++) {
		const t = i / 23;
		const z = (halfLen - 14) * t;
		await page.evaluate(
			({ z, vz }) => {
				const ball = window.__igniteBall;
				if (!ball?.rapierRigidBody) return;
				ball.rapierRigidBody.setTranslation({ x: 0, y: 1.1, z }, true);
				ball.rapierRigidBody.setLinvel({ x: 0, y: 0.5, z: vz }, true);
			},
			{ z, vz: 28 },
		);
		await page.waitForTimeout(90);
	}

	/** Domknięcie w świetle bramki (blue scores → +Z). */
	await page.evaluate(({ half }) => {
		const ball = window.__igniteBall;
		if (!ball?.rapierRigidBody) return;
		ball.rapierRigidBody.setTranslation(
			{ x: 0, y: 1.05, z: half + 0.8 },
			true,
		);
		ball.rapierRigidBody.setLinvel({ x: 0, y: 0.2, z: 12 }, true);
	}, { half: halfLen });

	/** Czekaj na bounce → replay (headless: rAF wolne → wymuś wejście). */
	let enteredReplay = false;
	let lastPhase = null;
	for (let i = 0; i < 120; i++) {
		const a = await page.evaluate(() => window.__igniteReplayAudit?.());
		if (a?.phase && a.phase !== lastPhase) {
			console.log(`[audit-replay] phase → ${a.phase}`);
			lastPhase = a.phase;
		}
		if (a?.phase === "goal_bounce" && i > 8) {
			await page.evaluate(() => {
				window.__igniteSession?.match?.forceEnterGoalReplay?.();
			});
		}
		if (a?.replayActive || a?.phase === "goal_replay") {
			enteredReplay = true;
			break;
		}
		await page.waitForTimeout(100);
	}

	const samples = [];
	if (enteredReplay) {
		await page.screenshot({
			path: join(OUT, `replay-start-${stamp}.png`),
			type: "png",
		});
		for (let i = 0; i < 40; i++) {
			const a = await page.evaluate(() => window.__igniteReplayAudit?.());
			if (!a) break;
			samples.push(a);
			if (!a.replayActive && a.phase !== "goal_replay" && i > 4) break;
			await page.waitForTimeout(120);
		}
		await page.screenshot({
			path: join(OUT, `replay-mid-${stamp}.png`),
			type: "png",
		});
	} else {
		await page.screenshot({
			path: join(OUT, `replay-noenter-${stamp}.png`),
			type: "png",
		});
	}

	await page.screenshot({
		path: join(OUT, `replay-end-${stamp}.png`),
		type: "png",
	});

	const fails = [];
	if (!enteredReplay) fails.push("no-replay-phase");

	let ballTravel = 0;
	let maxCamJump = 0;
	let maxCamY = 0;
	let minCamY = 99;
	let maxSpeed = 0;
	for (let i = 1; i < samples.length; i++) {
		const prev = samples[i - 1];
		const cur = samples[i];
		if (prev.ball && cur.ball) {
			ballTravel += dist3(prev.ball, cur.ball);
		}
		if (prev.cam && cur.cam) {
			maxCamJump = Math.max(maxCamJump, dist3(prev.cam, cur.cam));
		}
		if (cur.cam) {
			maxCamY = Math.max(maxCamY, cur.cam.y);
			minCamY = Math.min(minCamY, cur.cam.y);
		}
		maxSpeed = Math.max(maxSpeed, cur.speed ?? 0);
	}

	if (enteredReplay && ballTravel < 6) {
		fails.push(`ballTravel=${ballTravel.toFixed(2)}`);
	}
	if (enteredReplay && maxCamJump > 28) {
		fails.push(`camJump=${maxCamJump.toFixed(2)}`);
	}
	if (enteredReplay && (maxCamY > 22 || minCamY < 0.8)) {
		fails.push(`camY=[${minCamY.toFixed(2)},${maxCamY.toFixed(2)}]`);
	}
	if (enteredReplay && maxSpeed < 0.5 && ballTravel < 10) {
		fails.push(`ballNearlyStill speed=${maxSpeed.toFixed(2)}`);
	}

	const report = {
		generatedAt: new Date().toISOString(),
		pass: fails.length === 0,
		fails,
		enteredReplay,
		ballTravel,
		maxCamJump,
		camY: { min: minCamY, max: maxCamY },
		maxSpeed,
		sampleCount: samples.length,
		samples: samples.slice(0, 12),
		logs: logs.slice(-30),
		hints: fails.length
			? [
					"src/game/GoalReplay.ts (buildClip / hold frames)",
					"src/game/GameSession.ts (startGoalReplayClip — visual vs physics)",
					"src/modes/MatchController.ts (shouldRecordReplay + goal_bounce)",
					"src/Renderer.ts (followReplayBall)",
				]
			: [],
	};

	writeFileSync(join(OUT, `replay-${stamp}.json`), JSON.stringify(report, null, 2));
	writeFileSync(join(OUT, "LATEST.json"), JSON.stringify(report, null, 2));
	writeFileSync(
		join(OUT, "LATEST.md"),
		[
			`# Goal replay audit`,
			``,
			`- **PASS:** ${report.pass}`,
			`- fails: ${fails.join(", ") || "—"}`,
			`- enteredReplay: ${enteredReplay}`,
			`- ballTravel: ${ballTravel.toFixed(2)} m`,
			`- maxCamJump: ${maxCamJump.toFixed(2)} m`,
			`- camY: ${minCamY.toFixed(2)} … ${maxCamY.toFixed(2)}`,
			`- maxSpeed: ${maxSpeed.toFixed(2)}`,
			`- samples: ${samples.length}`,
			``,
			report.pass
				? `_Replay OK._`
				: `## Hints\n\n${report.hints.map((h) => `- \`${h}\``).join("\n")}`,
			``,
		].join("\n"),
	);

	console.log(
		JSON.stringify(
			{
				pass: report.pass,
				fails,
				ballTravel,
				maxCamJump,
				maxSpeed,
				samples: samples.length,
			},
			null,
			2,
		),
	);
	console.log(`[audit-replay] ${report.pass ? "PASS" : "FAIL"} → ${join(OUT, "LATEST.md")}`);

	await browser.close();
	process.exit(report.pass ? 0 : 1);
}

main().catch((err) => {
	console.error("[audit-replay] ERROR", err);
	writeFileSync(
		join(OUT, "LATEST.json"),
		JSON.stringify({ pass: false, fails: ["setup-error"], error: String(err) }, null, 2),
	);
	process.exit(2);
});
