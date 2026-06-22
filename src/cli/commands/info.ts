// src/cli/commands/info.ts
import { Command } from "commander";
import chalk from "chalk";
import { loadConfig, resolveRepos, multiRepoIssue, CONFIG_PATH, GRAPH_PATH } from "../../shared/config.js";
import { loadGraph } from "../../graph/index.js";

export function infoCommand(): Command {
  return new Command("info")
    .description("Show configuration and graph statistics")
    .option("-c, --config <path>", `Path to ${CONFIG_PATH} file`)
    .action((opts) => {
      const config = loadConfig(opts.config);

      console.log(chalk.bold("\nMr. Context Configuration\n"));
      console.log(chalk.gray("  Repositories:"));
      const repos = resolveRepos(config);
      if (repos.length === 0) {
        console.log(chalk.yellow("    (none configured)"));
      } else {
        repos.forEach((r) =>
          console.log(chalk.gray(`    • ${r.url} `) + chalk.dim(`@${r.branch}`))
        );
      }
      console.log(chalk.gray(`\n  Max nodes:    ${config.maxContextNodes ?? 25}`));
      console.log(chalk.gray(`  Graph cache:  ${config.graphCachePath ?? GRAPH_PATH}`));
      console.log(
        chalk.gray(
          `  Auth:         ${config.githubToken ? "GitHub token configured" : "no token (public repos only)"}`
        )
      );

      // Multi-repo gate — show the rule loudly and stop before graph stats.
      const issue = multiRepoIssue(config);
      if (issue) {
        console.log("\n" + chalk.red("  ⛔ ") + chalk.yellow(issue) + "\n");
        return;
      }

      const graph = loadGraph(config.graphCachePath ?? GRAPH_PATH);
      if (graph) {
        const age = Math.round(
          (Date.now() - new Date(graph.builtAt).getTime()) / 60000
        );
        const enriched = graph.nodes.filter((n) => n.summary).length;
        console.log(chalk.bold("\nGraph Statistics\n"));
        console.log(chalk.gray(`  Nodes:        ${graph.nodes.length}`));
        console.log(chalk.gray(`  Edges:        ${graph.edges.length}`));
        console.log(
          chalk.gray(`  Enriched:     ${enriched}/${graph.nodes.length} nodes have summaries`)
        );
        console.log(chalk.gray(`  Built:        ${graph.builtAt} (${age}m ago)`));
        console.log(chalk.gray("  Repositories:"));
        graph.repositories.forEach((r) =>
          console.log(
            chalk.gray(`    • ${r.owner}/${r.name} — ${r.language ?? "mixed"}, ${r.fileCount} files`)
          )
        );
      } else {
        console.log(chalk.yellow("\nNo graph cache found. Run `mrc build` first."));
      }
      console.log();
    });
}
