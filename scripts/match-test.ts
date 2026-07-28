// Regression cases for the title matcher. Run: npm run match-test
// Each case is (source result title, work alias set, expected accept).

import { matchScore, isMatch } from "../src/lib/backbone/normalize.ts";

type Case = [string, string[], boolean];

const CASES: Case[] = [
  // romanization variants
  ["Dai Akutou Shounen", ["Dai Akutou Shonen"], true],
  ["Dai Akutō Shōnen", ["Dai Akutou Shonen"], true],
  ["Daiakutou Shounen", ["Dai Akutou Shonen"], true],
  ["Supervillain Boy", ["Dai Akutou Shonen", "Supervillain Boy", "The Great Villainous Boy"], true],
  ["O grande garoto vilanesco", ["Dai Akutou Shonen", "O grande garoto vilanesco"], true],
  ["Shingeki no Kyojin", ["Shingeki no Kyojin", "Attack on Titan"], true],
  ["Ataque dos Titãs", ["Shingeki no Kyojin", "Attack on Titan", "Ataque dos Titans"], true],
  ["Sousou no Frieren", ["Sōsō no Furīren", "Frieren: Beyond Journey's End"], true],
  ["Jujutsu Kaisen", ["Jujutsu Kaisen"], true],
  ["Kaguya-sama wa Kokurasetai", ["Kaguya-sama: Love is War", "Kaguya-sama wa Kokurasetai"], true],
  ["Sempai ga Uzai", ["Senpai ga Uzai Kouhai no Hanashi"], true],

  // decoration / edition noise
  ["Berserk (Official Colored)", ["Berserk"], true],
  ["One Punch Man [Manga]", ["One-Punch Man"], true],
  ["Chainsaw Man - Digital Colored Comics", ["Chainsaw Man"], true],
  ["Vagabond Online Leitura", ["Vagabond"], true],
  ["Vagabond Vol. 3", ["Vagabond Volume 3"], true],
  ["Hunter x Hunter", ["HunterXHunter"], true],
  ["Zyuzyutsu Kaisen", ["Jujutsu Kaisen"], true],
  ["[Oshi no Ko]", ["Oshi no Ko", "推しの子"], true],

  // longer official title vs short romaji
  ["Demon Slayer: Kimetsu no Yaiba", ["Kimetsu no Yaiba"], true],
  ["Boku no Hero Academia", ["My Hero Academia", "Boku no Hero Academia"], true],
  ["The Beginning After the End", ["The Beginning After The End"], true],

  // must NOT match
  ["Solo Leveling: Ragnarok", ["Solo Leveling"], false],
  ["Naruto: Sasuke's Story", ["Naruto"], false],
  ["One Piece Party", ["One Piece"], false],
  ["Berserk of Gluttony", ["Berserk"], false],
  ["A Veteran Player is Needed in the Apocalypse", ["Veteran Player"], false],
  ["Tokyo Revengers", ["Tokyo Ghoul"], false],
  ["Dragon Ball Super", ["Dragon Quest"], false],
  ["Kimetsu no Yaiba: Gaiden", ["Kimetsu no Yaiba"], false],
  ["Boku no Kokoro no Yabai Yatsu", ["Boku no Hero Academia"], false],
  ["Reborn as a Vending Machine", ["Reborn!"], false],
  // franchise entries: the season is the identity, not the words
  ["Vinland Saga Part 2", ["Vinland Saga"], false],
  ["Mob Psycho 100 II", ["Mob Psycho 100"], false],
  ["Overlord 2", ["Overlord"], false],
  ["[Oshi no Ko]", ["【Solo Leveling】"], false],
  ["(Raw)", ["[Oshi no Ko]"], false],
  ["Dai Akutou Shoujo", ["Dai Akutou Shonen"], false],
  ["Bakugan", ["Bakuman"], false],
  ["Death Notice", ["Death Note"], false],
  ["Beach", ["Bleach"], false],
];

let failed = 0;
for (const [candidate, aliases, expected] of CASES) {
  const score = matchScore(candidate, aliases);
  const got = isMatch(score, candidate, aliases);
  const ok = got === expected;
  if (!ok) failed += 1;
  const mark = ok ? "ok  " : "FAIL";
  console.log(
    `${mark} ${score.toFixed(3)} ${expected ? "accept" : "reject"} | ${candidate} <> ${aliases[0]}`,
  );
}

console.log(`\n${CASES.length - failed}/${CASES.length} passed`);
if (failed) process.exit(1);
