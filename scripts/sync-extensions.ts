// Install every Suwayomi extension for the languages we read, so the source
// sweep has something to search. A fresh engine ships with none, and a manually
// curated set drifts (production had zero pt-BR sources).
//
//   npm run sync-extensions              install en + pt-BR + all
//   npm run sync-extensions -- --langs pt-BR
//   npm run sync-extensions -- --dry-run
//   npm run sync-extensions -- --nsfw    include adult-flagged extensions

import {
  listExtensions,
  fetchExtensions,
  installExtension,
  type SuwayomiExtension,
} from "../src/lib/suwayomi.ts";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const withNsfw = args.includes("--nsfw");
const langArg = args[args.indexOf("--langs") + 1];
const LANGS = new Set(
  (args.includes("--langs") && langArg ? langArg : "en,pt-BR,pt,all")
    .split(",")
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean),
);
const CONCURRENCY = 3;

function wanted(e: SuwayomiExtension): boolean {
  if (e.isInstalled || e.isObsolete) return false;
  if (e.isNsfw && !withNsfw) return false;
  return LANGS.has((e.lang || "").toLowerCase());
}

async function main() {
  console.log(`langs: ${[...LANGS].join(", ")}${withNsfw ? " (+nsfw)" : ""}`);

  await fetchExtensions().catch((e) => console.warn("refresh repo index failed:", String(e)));

  const all = await listExtensions();
  const installed = all.filter((e) => e.isInstalled);
  const todo = all.filter(wanted);

  console.log(`catalogue: ${all.length} | installed: ${installed.length} | to install: ${todo.length}`);
  if (dryRun) {
    for (const e of todo) console.log(`  would install ${e.name} (${e.lang})`);
    return;
  }
  if (!todo.length) return;

  let ok = 0;
  let failed = 0;
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < todo.length) {
        const e = todo[next++];
        try {
          await installExtension(e.pkgName);
          ok += 1;
          console.log(`  + ${e.name} (${e.lang})`);
        } catch (err) {
          failed += 1;
          console.warn(`  ! ${e.name} (${e.lang}): ${String(err).slice(0, 120)}`);
        }
      }
    }),
  );

  const after = await listExtensions().catch(() => all);
  console.log(
    `\ninstalled ${ok}, failed ${failed}, total now ${after.filter((e) => e.isInstalled).length}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
