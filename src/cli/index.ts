#!/usr/bin/env node
// src/cli/index.ts
import { Command } from "commander";
import chalk from "chalk";
import { buildCommand } from "./commands/build.js";
import { initCommand } from "./commands/init.js";
import { infoCommand } from "./commands/info.js";
import { searchCommand } from "./commands/search.js";
import { extensionCommand } from "./commands/extension.js";

const VERSION = "1.0.0";

const program = new Command();

program
  .name("mrc")
  .description(
    chalk.cyan("Mr. Context") +
      " — Multi-Repository Context Agent\n" +
      chalk.gray("  https://github.com/eonio/mr-context")
  )
  .version(VERSION)
  .addHelpText(
    "after",
    `
${chalk.bold("Examples:")}
  ${chalk.gray("# Scaffold config and register Mr. Context with Copilot")}
  mrc init

  ${chalk.gray("# Index configured repositories into a semantic graph")}
  mrc build

  ${chalk.gray("# Search the graph (BM25, no LLM required)")}
  mrc search "how does payment routing work"

  ${chalk.gray("# Show configuration and graph statistics")}
  mrc info

  ${chalk.gray("# Force a full rebuild")}
  mrc build --force

  ${chalk.gray("# Build + (re)install the VS Code extension from latest source")}
  mrc extension update
`
  );

program.addCommand(initCommand());
program.addCommand(buildCommand());
program.addCommand(infoCommand());
program.addCommand(searchCommand());
program.addCommand(extensionCommand());

program.parse(process.argv);
