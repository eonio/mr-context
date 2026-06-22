// src/cli/commands/build.ts
import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { loadConfig, resolveRepos, multiRepoIssue, CONFIG_PATH, GRAPH_PATH } from "../../shared/config.js";
import { extractRepositories } from "../../extraction/index.js";
import { enrichWithRepomix } from "../../extraction/repomix.js";
import { buildSyntacticGraph } from "../../graph/builder.js";
import { saveGraph, loadGraph } from "../../graph/index.js";
import { updateClonesGitignore } from "../../shared/gitignore.js";

export function buildCommand(): Command {
  return new Command("build")
    .description("Build or refresh the semantic graph for all configured repositories")
    .option("-f, --force", "Force rebuild, ignoring cache", false)
    .option("-c, --config <path>", `Path to ${CONFIG_PATH} file`)
    .option("-v, --verbose", "Show detailed output", false)
    .action(async (opts) => {
      const config = loadConfig(opts.config);

      // Hard multi-repo gate — never clone/build for a single repo or monorepo.
      const issue = multiRepoIssue(config);
      if (issue) {
        console.error(chalk.red("  ⛔ ") + chalk.yellow(issue));
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

      const spinner = ora("Cloning repositories…").start();
      const t0 = Date.now();

      try {
        const { files, metadata } = await extractRepositories(config);
        const dirtyCount = metadata.filter((m) => m.dirty).length;
        const suffix = dirtyCount > 0 ? `, ${dirtyCount} dirty (preserved)` : "";
        spinner.succeed(chalk.green(`${files.length} files extracted`) + chalk.gray(` (${metadata.length} repos${suffix})`));

        // Keep sibling clones out of the workspace repo (idempotent managed block).
        const cloneNames = resolveRepos(config).map((r) => r.name);
        if (updateClonesGitignore(process.cwd(), cloneNames)) {
          console.log(chalk.gray("  updated .gitignore (clone folders)"));
        }

        if (opts.verbose) {
          metadata.forEach((m) =>
            console.log(chalk.gray(`  ${m.owner}/${m.name}@${m.branch}: ${m.fileCount} files`) + (m.dirty ? chalk.dim(" (dirty — preserved)") : ""))
          );
        }

        // A dirty clone is indexed at its checked-out branch, not the config one.
        const resolved = resolveRepos(config);
        for (const m of metadata.filter((r) => r.dirty)) {
          const configured = resolved.find((r) => r.url === m.url)?.branch;
          if (configured && m.branch && configured !== m.branch) {
            console.log(
              chalk.yellow("  ⚠ ") +
              chalk.yellow(`${m.owner}/${m.name} has uncommitted changes on "${m.branch}" but config requests "${configured}".`) +
              chalk.gray(` Indexed the checked-out branch — commit/stash or update config to match.`)
            );
          }
        }

        spinner.text = "Building semantic graph…";
        spinner.start();
        const graph = await buildSyntacticGraph(files, metadata);
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        spinner.succeed(chalk.green(`Graph built in ${elapsed}s`) + chalk.gray(` — ${graph.nodes.length} nodes, ${graph.edges.length} edges`));

        // Deterministic enrichment via repomix (--compress signatures + packed
        // artifacts). No LLM. Skipped when config.repomix === false.
        if (config.repomix !== false) {
          spinner.text = "Enriching with repomix (signatures + packed artifacts)…";
          spinner.start();
          try {
            const r = await enrichWithRepomix(graph, config);
            spinner.succeed(
              chalk.green(`repomix: ${r.reposPacked}/${graph.repositories.length} repos packed`) +
              chalk.gray(` — ${r.nodesEnriched} nodes signed, ~${r.totalTokens.toLocaleString()} tokens`)
            );
          } catch (err) {
            spinner.warn(chalk.yellow(`repomix enrichment skipped: ${(err as Error).message}`));
          }
        }

        saveGraph(graph, cachePath);

        console.log(chalk.bold.cyan("\n  Mr. Context at your service."));
        console.log(chalk.gray(`  ${graph.repositories.length} repositories indexed · ${graph.nodes.length} nodes · ready.\n`));
        console.log(chalk.yellow("  Open VS Code to run semantic embeddings/summaries via the extension.\n"));

      } catch (err) {
        spinner.fail(chalk.red("Build failed: " + (err as Error).message));
        if (opts.verbose) console.error(err);
        process.exit(1);
      }
    });
}
