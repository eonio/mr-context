// src/cli/commands/init.ts
import { Command } from "commander";
import chalk from "chalk";
import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from "fs";
import { resolve } from "path";
import { CONFIG_PATH, MRC_DIR } from "../../shared/config.js";

const INSTRUCTIONS_PATH = ".github/copilot-instructions.md";
const MRC_BLOCK_START = "<!-- mr-context:start -->";
const MRC_BLOCK_END = "<!-- mr-context:end -->";

const MRC_COPILOT_BLOCK = `\n${MRC_BLOCK_START}
## Mr. Context — Token Shield

This workspace uses [Mr. Context](https://github.com/eonio/mr-context) to pre-index all
repositories into a semantic graph. The graph knows every file, export, import, and design
pattern — use it instead of reading files directly.

### MANDATORY: call \`#mrcAsk\` FIRST — before anything else

**Before writing code, reading a file, or answering any codebase question:**
1. Call \`#mrcAsk\` with the user's full request as the query.
2. Use the returned context to answer or generate code.
3. Only read individual files if a specific detail is missing from the graph result.

**Never:**
- Read files directly to understand the codebase structure
- Guess file paths, export names, or import locations
- Call multiple codebase search tools when \`#mrcAsk\` already returned context

This rule exists to prevent unnecessary token consumption. Violating it wastes credits
without improving answer quality.

**Available tools:**
| Tool | When to use |
|---|---|
| \`#mrcAsk\` | **Start here.** Retrieve ranked context for any codebase question or task |
| \`#mrcSearch\` | Locate specific files when you know what you're looking for |
| \`#mrcDependencies\` | Trace the import graph outward from a given file |
| \`#mrcPattern\` | Find files implementing a design pattern (factory, repository, hook, etc.) |
| \`#mrcFile\` | Get metadata for a known file path |
${MRC_BLOCK_END}\n`;

const CONFIG_TEMPLATE = {
  repositories: [
    { url: "https://github.com/your-org/your-repo", branch: "main" },
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
};

export function initCommand(): Command {
  return new Command("init")
    .description("Scaffold .mrc/config.json and register Mr. Context in .github/copilot-instructions.md")
    .option("--force", "Overwrite existing .mrc/config.json", false)
    .action((opts) => {
      scaffoldConfig(opts.force);
      scaffoldGitignore();
      scaffoldCopilotInstructions();

      console.log();
      console.log(chalk.bold("  Next steps:"));
      console.log(chalk.gray(`  1. Edit ${CONFIG_PATH} — set each repository's url and branch`));
      console.log(chalk.gray("  2. Set the GITHUB_TOKEN env var for private repos (or configure SSH)"));
      console.log(chalk.gray("  3. Run mrc build — clones repos into .mrc/repos and builds the graph\n"));
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
  // Keep .mrc/config.json tracked; ignore the generated graph (.mrc/data/) and
  // the local clones (.mrc/repos/) — both live under .mrc.
  const mrcIgnore = resolve(process.cwd(), MRC_DIR, ".gitignore");
  if (existsSync(mrcIgnore)) {
    console.log(chalk.yellow("  skip  ") + chalk.gray(`${MRC_DIR}/.gitignore already exists`));
    return;
  }
  mkdirSync(resolve(process.cwd(), MRC_DIR), { recursive: true });
  writeFileSync(mrcIgnore, "data/\nrepos/\n", "utf-8");
  console.log(chalk.green("  create") + `  ${MRC_DIR}/.gitignore`);
}

function scaffoldCopilotInstructions(): void {
  const filePath = resolve(process.cwd(), INSTRUCTIONS_PATH);

  if (existsSync(filePath)) {
    const content = readFileSync(filePath, "utf-8");

    if (content.includes(MRC_BLOCK_START)) {
      console.log(chalk.yellow("  skip  ") + chalk.gray(`${INSTRUCTIONS_PATH} already contains Mr. Context block`));
      return;
    }

    appendFileSync(filePath, MRC_COPILOT_BLOCK, "utf-8");
    console.log(chalk.green("  append") + `  ${INSTRUCTIONS_PATH}`);
  } else {
    mkdirSync(resolve(process.cwd(), ".github"), { recursive: true });
    writeFileSync(filePath, MRC_COPILOT_BLOCK.trimStart(), "utf-8");
    console.log(chalk.green("  create") + `  ${INSTRUCTIONS_PATH}`);
  }
}
