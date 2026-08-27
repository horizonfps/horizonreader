// Cache-first service worker for cover and page images, plus the offline shelf:
// chapters the user saved into the device and the fallback page that answers
// every navigation when the server is unreachable.
// Bump VERSION to force old clients onto a fresh image cache.
const VERSION = "v2";
const IMG_CACHE = `hr-img-${VERSION}`;
const OFFLINE_CACHE = "hr-offline-v1"; // user-saved content, never version-pruned
const INDEX_URL = "/__offline/index.json";
const MAX_ENTRIES = 900;

const CACHEABLE_PATHS = new Set(["/api/cover", "/api/image"]);

const OFFLINE_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#000000" />
<title>Salvos no aparelho</title>
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="icon" href="/icon-192.png" />
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #000; color: #f5f5f5; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
    min-height: 100vh;
  }
  #app { max-width: 48rem; margin: 0 auto; padding: 1.25rem 1rem 3rem; }
  h1 { font-size: 1.125rem; font-weight: 600; margin: 0; }
  .sub { color: #8a8a8a; font-size: 0.75rem; margin: 0.35rem 0 0; }
  h2 { font-size: 0.75rem; font-weight: 600; text-transform: uppercase;
       letter-spacing: 0.06em; color: #8a8a8a; margin: 2rem 0 0.75rem; }
  ul { list-style: none; margin: 1.25rem 0 0; padding: 0; }
  li { background: #111; border: 1px solid #1f1f1f; border-radius: 0.9rem;
       padding: 0.85rem 0.9rem; margin-bottom: 0.6rem; }
  .work { font-size: 0.9rem; font-weight: 500; word-break: break-word; }
  .chapter { font-size: 0.8rem; color: #b9b9b9; margin-top: 0.15rem; word-break: break-word; }
  .pages { font-size: 0.7rem; color: #7a7a7a; margin-top: 0.2rem; }
  .row { display: flex; gap: 0.5rem; margin-top: 0.7rem; }
  button { font: inherit; font-size: 0.75rem; color: #f5f5f5; background: #232323;
           border: 0; border-radius: 0.6rem; padding: 0.45rem 0.85rem; cursor: pointer; }
  button:disabled { opacity: 0.55; cursor: default; }
  button.primary { background: #f5f5f5; color: #000; }
  .empty { color: #8a8a8a; font-size: 0.85rem; margin-top: 1.25rem; line-height: 1.5; }
  .reader { padding: 0; max-width: 48rem; margin: 0 auto; }
  .reader img { display: block; width: 100%; height: auto; }
  .backbar { position: fixed; top: 0; left: 0; right: 0; z-index: 10;
             background: rgba(0,0,0,0.72); backdrop-filter: blur(8px);
             padding: 0.6rem 0.9rem; }
  .backbar button { background: rgba(255,255,255,0.15); }
  .spacer { height: 3rem; }
</style>
</head>
<body>
<main id="app"></main>
<script>
(function () {
  var OFFLINE_CACHE = "hr-offline-v1";
  var INDEX_URL = "/__offline/index.json";
  var app = document.getElementById("app");
  var objectUrls = [];

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function formatBytes(n) {
    if (!n || n < 0) return "0 MB";
    var mb = n / 1048576;
    if (mb < 1024) return (mb < 10 ? mb.toFixed(1) : Math.round(mb)) + " MB";
    return (mb / 1024).toFixed(1) + " GB";
  }

  function openCache() {
    return caches.open(OFFLINE_CACHE);
  }

  function readIndex(cache) {
    return cache.match(INDEX_URL).then(function (res) {
      return res ? res.json() : [];
    }).then(function (list) {
      return Array.isArray(list) ? list : [];
    }).catch(function () {
      return [];
    });
  }

  function writeIndex(cache, list) {
    return cache.put(
      INDEX_URL,
      new Response(JSON.stringify(list), { headers: { "content-type": "application/json" } })
    );
  }

  function releaseObjectUrls() {
    objectUrls.forEach(function (u) { URL.revokeObjectURL(u); });
    objectUrls = [];
  }

  function usageLine(node) {
    if (!navigator.storage || !navigator.storage.estimate) return;
    navigator.storage.estimate().then(function (est) {
      if (!est || !est.usage) return;
      var text = formatBytes(est.usage) + " usados";
      if (est.quota) text += " de " + formatBytes(est.quota) + " disponíveis";
      node.textContent = text;
    }).catch(function () {});
  }

  async function removeItem(chapterId) {
    var cache = await openCache();
    var list = await readIndex(cache);
    var target = null;
    var rest = [];
    list.forEach(function (item) {
      if (item && item.chapterId === chapterId && !target) target = item;
      else rest.push(item);
    });
    if (target) {
      var keep = {};
      rest.forEach(function (item) {
        (item && item.urls ? item.urls : []).forEach(function (u) { keep[u] = true; });
      });
      var urls = target.urls || [];
      for (var i = 0; i < urls.length; i++) {
        if (!keep[urls[i]]) await cache.delete(urls[i]);
      }
    }
    await writeIndex(cache, rest);
    render();
  }

  async function saveFromServer(chapterId, button) {
    button.disabled = true;
    button.textContent = "Salvando…";
    var data = null;
    try {
      var res = await fetch("/api/download/pages?chapterId=" + chapterId, {
        credentials: "same-origin",
      });
      if (res.ok) data = await res.json();
    } catch (err) {
      data = null;
    }
    var urls = data && Array.isArray(data.urls) ? data.urls : [];
    if (!urls.length) {
      button.textContent = "Falhou · tentar de novo";
      button.disabled = false;
      return;
    }
    var cache = await openCache();
    var stored = 0;
    for (var i = 0; i < urls.length; i++) {
      try {
        await cache.add(urls[i]);
        stored += 1;
      } catch (err) { /* keep going, a dropped page must not lose the chapter */ }
      button.textContent = "Salvando " + (i + 1) + "/" + urls.length;
    }
    if (!stored) {
      button.textContent = "Falhou · tentar de novo";
      button.disabled = false;
      return;
    }
    var list = await readIndex(cache);
    list = list.filter(function (item) { return !item || item.chapterId !== data.chapterId; });
    list.push({
      chapterId: data.chapterId,
      chapterName: data.chapterName,
      workTitle: data.workTitle,
      workSlug: data.workSlug,
      urls: urls,
      savedAt: Date.now(),
    });
    await writeIndex(cache, list);
    render();
  }

  async function openReader(item) {
    releaseObjectUrls();
    app.textContent = "";
    var bar = el("div", "backbar");
    var back = el("button", null, "‹ voltar");
    back.addEventListener("click", function () {
      releaseObjectUrls();
      render();
    });
    bar.appendChild(back);
    var wrap = el("div", "reader");
    wrap.appendChild(el("div", "spacer"));
    app.appendChild(bar);
    app.appendChild(wrap);
    window.scrollTo(0, 0);

    var urls = item.urls || [];
    for (var i = 0; i < urls.length; i++) {
      var res = null;
      try {
        res = await caches.match(urls[i]);
      } catch (err) {
        res = null;
      }
      if (!res) continue;
      var blob = await res.blob().catch(function () { return null; });
      if (!blob) continue;
      var objectUrl = URL.createObjectURL(blob);
      objectUrls.push(objectUrl);
      var img = document.createElement("img");
      img.src = objectUrl;
      img.alt = "";
      wrap.appendChild(img);
    }
  }

  function chapterCard(item, onRead, onDelete) {
    var li = document.createElement("li");
    li.appendChild(el("div", "work", item.workTitle || "Sem obra"));
    li.appendChild(el("div", "chapter", item.chapterName || "Capítulo"));
    var count = (item.urls || []).length;
    li.appendChild(el("div", "pages", count + (count === 1 ? " página" : " páginas")));
    var row = el("div", "row");
    if (onRead) {
      var read = el("button", "primary", "Ler");
      read.addEventListener("click", function () { onRead(); });
      row.appendChild(read);
    }
    if (onDelete) {
      var del = el("button", null, "Apagar");
      del.addEventListener("click", function () { onDelete(); });
      row.appendChild(del);
    }
    li.appendChild(row);
    return li;
  }

  async function renderServerSection(saved) {
    if (!navigator.onLine) return;
    var data = null;
    try {
      var res = await fetch("/api/download", { credentials: "same-origin" });
      if (!res.ok) return;
      data = await res.json();
    } catch (err) {
      return;
    }
    var items = data && Array.isArray(data.items) ? data.items : [];
    var pending = items.filter(function (item) {
      return item && item.status === "DONE" && saved.indexOf(item.chapterId) === -1;
    });
    if (!pending.length) return;

    app.appendChild(el("h2", null, "Baixados no servidor"));
    var ul = document.createElement("ul");
    pending.forEach(function (item) {
      var li = document.createElement("li");
      li.appendChild(el("div", "work", item.workTitle || "Sem obra"));
      li.appendChild(el("div", "chapter", item.chapterName || "Capítulo"));
      if (item.pageCount) {
        li.appendChild(el("div", "pages", item.pageCount + " páginas"));
      }
      var row = el("div", "row");
      var save = el("button", "primary", "Salvar no aparelho");
      save.addEventListener("click", function () { saveFromServer(item.chapterId, save); });
      row.appendChild(save);
      li.appendChild(row);
      ul.appendChild(li);
    });
    app.appendChild(ul);
  }

  async function render() {
    app.textContent = "";
    app.appendChild(el("h1", null, "Salvos no aparelho"));
    var sub = el("p", "sub", "");
    app.appendChild(sub);
    usageLine(sub);

    var cache = await openCache();
    var list = await readIndex(cache);
    var items = list.filter(function (item) { return item && item.chapterId !== undefined; });
    items.sort(function (a, b) { return (b.savedAt || 0) - (a.savedAt || 0); });

    if (!items.length) {
      app.appendChild(
        el("p", "empty", "Nada salvo ainda. No leitor, toque no meio da tela e use “Salvar no celular”.")
      );
    } else {
      var ul = document.createElement("ul");
      items.forEach(function (item) {
        ul.appendChild(
          chapterCard(
            item,
            function () { openReader(item); },
            function () { removeItem(item.chapterId); }
          )
        );
      });
      app.appendChild(ul);
    }

    renderServerSection(items.map(function (item) { return item.chapterId; }));
  }

  render();
})();
</script>
</body>
</html>`;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("hr-img-") && name !== IMG_CACHE)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

async function trimCache(cache) {
  const keys = await cache.keys();
  const excess = keys.length - MAX_ENTRIES;
  if (excess <= 0) return;
  await Promise.all(keys.slice(0, excess).map((key) => cache.delete(key)));
}

function offlinePage() {
  return new Response(OFFLINE_HTML, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

async function offlineIndex() {
  const cache = await caches.open(OFFLINE_CACHE);
  const cached = await cache.match(INDEX_URL);
  if (cached) return cached;
  return new Response("[]", { headers: { "content-type": "application/json" } });
}

async function imageResponse(event, request) {
  const saved = await (await caches.open(OFFLINE_CACHE)).match(request);
  if (saved) return saved;

  const cache = await caches.open(IMG_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const res = await fetch(request);
    if (res.status === 200 && res.type === "basic" && !res.redirected) {
      const copy = res.clone();
      event.waitUntil(
        (async () => {
          await cache.put(request, copy);
          await trimCache(cache);
        })(),
      );
    }
    return res;
  } catch (err) {
    const fallback = await cache.match(request);
    if (fallback) return fallback;
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    if (url.pathname === "/offline") {
      event.respondWith(offlinePage());
      return;
    }
    event.respondWith(fetch(request).catch(() => offlinePage()));
    return;
  }

  if (url.pathname === INDEX_URL) {
    event.respondWith(offlineIndex());
    return;
  }

  if (CACHEABLE_PATHS.has(url.pathname)) {
    event.respondWith(imageResponse(event, request));
  }
});
