// Bench a solver against the real source list. Verdict uses the same challenge
// heuristic as the app, so a returned interstitial never counts as a solve.
//   node scripts/solver-bench.mjs [http://127.0.0.1:8191] [concurrency] [scrape]
//
// The third argument picks trawl's native /scrape route with skipHttp, which
// skips the tier-1 plain fetch. That tier answers with only the first 4 KB of
// the body, so a page that "passes" through it still parses as empty.

const SOLVER = process.argv[2] ?? "http://127.0.0.1:8191";
const CONCURRENCY = Number(process.argv[3] ?? 2);
const MODE = process.argv[4] ?? "v1";
const BUDGET_MS = 60_000;

const TARGETS = [
  ["comick", "https://comick.io/search?q=solo+leveling"],
  ["mangalivre", "https://mangalivre.to/?s=solo&post_type=wp-manga"],
  ["toonily", "https://toonily.com/search/solo/"],
  ["manhuaus", "https://manhuaus.com/?s=solo&post_type=wp-manga"],
  ["natomanga", "https://www.natomanga.com/search/story/solo_leveling"],
  ["mangakakalot", "https://www.mangakakalot.gg/search/story/solo_leveling"],
  ["setsuscans", "https://setsuscans.com/?s=solo"],
  ["valirscans", "https://valirscans.com/?s=solo"],
  ["readcomicsonline", "https://readcomicsonline.ru/search?query=batman"],
  ["brainrotcomics", "https://brainrotcomics.com/?s=solo"],
  ["boratscans", "https://boratscans.com/?s=solo"],
  ["dragontea", "https://dragontea.ink/?s=solo&post_type=wp-manga"],
  ["luratoons", "https://luratoons.net/?s=solo"],
  ["batcave", "https://batcave.biz/search/batman/"],
  // The api.* subdomains of these two sit behind a stricter WAF than the site
  // itself and answer 403 to everything, which reads as a block that isn't one.
  ["luacomic", "https://luacomic.org/?s=solo"],
  ["frieren", "https://www.frieren.online/?s=solo"],
  ["housesaikai", "https://housesaikai.net/?s=solo"],
  // toonlivre.net redirects to www.mangalivre.net, which is NXDOMAIN; the live
  // destination is the same host without the www.
  ["toonlivre", "https://mangalivre.net/"],
  ["risentoons", "https://risentoons.xyz/?s=solo"],
  ["mangastop", "https://mangastop.net/?s=solo"],
];

const CHALLENGE_TITLES =
  /<title>[^<]*(just a moment|um momento|un instant|un momento|einen augenblick|even geduld|attention required|checking your browser|silahkan tunggu|请稍候|잠시만)/i;
const CHALLENGE_MARKERS =
  /cf-browser-verification|id="challenge-form"|cf-challenge-running|_cf_chl_opt|Enable JavaScript and cookies to continue/i;

function looksLikeChallenge(body) {
  const head = body.slice(0, 4_000);
  const trimmed = head.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return false;
  return CHALLENGE_TITLES.test(head) || CHALLENGE_MARKERS.test(head);
}

function unwrapPre(html) {
  const m = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
  if (!m) return html;
  return m[1]
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");
}

async function call(url) {
  if (MODE === "scrape") {
    const res = await fetch(`${SOLVER}/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, maxTimeout: BUDGET_MS, skipHttp: true }),
      signal: AbortSignal.timeout(BUDGET_MS + 30_000),
    });
    if (!res.ok) return { fail: `solver_${res.status}` };
    const j = await res.json();
    if (typeof j.html !== "string") return { fail: (j.error ?? "scrape_failed").slice(0, 120) };
    return { html: j.html, code: j.statusCode ?? 0, tier: j.tier };
  }
  const res = await fetch(`${SOLVER}/v1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cmd: "request.get", url, maxTimeout: BUDGET_MS }),
    signal: AbortSignal.timeout(BUDGET_MS + 20_000),
  });
  if (!res.ok) return { fail: `solver_${res.status}` };
  const j = await res.json();
  if (j.status !== "ok" || !j.solution?.response) {
    return { fail: (j.message ?? "solver_failed").slice(0, 120) };
  }
  return { html: unwrapPre(j.solution.response), code: j.solution.status ?? 0 };
}

async function probe(name, url) {
  const t0 = Date.now();
  try {
    const out = await call(url);
    const ms = Date.now() - t0;
    if (out.fail) return { name, url, ms, verdict: "FALHA", why: out.fail };

    const { html, code, tier } = out;
    const kb = Math.round(html.length / 1024);
    if (looksLikeChallenge(html)) {
      return { name, url, ms, code, kb, verdict: "DESAFIO", why: "interstitial devolvido" };
    }
    if (code === 403 || code === 503) {
      return { name, url, ms, code, kb, verdict: "BLOQUEIO", why: `http ${code}` };
    }
    // Tier 1 hands back a 4 KB preview of the body, so a page that fits that
    // ceiling exactly came back cut and parses as empty downstream.
    if (tier === 1 && html.length >= 4_000) {
      return { name, url, ms, code, kb, verdict: "TRUNCADO", why: `${html.length}b de preview` };
    }
    if (html.length < 1024) {
      return { name, url, ms, code, kb, verdict: "VAZIO", why: `${html.length} bytes` };
    }
    const links = (html.match(/<a\s[^>]*href=/gi) ?? []).length;
    if (links < 5) {
      return { name, url, ms, code, kb, verdict: "SEM-CONTEUDO", why: `${links} links` };
    }
    return {
      name,
      url,
      ms,
      code,
      kb,
      verdict: code >= 400 ? "PASSOU-CF" : "PASSOU",
      why: `http ${code}, ${links} links`,
    };
  } catch (e) {
    return { name, url, ms: Date.now() - t0, verdict: "FALHA", why: String(e.message ?? e).slice(0, 120) };
  }
}

const queue = [...TARGETS];
const results = [];

async function worker() {
  for (;;) {
    const item = queue.shift();
    if (!item) return;
    const r = await probe(item[0], item[1]);
    results.push(r);
    const tag = `${r.verdict}`.padEnd(9);
    console.log(`${tag} ${r.name.padEnd(18)} ${String(r.ms).padStart(6)}ms  ${r.kb ?? "-"}kb  ${r.why}`);
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const ok = results.filter((r) => r.verdict.startsWith("PASSOU"));
console.log(`\n== ${ok.length}/${results.length} passaram pela Cloudflare ==`);
for (const r of results.filter((x) => !x.verdict.startsWith("PASSOU"))) {
  console.log(`  ${r.verdict.padEnd(9)} ${r.name.padEnd(18)} ${r.why}`);
}
