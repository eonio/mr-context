// src/cli/commands/search.ts
import { Command } from "commander";
import chalk from "chalk";
import { loadConfig, CONFIG_PATH, GRAPH_PATH } from "../../shared/config.js";
import { loadGraph } from "../../graph/index.js";
import { queryGraph } from "../../graph/query.js";

export function searchCommand(): Command {
  return new Command("search")
    .description("Search the graph using BM25 keyword matching (no LLM required)")
    .argument("<query>", "Search query string")
    .option("-k, --top-k <number>", "Number of results to show", "10")
    .option("-c, --config <path>", `Path to ${CONFIG_PATH} file`)
    .action(async (query: string, opts) => {
      const config = loadConfig(opts.config);
      const graph = loadGraph(config.graphCachePath ?? GRAPH_PATH);

      if (!graph) {
        console.error(chalk.red("No graph found. Run `mrc build` first."));
        process.exit(1);
      }

      const topK = parseInt(opts.topK, 10);
      const nodes = await queryGraph(graph, query, topK);

      if (nodes.length === 0) {
        console.log(chalk.yellow("No results found."));
        return;
      }

      console.log(chalk.bold(`\nResults for: "${query}"\n`));
      nodes.forEach((node, i) => {
        const repo = node.repository.split("/").slice(-1)[0];
        console.log(
          chalk.cyan(`${i + 1}.`) +
            " " +
            chalk.bold(node.filePath) +
            chalk.gray(` [${repo}]`)
        );
        if (node.summary) {
          const preview =
            node.summary.length > 120
              ? node.summary.slice(0, 120) + "…"
              : node.summary;
          console.log(chalk.gray(`   ${preview}`));
        }
        if (node.exports.length > 0) {
          console.log(chalk.gray(`   exports: ${node.exports.slice(0, 5).join(", ")}`));
        }
        console.log();
      });
    });
}
