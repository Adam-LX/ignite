import { defineConfig } from "vite";

/** Bundled room server for Electron (fork via ELECTRON_RUN_AS_NODE). */
export default defineConfig({
	ssr: {
		target: "node",
		noExternal: true,
	},
	build: {
		ssr: true,
		lib: {
			entry: "server/roomServer.ts",
			formats: ["cjs"],
			fileName: () => "mp-server.cjs",
		},
		outDir: ".build",
		emptyOutDir: true,
		target: "node18",
		minify: false,
		rollupOptions: {
			output: {
				entryFileNames: "mp-server.cjs",
			},
		},
	},
});
