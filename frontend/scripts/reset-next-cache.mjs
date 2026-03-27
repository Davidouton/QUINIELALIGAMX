import { existsSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

const nextDir = resolve(process.cwd(), ".next");

if (!existsSync(nextDir)) {
  console.log("No existe .next, no hay nada que resetear.");
  process.exit(0);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const staleDir = resolve(tmpdir(), `quinielamaestra_next_stale_${timestamp}`);

renameSync(nextDir, staleDir);
console.log(`Cache de Next movida a ${staleDir}`);
