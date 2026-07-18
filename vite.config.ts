import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const forDesktop = process.env.ELECTRON_BUILD === "1";
const rootDir = fileURLToPath(new URL(".", import.meta.url));

function ensureMpRelayForDev(command: string): void {
	if (command !== "serve" || process.env.SKIP_MP_BAKE === "1") return;
	try {
		execSync("bash scripts/ensure-mp-relay.sh", {
			cwd: rootDir,
			stdio: "inherit",
		});
	} catch {
		console.warn("[ignite] MP relay ensure failed — fallback localhost:8765");
	}
}

export default defineConfig(({ command }) => {
	ensureMpRelayForDev(command);

	return {
	base: forDesktop ? "./" : "/",
	server: {
		host: true,
		port: 5173,
		strictPort: true,
		open: true,
		hmr: true,
		watch: {
			usePolling: false,
		},
	},
	optimizeDeps: {
		exclude: ["@dimforge/rapier3d-compat"],
	},
	assetsInclude: ["**/*.wasm"],
	plugins: [],
	test: {
		environment: "node",
		globals: false,
		include: ["tests/**/*.test.ts"],
		setupFiles: ["tests/setup.ts"],
		testTimeout: 30_000,
	},
	};
});
