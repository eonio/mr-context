// scripts/test-extraction.ts
// Run: npx tsx scripts/test-extraction.ts
import { extractRepositories } from "../src/extraction/index.js";
import { loadConfig } from "../src/shared/config.js";

async function main() {
  const config = loadConfig();

  if (config.repositories.length === 0) {
    console.error(
      "No repositories configured. Create a .mrc/config.json file or set MRC_REPOS."
    );
    process.exit(1);
  }

  console.log(`Extracting ${config.repositories.length} repository/repositories...\n`);
  const t0 = Date.now();

  const { files, metadata } = await extractRepositories(config);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`Done in ${elapsed}s`);
  console.log(`Files extracted: ${files.length}`);
  console.log(`Repositories:    ${metadata.length}`);

  console.log("\nRepository details:");
  metadata.forEach((m) => {
    console.log(
      `  ${m.owner}/${m.name}  language=${m.language ?? "mixed"}  files=${m.fileCount}`
    );
  });

  console.log("\nSample files (first 10):");
  files.slice(0, 10).forEach((f) => {
    console.log(`  ${f.path}  (${f.size}b, ${f.language})`);
  });

  const byLang = files.reduce<Record<string, number>>((acc, f) => {
    acc[f.language] = (acc[f.language] ?? 0) + 1;
    return acc;
  }, {});
  console.log("\nFiles by language:");
  Object.entries(byLang)
    .sort(([, a], [, b]) => b - a)
    .forEach(([lang, count]) => console.log(`  ${lang}: ${count}`));
}

main().catch(console.error);
