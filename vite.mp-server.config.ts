import { defineConfig } from "vite";

/** Bundled room server for Electron (fork via ELECTRON_RUN_AS_NODE). */
export default defineConfig({
	ssr: {
		target: "node",
		/** `ws` + native bufferutil muszą zostać zewnętrzne — bundling psuje unmask(). */
		noExternal: true,
		external: ["ws", "bufferutil", "utf-8-validate"],
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
			external: ["ws", "bufferutil", "utf-8-validate"],
			output: {
				entryFileNames: "mp-server.cjs",
			},
		},
	},
});
