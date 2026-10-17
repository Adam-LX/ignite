/**
 * Pełny audyt fizyki auta — uruchamia vitest tylko dla tests/physics/.
 * Exit 0 = OK, 1 = regresja.
 *
 * npm run audit:physics
 */
import { spawnSync } from "node:child_process";

const result = spawnSync(
	"npx",
	["vitest", "run", "tests/physics", "--reporter=verbose"],
	{ stdio: "inherit", shell: true, cwd: process.cwd() },
);

process.exit(result.status === 0 ? 0 : 1);
