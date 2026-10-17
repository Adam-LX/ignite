import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = resolve(import.meta.dirname, "../..");

export async function startMpTestServer(port: number): Promise<ChildProcess> {
	const bundled = resolve(ROOT, ".build/mp-server.cjs");
	const { existsSync } = await import("node:fs");
	const useBundle = existsSync(bundled);
	const proc = useBundle
		? spawn(process.execPath, [bundled], {
				cwd: ROOT,
				env: { ...process.env, IGNITE_MP_PORT: String(port) },
				stdio: ["ignore", "pipe", "pipe"],
			})
		: spawn("npx", ["vite-node", "server/roomServer.ts"], {
				cwd: ROOT,
				env: { ...process.env, IGNITE_MP_PORT: String(port) },
				stdio: ["ignore", "pipe", "pipe"],
			});

	for (let i = 0; i < 80; i++) {
		try {
			const res = await fetch(`http://127.0.0.1:${port}/status`);
			if (res.ok) return proc;
		} catch {
			// serwer jeszcze nie nasłuchuje
		}
		if (proc.exitCode != null) {
			throw new Error(
				`MP server padł przy starcie (exit=${proc.exitCode}) port=${port}`,
			);
		}
		await sleep(120);
	}

	proc.kill("SIGTERM");
	throw new Error(`MP server nie wystartował na porcie ${port}`);
}

export function stopMpTestServer(proc: ChildProcess | undefined): void {
	if (!proc || proc.killed || proc.exitCode != null) return;
	proc.kill("SIGTERM");
}
