// Install every Suwayomi extension for the languages we read, so the source
// sweep has something to search. A fresh engine ships with none, and a manually
// curated set drifts (production had zero pt-BR sources).
//
//   npm run sync-extensions              install en + pt-BR, no adult sources
//   npm run sync-extensions -- --langs pt-BR
//   npm run sync-extensions -- --dry-run
//   npm run sync-extensions -- --nsfw    include adult-flagged extensions

import {
  listExtensions,
  fetchExtensions,
  installExtension,
  uninstallExtension,
  type SuwayomiExtension,
} from "../src/lib/suwayomi.ts";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
// Removes installed extensions outside the wanted set, so tightening the filter
// actually shrinks the sweep instead of only affecting the next install.
const prune = args.includes("--prune");
// Adult sources are opt-in: the content policy blocks their works from ever
// rendering, so installing them only adds engine load. They were 376 of the 633
// sources the sweep searched, and that backlog is what stalled the engine.
const withNsfw = args.includes("--nsfw");
const langArg = args[args.indexOf("--langs") + 1];
const LANGS = new Set(
  (args.includes("--langs") && langArg ? langArg : "en,pt-BR,pt")
    .split(",")
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean),
);
const CONCURRENCY = 3;

function inScope(e: SuwayomiExtension): boolean {
  if (e.isNsfw && !withNsfw) return false;
  return LANGS.has((e.lang || "").toLowerCase());
}

function wanted(e: SuwayomiExtension): boolean {
  if (e.isInstalled || e.isObsolete) return false;
  return inScope(e);
}

async function run(
  label: string,
  items: SuwayomiExtension[],
  fn: (pkgName: string) => Promise<void>,
): Promise<number> {
  let ok = 0;
  let failed = 0;
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < items.length) {
        const e = items[next++];
        try {
          await fn(e.pkgName);
          ok += 1;
          console.log(`  ${label} ${e.name} (${e.lang})`);
        } catch (err) {
          failed += 1;
          console.warn(`  ! ${e.name} (${e.lang}): ${String(err).slice(0, 120)}`);
        }
      }
    }),
  );
  if (failed) console.warn(`  ${failed} failed`);
  return ok;
}

async function main() {
  console.log(`langs: ${[...LANGS].join(", ")}${withNsfw ? " (+nsfw)" : " (sfw only)"}`);

  await fetchExtensions().catch((e) => console.warn("refresh repo index failed:", String(e)));

  const all = await listExtensions();
  const installed = all.filter((e) => e.isInstalled);
  const todo = all.filter(wanted);
  const stale = prune ? installed.filter((e) => !inScope(e)) : [];

  console.log(
    `catalogue: ${all.length} | installed: ${installed.length} | to install: ${todo.length} | to remove: ${stale.length}`,
  );
  if (dryRun) {
    for (const e of todo) console.log(`  would install ${e.name} (${e.lang})`);
    for (const e of stale) console.log(`  would remove ${e.name} (${e.lang})`);
    return;
  }

  const removed = stale.length ? await run("-", stale, uninstallExtension) : 0;
  const added = todo.length ? await run("+", todo, installExtension) : 0;

  const after = await listExtensions().catch(() => all);
  console.log(
    `\ninstalled ${added}, removed ${removed}, total now ${after.filter((e) => e.isInstalled).length}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
