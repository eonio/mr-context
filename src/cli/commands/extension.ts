// src/cli/commands/extension.ts
// Manage the Mr. Context VS Code extension from the CLI:
//   mrc extension build     — build a .vsix from the extension source
//   mrc extension install   — install the extension into VS Code (build if needed)
//   mrc extension update     — rebuild from latest source and reinstall (--force)
//   mrc extension remove     — uninstall the extension from VS Code
//
// Source of the .vsix, in priority order:
//   1. a freshly built one (dev repo: <root>/src/vscode), when building
//   2. a prebuilt one bundled in the installed npm package (<root>/extension/*.vsix)
// so the command works both in this repo and from a global `npm i -g mr-context`.

import { Command } from "commander";
import chalk from "chalk";
import { spawnSync } from "child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const EXT_ID = "eonio.mr-context";

// ── path discovery ───────────────────────────────────────────────────────────

// Walk up from this module to the installed package root (the package.json that
// owns the `mrc` bin), so paths resolve the same whether run from the dev repo
// or a global install.
function findRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const pj = join(dir, "package.json");
    if (existsSync(pj)) {
      try {
        const p = JSON.parse(readFileSync(pj, "utf-8")) as { name?: string; bin?: unknown };
        if (p.name === "mr-context" && p.bin) return dir;
      } catch {
        /* keep walking */
      }
    }
    dir = dirname(dir);
  }
  return process.cwd();
}

function extensionSrcDir(root: string): string | null {
  const d = join(root, "src", "vscode");
  return existsSync(join(d, "package.json")) ? d : null;
}

function newestVsix(dir: string): string | null {
  if (!existsSync(dir)) return null;
  const vsix = readdirSync(dir)
    .filter((f) => f.endsWith(".vsix"))
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return vsix[0] ?? null;
}

// ── shell helpers ────────────────────────────────────────────────────────────

// Run a command string through the shell (handles code.cmd / vsce on Windows),
// streaming output so the user sees vsce/code progress. Returns the exit code.
function sh(command: string, cwd?: string): number {
  const res = spawnSync(command, { stdio: "inherit", shell: true, cwd });
  return res.status ?? 1;
}

function hasCode(): boolean {
  const res = spawnSync("code --version", { shell: true, stdio: "ignore" });
  return res.status === 0;
}

function requireCode(): boolean {
  if (hasCode()) return true;
  console.error(
    chalk.red("  ✖ VS Code 'code' command not found on PATH.") +
    chalk.gray("\n    In VS Code: Command Palette → \"Shell Command: Install 'code' command in PATH\".")
  );
  return false;
}

// ── vsix resolution ──────────────────────────────────────────────────────────

// Build a .vsix from the extension source. Reuses the extension's own
// `npm run package` (which runs the esbuild bundle then vsce package), matching
// the proven manual flow. Returns the built .vsix path, or null on failure.
function buildVsix(root: string): string | null {
  const extDir = extensionSrcDir(root);
  if (!extDir) {
    console.error(chalk.red("  ✖ Extension source not found.") + chalk.gray(" Build is only available from the mr-context repo (src/vscode)."));
    return null;
  }
  console.log(chalk.cyan("  Building extension .vsix…") + chalk.gray(" (esbuild + vsce)"));
  const code = sh("npm run package", extDir);
  if (code !== 0) {
    console.error(chalk.red("  ✖ Extension build failed."));
    return null;
  }
  const vsix = newestVsix(extDir);
  if (!vsix) console.error(chalk.red("  ✖ Build finished but no .vsix was produced."));
  return vsix;
}

// Resolve a .vsix to install: build when asked or in the dev repo; otherwise use
// the one bundled in the installed package.
function resolveVsix(root: string, forceBuild: boolean): string | null {
  const extDir = extensionSrcDir(root);
  if (forceBuild && extDir) return buildVsix(root);

  const bundled = newestVsix(join(root, "extension"));
  if (bundled) return bundled;

  if (extDir) return buildVsix(root);

  console.error(
    chalk.red("  ✖ No extension .vsix available.") +
    chalk.gray("\n    Install the extension from the VS Code Marketplace, or run this from the mr-context repo to build it.")
  );
  return null;
}

// ── actions ──────────────────────────────────────────────────────────────────

function install(root: string, forceBuild: boolean): void {
  if (!requireCode()) process.exit(1);
  const vsix = resolveVsix(root, forceBuild);
  if (!vsix) process.exit(1);
  console.log(chalk.cyan("  Installing ") + chalk.gray(vsix));
  const code = sh(`code --install-extension "${vsix}" --force`);
  if (code !== 0) process.exit(code);
  console.log(chalk.green("  ✔ Installed. ") + chalk.gray("Reload VS Code to activate the new build."));
}

function remove(): void {
  if (!requireCode()) process.exit(1);
  const code = sh(`code --uninstall-extension ${EXT_ID}`);
  if (code !== 0) process.exit(code);
  console.log(chalk.green("  ✔ Uninstalled ") + chalk.gray(EXT_ID) + chalk.gray(" — reload VS Code."));
}

// ── command ──────────────────────────────────────────────────────────────────

export function extensionCommand(): Command {
  const cmd = new Command("extension")
    .alias("ext")
    .description("Build, install, update, or remove the Mr. Context VS Code extension");

  cmd.command("build")
    .description("Build a .vsix from the extension source (dev repo only)")
    .action(() => {
      const vsix = buildVsix(findRoot());
      if (!vsix) process.exit(1);
      console.log(chalk.green("  ✔ Built ") + chalk.gray(vsix));
    });

  cmd.command("install")
    .description("Install the extension into VS Code")
    .option("--build", "Rebuild from source before installing (dev repo)", false)
    .action((opts) => install(findRoot(), opts.build === true));

  cmd.command("update")
    .description("Rebuild from the latest source and reinstall")
    .action(() => install(findRoot(), true));

  cmd.command("remove")
    .alias("uninstall")
    .description("Uninstall the extension from VS Code")
    .action(() => remove());

  return cmd;
}
