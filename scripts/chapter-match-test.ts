// Regression cases for the cross-source chapter matcher. Run: npm run chapter-match-test
// Each case is (target chapter, candidate chapter from another source, expected match).

import { matchScore, findChapterMatch, type MatchChapter } from "../src/lib/chapterMatch.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2024, 0, 10, 12, 0, 0);
const at = (ms: number) => String(T0 + ms);

type Case = [string, MatchChapter, MatchChapter, boolean];

const CASES: Case[] = [
  [
    "same number, different label",
    { id: 1, name: "Chapter 5", chapterNumber: 5 },
    { id: 2, name: "Cap. 5", chapterNumber: 5 },
    true,
  ],
  [
    "different numbers, same upload date",
    { id: 1, name: "Chapter 5", chapterNumber: 5, uploadDate: at(0) },
    { id: 2, name: "Chapter 6", chapterNumber: 6, uploadDate: at(0) },
    false,
  ],
  [
    "no number, same name",
    { id: 1, name: "Ato Final", chapterNumber: 0 },
    { id: 2, name: "ato final", chapterNumber: 0 },
    true,
  ],
  [
    "number only in the name",
    { id: 1, name: "Capítulo 12", chapterNumber: 0 },
    { id: 2, name: "Ch. 12", chapterNumber: 12 },
    true,
  ],
  [
    "same number and subtitle",
    { id: 1, name: "Capítulo 7 – O Retorno", chapterNumber: 7 },
    { id: 2, name: "Chapter 7: O Retorno", chapterNumber: 7 },
    true,
  ],
  [
    "no number, different names, 2h apart",
    { id: 1, name: "Extra", chapterNumber: 0, uploadDate: at(0) },
    { id: 2, name: "Bônus", chapterNumber: 0, uploadDate: at(2 * HOUR) },
    true,
  ],
  [
    "no number, different names, 3 days apart",
    { id: 1, name: "Extra", chapterNumber: 0, uploadDate: at(0) },
    { id: 2, name: "Bônus", chapterNumber: 0, uploadDate: at(3 * DAY) },
    false,
  ],
  [
    "season numbering against straight numbering",
    { id: 1, name: "Temporada 2 Capítulo 1", chapterNumber: 2 },
    { id: 2, name: "Temporada 2 Capítulo 1", chapterNumber: 26 },
    true,
  ],
  [
    "nothing to compare",
    { id: 1, name: "", chapterNumber: 0 },
    { id: 2, name: "", chapterNumber: 0 },
    false,
  ],
  [
    "same decimal number",
    { id: 1, name: "Chapter 10.5", chapterNumber: 10.5 },
    { id: 2, name: "Cap 10.5", chapterNumber: 10.5 },
    true,
  ],
  [
    "decimal against its integer",
    { id: 1, name: "Chapter 10.5", chapterNumber: 10.5 },
    { id: 2, name: "Chapter 10", chapterNumber: 10 },
    false,
  ],
];

let failed = 0;
for (const [label, target, candidate, expected] of CASES) {
  const score = matchScore(target, candidate);
  const got = findChapterMatch(target, [candidate]) !== null;
  const ok = got === expected;
  if (!ok) failed += 1;
  const mark = ok ? "ok  " : "FAIL";
  console.log(
    `${mark} ${score.toFixed(2)} ${expected ? "match " : "reject"} | ${label}: ${target.name} <> ${candidate.name}`,
  );
}

console.log(`\n${CASES.length - failed}/${CASES.length} passed`);
if (failed) process.exit(1);
