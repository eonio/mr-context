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
## Mr. Context — Multi-Repository Semantic Graph

This workspace uses [Mr. Context](https://github.com/eonio/mr-context) to index repositories
into a semantic graph that captures exports, imports, dependencies, and design patterns.

**Call \`#mrcAsk\` (or \`@mrc\`) before answering questions about:**
- Where specific functionality lives across repositories
- How files, modules, or services relate to each other
- What a file exports or imports
- Which design patterns are in use

Prefer graph results over guessing. Cite file paths from the graph — never invent paths.

**Available tools:**
| Tool | When to use |
|---|---|
| \`#mrcAsk\` | Retrieve ranked context for a natural-language question |
| \`#mrcSearch\` | Locate files relevant to a query across all indexed repos |
| \`#mrcDependencies\` | Trace the import graph outward from a given file |
| \`#mrcPattern\` | Find files implementing a design pattern (factory, repository, etc.) |
| \`#mrcFile\` | Get metadata for a known file path |
${MRC_BLOCK_END}\n`;

const CONFIG_TEMPLATE = {
  repositories: [] as string[],
  branch: "main",
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
      scaffoldCopilotInstructions();

      console.log();
      console.log(chalk.bold("  Next steps:"));
      console.log(chalk.gray(`  1. Edit ${CONFIG_PATH} and add your repository URLs`));
      console.log(chalk.gray("  2. Set the GITHUB_TOKEN env var (or run: gh auth token)"));
      console.log(chalk.gray("  3. Run mrc build\n"));
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
