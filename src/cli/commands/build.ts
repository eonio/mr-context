// src/cli/commands/build.ts
import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { loadConfig, CONFIG_PATH, GRAPH_PATH } from "../../shared/config.js";
import { extractRepositories } from "../../extraction/index.js";
import { buildSyntacticGraph } from "../../graph/builder.js";
import { saveGraph, loadGraph } from "../../graph/index.js";

export function buildCommand(): Command {
  return new Command("build")
    .description("Build or refresh the semantic graph for all configured repositories")
    .option("-f, --force", "Force rebuild, ignoring cache", false)
    .option("-c, --config <path>", `Path to ${CONFIG_PATH} file`)
    .option("-v, --verbose", "Show detailed output", false)
    .action(async (opts) => {
      const config = loadConfig(opts.config);

      if (config.repositories.length === 0) {
        console.error(
          chalk.red("No repositories configured.") +
          ` Create a ${CONFIG_PATH} file or set MRC_REPOS.`
        );
        process.exit(1);
      }

      const cachePath = config.graphCachePath ?? GRAPH_PATH;

      if (!opts.force) {
        const cached = loadGraph(cachePath);
        if (cached) {
          const age = Math.round((Date.now() - new Date(cached.builtAt).getTime()) / 60000);
          console.log(chalk.yellow(`Existing graph found`) + chalk.gray(` (${age}m ago). Use --force to rebuild.`));
          console.log(chalk.gray(`  ${cached.nodes.length} nodes, ${cached.edges.length} edges`));
          return;
        }
      }

      console.log(chalk.bold.cyan("\n  Mr. Context") + chalk.gray(` — indexing ${config.repositories.length} repo(s)\n`));

      const spinner = ora("Extracting repositories…").start();
      const t0 = Date.now();

      try {
        const { files, metadata } = await extractRepositories(config);
        spinner.succeed(chalk.green(`${files.length} files extracted`) + chalk.gray(` (${metadata.length} repos)`));

        if (opts.verbose) {
          metadata.forEach((m) => console.log(chalk.gray(`  ${m.owner}/${m.name}: ${m.language ?? "mixed"}`)));
        }

        spinner.text = "Building semantic graph…";
        spinner.start();
        const graph = buildSyntacticGraph(files, metadata);
        saveGraph(graph, cachePath);

        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        spinner.succeed(chalk.green(`Graph built in ${elapsed}s`) + chalk.gray(` — ${graph.nodes.length} nodes, ${graph.edges.length} edges`));

        console.log(chalk.bold.cyan("\n  Mr. Context at your service."));
        console.log(chalk.gray(`  ${graph.repositories.length} repositories indexed · ${graph.nodes.length} nodes · ready.\n`));
        console.log(chalk.yellow("  Note: Semantic enrichment runs automatically in the VS Code extension.\n"));

      } catch (err) {
        spinner.fail(chalk.red("Build failed: " + (err as Error).message));
        if (opts.verbose) console.error(err);
        process.exit(1);
      }
    });
}
