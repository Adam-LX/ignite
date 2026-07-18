#!/usr/bin/env -S vite-node
/** CLI: vite-node scripts/trellis/health.ts */
import { trellisHealth } from "./client.js";

const ok = await trellisHealth();
console.info(ok ? "Trellis OK" : "Trellis unreachable");
process.exit(ok ? 0 : 1);
