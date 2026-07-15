// Server-side fetch helpers for native scrapers. Tries a direct fetch first,
// then falls back to FlareSolverr (real Chromium) on failure when
// FLARESOLVERR_URL is set, for 403 WAF, datacenter-IP block, or CF challenge.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

const TIMEOUT = 20_000;
const FLARE = process.env.FLARESOLVERR_URL || "";
const FLARE_TIMEOUT = 60_000;

function baseHeaders(referer?: string): Record<string, string> {
  const h: Record<string, string> = {
    "User-Agent": UA,
    Accept: "text/html,application/xhtml+xml,application/json,*/*",
    "Accept-Language": "en-US,en;q=0.9,pt-BR;q=0.8",
  };
  if (referer) h["Referer"] = referer;
  return h;
}

// FlareSolverr wraps non-HTML bodies (e.g. admin-ajax JSON) in
// <html>…<pre>PAYLOAD</pre>…</html>. Unwrap so callers can JSON.parse.
function unwrapPre(html: string): string {
  const m = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
  if (!m) return html;
  return m[1]
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");
}

async function flareSolve(
  cmd: "request.get" | "request.post",
  url: string,
  postData?: string,
): Promise<string> {
  if (!FLARE) throw new Error("flaresolverr_disabled");
  const body: Record<string, unknown> = { cmd, url, maxTimeout: FLARE_TIMEOUT };
  if (postData !== undefined) body.postData = postData;
  const res = await fetch(`${FLARE}/v1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = (await res.json()) as {
    status?: string;
    solution?: { response?: string; status?: number };
  };
  if (json.status !== "ok" || !json.solution?.response) {
    throw new Error("flaresolverr_failed");
  }
  return unwrapPre(json.solution.response);
}

export async function getText(url: string, referer?: string): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      headers: baseHeaders(referer ?? url),
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    return await res.text();
  } catch (e) {
    if (FLARE) return flareSolve("request.get", url);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export async function postForm(
  url: string,
  form: Record<string, string>,
  referer?: string,
): Promise<string> {
  const encoded = new URLSearchParams(form).toString();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        ...baseHeaders(referer ?? url),
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: encoded,
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`POST ${url} -> ${res.status}`);
    return await res.text();
  } catch (e) {
    if (FLARE) return flareSolve("request.post", url, encoded);
    throw e;
  } finally {
    clearTimeout(t);
  }
}
