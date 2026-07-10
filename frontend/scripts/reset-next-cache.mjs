import { existsSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

const distDir = process.env.NEXT_DIST_DIR || ".next";
const nextDir = resolve(process.cwd(), distDir);

if (!existsSync(nextDir)) {
  console.log(`No existe ${distDir}, no hay nada que resetear.`);
  process.exit(0);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const safeDistDir = distDir.replace(/[\\/]/g, "_");
const staleDir = resolve(tmpdir(), `quinielamaestra_${safeDistDir}_stale_${timestamp}`);

renameSync(nextDir, staleDir);
console.log(`Cache de ${distDir} movida a ${staleDir}`);
