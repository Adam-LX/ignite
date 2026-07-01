import { defineConfig } from "vite";

const forDesktop = process.env.ELECTRON_BUILD === "1";

export default defineConfig({
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
});
