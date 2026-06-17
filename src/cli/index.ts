#!/usr/bin/env node
// src/cli/index.ts
import { Command } from "commander";
import chalk from "chalk";
import { buildCommand } from "./commands/build.js";
import { infoCommand } from "./commands/info.js";
import { searchCommand } from "./commands/search.js";

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
  ${chalk.gray("# Index configured repositories into a semantic graph")}
  mrc build

  ${chalk.gray("# Search the graph (BM25, no LLM required)")}
  mrc search "how does payment routing work"

  ${chalk.gray("# Show configuration and graph statistics")}
  mrc info

  ${chalk.gray("# Force a full rebuild")}
  mrc build --force
`
  );

program.addCommand(buildCommand());
program.addCommand(infoCommand());
program.addCommand(searchCommand());

program.parse(process.argv);
