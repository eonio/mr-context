// src/cli/commands/init.ts
import { Command } from "commander";
import chalk from "chalk";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { CONFIG_PATH, MRC_DIR } from "../../shared/config.js";
import { scaffoldCopilotAssets } from "../scaffold.js";

const CONFIG_TEMPLATE = {
  _comment: "Each repo is cloned as a sibling of .mrc into this workspace. include/exclude can be set per repo (overriding the global defaults below).",
  repositories: [
    {
      url: "https://github.com/your-org/project-a",
      branch: "main",
      includePatterns: ["**/*.ts", "**/*.tsx"],
      excludePatterns: ["**/node_modules/**", "**/dist/**", "**/*.test.*"],
    },
    {
      url: "https://github.com/your-org/project-b",
      branch: "develop",
    },
  ],
  includePatterns: [
    "**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx",
    "**/*.py", "**/*.go"
  ],
  excludePatterns: [
    "**/node_modules/**", "**/dist/**", "**/build/**",
    "**/.git/**", "**/*.test.*", "**/*.spec.*", "**/*.d.ts"
  ],
  maxFileSizeBytes: 100000,
  maxContextNodes: 25,
  repomix: true,
};

export function initCommand(): Command {
  return new Command("init")
    .description("Scaffold .mrc/config.json + token-disciplined Copilot agent/skills/instructions")
    .option("--force", "Overwrite existing config and refresh Copilot assets", false)
    .action((opts) => {
      scaffoldConfig(opts.force);
      scaffoldGitignore();
      scaffoldCopilotAssets(process.cwd(), opts.force);

      console.log();
      console.log(chalk.bold("  Next steps:"));
      console.log(chalk.gray(`  1. Edit ${CONFIG_PATH} — add 2+ repositories (url + branch, optional per-repo include/exclude)`));
      console.log(chalk.dim("     mr-context shines with 2+ repos — its edge is cross-repo context."));
      console.log(chalk.gray("  2. Set the GITHUB_TOKEN env var for private repos (or configure SSH)"));
      console.log(chalk.gray("  3. Run mrc build — clones repos as siblings of .mrc and builds the graph"));
      console.log(chalk.gray("  4. In Copilot Chat, pick the \"Mr. Context Agent\" mode or run /mrc-locate\n"));
    });
}

function scaffoldConfig(force: boolean): void {
  const configPath = resolve(process.cwd(), CONFIG_PATH);

  if (existsSync(configPath) && !force) {
    console.log(chalk.yellow("  skip  ") + chalk.gray(`${CONFIG_PATH} already exists (--force to overwrite)`));
    return;
  }

  mkdirSync(resolve(process.cwd(), MRC_DIR), { recursive: true });
  writeFileSync(configPath, JSON.stringify(CONFIG_TEMPLATE, null, 2) + "\n", "utf-8");
  console.log(chalk.green("  create") + `  ${CONFIG_PATH}`);
}

function scaffoldGitignore(): void {
  // Keep .mrc/config.json tracked; ignore generated data (graph + repomix
  // artifacts) under .mrc/data/. Sibling clones are ignored via the workspace
  // root .gitignore (a managed block written/refreshed by `mrc build`).
  const mrcIgnore = resolve(process.cwd(), MRC_DIR, ".gitignore");
  if (existsSync(mrcIgnore)) {
    console.log(chalk.yellow("  skip  ") + chalk.gray(`${MRC_DIR}/.gitignore already exists`));
    return;
  }
  mkdirSync(resolve(process.cwd(), MRC_DIR), { recursive: true });
  writeFileSync(mrcIgnore, "data/\n", "utf-8");
  console.log(chalk.green("  create") + `  ${MRC_DIR}/.gitignore`);
}
