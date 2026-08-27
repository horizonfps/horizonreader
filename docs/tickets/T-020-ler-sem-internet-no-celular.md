---
id: T-020
title: Salvar capítulo no aparelho e ler com o servidor fora do ar
status: ready
blockedBy: []
files: [public/sw.js, public/manifest.webmanifest, public/icon-192.png, public/icon-512.png, src/app/layout.tsx, src/middleware.ts, src/components/SaveOfflineButton.tsx, src/components/Reader.tsx, src/app/reader/[chapterId]/page.tsx, src/app/api/download/pages/route.ts, src/app/(app)/downloads/page.tsx, src/app/offline/page.tsx]
---

## O que fazer

Hoje "baixar" guarda o capítulo no disco do servidor. Se o celular perder a rede
até o servidor, não há nada para ler. Este ticket coloca o capítulo dentro do
aparelho.

No leitor aparece o botão **Salvar no celular**. Tocando nele, todas as páginas
daquele capítulo vão para o armazenamento do navegador e o botão passa a dizer
**Salvo no celular**. A tela `/offline` ("Salvos no aparelho") lista o que está
guardado no aparelho, deixa ler cada capítulo e apagar o que não quer mais; e,
quando o servidor está no ar, lista também os capítulos já baixados no servidor
com um botão para trazê-los para o aparelho.

Com o servidor desligado, abrir o endereço do app não mostra mais o erro de
conexão do navegador: mostra essa mesma prateleira, e o capítulo salvo abre e
rola normalmente. O app também vira instalável na tela inicial do celular
(manifesto PWA), então dá para abrir pelo ícone sem passar pelo navegador.

## Onde mexer

### Ícones e manifesto

`public/icon.png` existe e tem 488x511, que não serve para o manifesto. Gere
duas versões quadradas, uma vez, e comite os arquivos:

```
node -e "const s=require('sharp');s('public/icon.png').resize(192,192,{fit:'contain',background:'#000'}).png().toFile('public/icon-192.png')"
node -e "const s=require('sharp');s('public/icon.png').resize(512,512,{fit:'contain',background:'#000'}).png().toFile('public/icon-512.png')"
```

`public/manifest.webmanifest` (novo):

```json
{
  "name": "HorizonReader",
  "short_name": "Horizon",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#000000",
  "theme_color": "#000000",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

`src/app/layout.tsx`: acrescente `manifest: "/manifest.webmanifest"` ao objeto
`metadata` já exportado. Não mexa no `viewport`.

`src/middleware.ts`: o `matcher` já exclui `manifest.webmanifest` e `sw.js` da
checagem de sessão; acrescente `icon-192.png` e `icon-512.png` à mesma lista
negativa, para o navegador conseguir buscar o ícone durante a instalação.

### `public/sw.js` (reescrita)

O arquivo atual é um cache-first de imagens com poda em 900 entradas. Ele
continua existindo, e ganha duas responsabilidades novas.

Constantes:

```js
const VERSION = "v2";
const IMG_CACHE = `hr-img-${VERSION}`;
const OFFLINE_CACHE = "hr-offline-v1"; // conteúdo salvo pelo usuário
const INDEX_URL = "/__offline/index.json";
const CACHEABLE_PATHS = new Set(["/api/cover", "/api/image"]);
```

Regras:

1. **`activate`**: continue apagando os caches que começam com `hr-img-` e não
   são o atual. **Nunca** apague nada que comece com `hr-offline-` — é conteúdo
   do usuário, e apagar isso na troca de versão perde o que ele salvou.
2. **`fetch`**, só `GET` e só mesma origem:
   - Se `request.mode === "navigate"`:
     - `url.pathname === "/offline"` → responda **direto** com o HTML embutido
       (`OFFLINE_HTML`, abaixo), sem tocar na rede;
     - qualquer outra navegação → tente a rede; se a rede falhar (`catch`),
       responda com `OFFLINE_HTML`.
   - Se `url.pathname === INDEX_URL` → responda com o que estiver em
     `OFFLINE_CACHE`, ou `new Response("[]", { headers: { "content-type": "application/json" } })`.
   - Se `CACHEABLE_PATHS.has(url.pathname)`: primeiro procure em `OFFLINE_CACHE`
     (`(await caches.open(OFFLINE_CACHE)).match(request)`) e devolva se achar;
     senão mantenha exatamente o comportamento de hoje (cache-first em
     `IMG_CACHE`, guardando resposta 200/`basic`/não redirecionada e podando em
     `MAX_ENTRIES`).
   - Qualquer outra coisa: não intercepte.
3. **`OFFLINE_HTML`**: uma string com um documento HTML completo e
   autossuficiente (CSS e JS embutidos, nenhum arquivo externo, nenhum bundle do
   Next). É essa página que atende `/offline` e qualquer navegação que falhe.
   Responda com `new Response(OFFLINE_HTML, { headers: { "content-type": "text/html; charset=utf-8" } })`.

   O que ela faz, tudo em JS embutido, lendo o Cache Storage direto (`caches`
   está disponível na página, não precisa falar com o service worker):

   - Fundo `#000`, texto claro, fonte do sistema, largura máxima 48rem — visual
     próximo ao resto do app, que é escuro.
   - Título `Salvos no aparelho` e, abaixo, o espaço usado via
     `navigator.storage.estimate()` (`usage` de `quota`), quando o navegador
     responder.
   - Lê o índice: `const c = await caches.open("hr-offline-v1"); const res = await c.match("/__offline/index.json"); const items = res ? await res.json() : []`.
     Cada item é `{ chapterId, chapterName, workTitle, workSlug, urls, savedAt }`.
   - Lista os itens (mais novo primeiro): nome da obra, nome do capítulo,
     `N páginas`, botão **Ler** e botão **Apagar**.
   - **Ler**: troca a lista por um leitor vertical simples — as páginas em
     `<img>` empilhados, largura 100%, e um botão **‹ voltar** fixo no topo.
     Cada imagem é resolvida por `await caches.match(url)` e exibida via
     `URL.createObjectURL(await res.blob())`, para funcionar mesmo se o service
     worker não estiver controlando a aba.
   - **Apagar**: remove do cache as urls daquele capítulo que nenhum outro item
     do índice usa, tira o item do índice, regrava o índice e re-renderiza.
   - Quando `navigator.onLine` for verdadeiro, busca `GET /api/download` e
     mostra a seção **Baixados no servidor**: cada item com `status === "DONE"`
     que ainda não está no índice do aparelho ganha um botão **Salvar no
     aparelho**, que chama `GET /api/download/pages?chapterId=<id>`, guarda cada
     url com `cache.add(url)` e grava o item no índice. Se a busca falhar, a
     seção simplesmente não aparece (sem mensagem de erro vermelha).
   - Escrever no índice é sempre
     `cache.put("/__offline/index.json", new Response(JSON.stringify(list), { headers: { "content-type": "application/json" } }))`.

### `src/components/SaveOfflineButton.tsx` (novo)

`"use client"`. Props: `{ chapterId: number; chapterName: string; workTitle?: string | null; workSlug?: string | null; urls: string[] }`.

- No `useEffect` de montagem, lê `caches.open("hr-offline-v1")` → `match("/__offline/index.json")` e marca como salvo se já existir item com esse `chapterId`. Se `typeof caches === "undefined"`, o componente não renderiza nada (`return null`).
- Estados e rótulos: parado → `Salvar no celular`; salvando → `Salvando 7/18`;
  salvo → `Salvo no celular` (botão desabilitado); falha → `Falhou · tentar de novo`.
- Salvar: abre o cache, percorre `urls` em série chamando `await cache.add(url)`
  (atualizando o contador a cada página) e ignorando falha individual; se
  nenhuma página entrou, vai para o estado de falha. Depois lê o índice,
  substitui/insere `{ chapterId, chapterName, workTitle, workSlug, urls, savedAt: Date.now() }`
  e regrava.
- Visual igual ao dos outros botões pequenos do leitor: texto `text-xs` claro
  sobre a barra preta translúcida. Use `e.stopPropagation()` no clique, porque a
  barra do leitor fecha ao clique de fundo.
- Remover do aparelho não é feito aqui — isso é a tela `/offline`.

### `src/components/Reader.tsx`

- Aceite uma prop nova `workTitle?: string | null` no tipo `Props`.
- Na barra de cima que aparece quando `showUI` é verdadeiro (onde já ficam o
  título, a etiqueta `Baixado` e os botões `Ampliar` e `Ajustes`), renderize
  `<SaveOfflineButton chapterId={chapterId} chapterName={title} workTitle={workTitle} workSlug={workSlug} urls={pageUrls} />`.

### `src/app/reader/[chapterId]/page.tsx`

O tipo `ReaderData` já carrega `workSlug`. Acrescente `workTitle: string | null`:
em `loadNative` vem de `row.sourceLink.work?.title ?? null` (a query já faz
`include: { sourceLink: { include: { work: true } } }`) e em `loadSuwayomi` de
`link?.work?.title ?? null` (a query já faz `include: { work: true }`). Passe
`workTitle={data.workTitle}` para `<Reader>`.

### `src/app/api/download/pages/route.ts` (novo)

`runtime = "nodejs"`. `GET` com sessão obrigatória (401 sem sessão, no mesmo
padrão de `src/app/api/download/route.ts`). Lê `?chapterId=<n>`; sem inteiro
válido responde `400 { "error": "no_ids" }`.

Busca `prisma.chapterDownload.findUnique({ where: { chapterId }, include: { work: { select: { title: true, slug: true } } } })`.
Sem linha, ou com `status !== "DONE"`, responde `404 { "error": "not_downloaded" }`.
Com linha pronta, responde:

```json
{
  "chapterId": 6789,
  "chapterName": "Chapter 381",
  "workTitle": "Kingdom",
  "workSlug": "kingdom",
  "urls": ["/api/image?path=...&dl=1"]
}
```

`urls` é o `pages` da linha (JSON de strings) com o mesmo sufixo que o leitor
usa hoje: `url + (url.includes("?") ? "&" : "?") + "dl=1"`. Só strings não
vazias entram.

### `src/app/(app)/downloads/page.tsx`

Abaixo do título `Downloads`, um link **Salvos no celular** apontando para
`/offline`. Ele precisa ser uma tag `<a href="/offline">` comum, **não**
`next/link`: o service worker só intercepta navegação de documento, e o
`next/link` faria uma navegação interna que nunca chega nele.

### `src/app/offline/page.tsx` (novo)

Página de servidor mínima, fora do grupo `(app)` (sem barra de baixo), só para o
caso raro de o service worker ainda não estar ativo na primeira visita. Renderiza
um bloco escuro centralizado com `Salvos no aparelho` e o texto
`Nada aqui ainda. Recarregue a página depois de abrir o app pelo menos uma vez.`

## Fora do escopo

- Salvar automaticamente no aparelho tudo que termina de baixar no servidor: o
  salvamento é sempre um toque explícito (no leitor ou na tela `/offline`).
- Sincronizar de volta o progresso de leitura feito offline: ler offline não
  grava progresso no servidor.
- Cota, limpeza automática ou aviso de espaço para os downloads do servidor —
  é o T-022.
- Mudar o cache de páginas do servidor (`src/lib/diskCache.ts`) ou a rota
  `/api/image`.
- Salvar a obra inteira de uma vez no aparelho.

## Pronto quando

- [ ] `npm run build` passa.
- [ ] `http://localhost:3100/manifest.webmanifest` responde um JSON com
      `"name": "HorizonReader"` e três entradas em `icons`, e
      `http://localhost:3100/icon-512.png` responde a imagem (não redireciona
      para o login).
- [ ] No leitor, tocando no meio da tela para abrir as barras, aparece o botão
      `Salvar no celular` na barra de cima.
- [ ] Clicando nele, o rótulo passa por `Salvando …/…` e termina em
      `Salvo no celular`, com o botão desabilitado; recarregando o capítulo, o
      botão já abre como `Salvo no celular`.
- [ ] `http://localhost:3100/offline` lista o capítulo salvo com o nome da obra,
      o nome do capítulo e a quantidade de páginas.
- [ ] Em `/offline`, `Ler` mostra as páginas do capítulo empilhadas e `‹ voltar`
      retorna para a lista.
- [ ] Com o servidor do app parado, abrir `http://localhost:3100/` mostra a
      prateleira `Salvos no aparelho` (e não a tela de erro de conexão do
      navegador), e `Ler` ainda mostra as páginas.
- [ ] Em `/offline`, `Apagar` remove o capítulo da lista e ele não volta depois
      de recarregar a página.
- [ ] Com o servidor no ar e algum capítulo com status `Concluído` em
      `/downloads`, a tela `/offline` mostra a seção `Baixados no servidor` com o
      botão `Salvar no aparelho`, e usá-lo faz o capítulo aparecer na lista de
      salvos.
- [ ] `GET /api/download/pages?chapterId=<id>` sem sessão responde 401, e com um
      capítulo não baixado responde 404.

## Como testar (humano)

1. No terminal, dentro da pasta do projeto, rode `npm run dev -- -p 3100`. Abra
   `http://localhost:3100` e entre com sua conta. (Se precisar de uma conta:
   `npm run user -- add qaburro burro12345`; se disser que já existe, use
   `npm run user -- passwd qaburro burro12345`.)
2. Abra uma obra qualquer e clique em um capítulo para abrir o leitor. Espere as
   primeiras páginas aparecerem.
3. Clique uma vez no meio da tela para as barras aparecerem. Na barra de cima
   deve existir o botão `Salvar no celular`. Clique nele.
4. O botão deve mostrar `Salvando` com um contador de páginas e terminar em
   `Salvo no celular`, sem dar erro.
5. Abra `http://localhost:3100/offline`. Tem que aparecer o título
   `Salvos no aparelho` e o capítulo que você acabou de salvar, com o nome da
   obra e a quantidade de páginas.
6. Clique em `Ler` nesse capítulo: as páginas têm que aparecer, uma embaixo da
   outra. Clique em `‹ voltar` e confirme que a lista volta.
7. Volte ao terminal e **pare o servidor** (encerre o processo do
   `npm run dev`). Espere cinco segundos.
8. No navegador, vá para `http://localhost:3100/`. Em vez da tela de erro de
   conexão do navegador, tem que aparecer a prateleira `Salvos no aparelho` com
   o mesmo capítulo. Clique em `Ler`: as páginas têm que abrir normalmente,
   mesmo com o servidor desligado.
9. Suba o servidor de novo (`npm run dev -- -p 3100`) e volte para
   `http://localhost:3100/offline`. Clique em `Apagar` no capítulo salvo:
   ele some da lista e continua sumido depois de recarregar a página.
10. Abra `http://localhost:3100/manifest.webmanifest`: deve aparecer um texto
    JSON com o nome `HorizonReader` e uma lista de ícones.
