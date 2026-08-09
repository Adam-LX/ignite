import { runHeadlessDiagnosticAutopilot } from "../src/physics/headlessDiagnostic";

const result = await runHeadlessDiagnosticAutopilot();
if (result.passed) {
	console.log(`[AUTOPILOT:headless] PASS — ${result.elapsed.toFixed(1)}s bez błędów.`);
	process.exit(0);
}

console.error(
	`[AUTOPILOT:headless] FAIL — błędy: ${result.errors.join(", ") || "unknown"}`,
);
process.exit(1);
