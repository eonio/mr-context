// scripts/build-vsix.mjs
// Build the VS Code extension .vsix and stage it under extension/ so it ships in
// the npm tarball (see package.json "files"). This lets `mrc extension install`
// work from a global install without the extension source.
//
// NON-FATAL by design: any failure prints a warning and exits 0, so a packaging
// hiccup never blocks `npm publish` / the release pipeline. The CLI falls back to
// building from source when no bundled .vsix is present.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync, rmSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const extDir = join(root, "src", "vscode");
const outDir = join(root, "extension");

function warn(msg) {
  console.warn(`[build-vsix] ${msg} — skipping bundled .vsix (CLI will build from source instead).`);
  process.exit(0);
}

if (!existsSync(join(extDir, "package.json"))) warn("extension source not found");

console.log("[build-vsix] packaging VS Code extension…");
const res = spawnSync("npm run package", { cwd: extDir, shell: true, stdio: "inherit" });
if (res.status !== 0) warn("vsce package failed");

const built = readdirSync(extDir)
  .filter((f) => f.endsWith(".vsix"))
  .map((f) => join(extDir, f))
  .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];

if (!built) warn("no .vsix produced");

// Reset extension/ to a single, current .vsix.
if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
copyFileSync(built, join(outDir, basename(built)));
console.log(`[build-vsix] bundled ${basename(built)} → extension/`);
