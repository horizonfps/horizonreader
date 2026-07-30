---
id: T-005
title: Pré-carregar o próximo capítulo quando o leitor passa de 70%
status: ready
blockedBy: []
files: [src/lib/readerPages.ts, src/app/api/chapter-pages/route.ts, src/app/reader/[chapterId]/page.tsx, src/components/Reader.tsx]
---

## O que fazer

Hoje o leitor adianta 4 páginas dentro do capítulo aberto, e só. Ao chegar no
fim e apertar "Próximo capítulo", tudo começa do zero: o servidor monta a página
e só então vai buscar as imagens, o que dá aquela tela preta de espera entre um
capítulo e outro.

Depois deste ticket, quando a leitura passa de 70% do capítulo o app já prepara o
capítulo seguinte por trás: pede a página dele ao servidor e aquece as primeiras
imagens. A virada de capítulo passa a ser imediata. Só o começo do próximo
capítulo é preparado, nunca o capítulo inteiro.

## Onde mexer

**`src/lib/readerPages.ts`** (arquivo novo, server-side). Duas exportações:

- `suwayomiPageUrls(d: { pages: string[]; mangaId: number; sourceOrder: number; pageCount: number }): string[]`
  — exatamente a expressão que hoje está inline em `loadSuwayomi`
  (`src/app/reader/[chapterId]/page.tsx`, linhas 78-81): usa `pages.map(proxied)`
  quando há páginas, senão gera `pageUrl(mangaId, sourceOrder, i)` para
  `pageCount` itens.
- `chapterPageUrls(chapterId: number, limit: number): Promise<string[]>`
  — resolve as primeiras `limit` páginas de um capítulo, do mesmo jeito que o
  leitor faz:
  - `isNativeChapterId(chapterId)` (`src/lib/scrapers/native.ts`) → busca
    `prisma.scrapedChapter.findUnique({ where: { id: chapterId - NATIVE_OFFSET }, include: { sourceLink: true } })`,
    pega o scraper com `getScraper(row.sourceLink.sourceId)`, chama
    `scraper.pages(row.chapterKey)` e mapeia com `proxyScraperImage`.
  - senão → `fetchChapterPages(chapterId)` (`src/lib/suwayomi.ts`) e
    `suwayomiPageUrls`.
  - Qualquer falha devolve `[]`. Nunca lança.

**`src/app/api/chapter-pages/route.ts`** (arquivo novo). Siga o formato das rotas
existentes (`export const runtime = "nodejs"`, sessão obrigatória):

- `GET` com `?id=<chapterId>&limit=<n>`.
- Sem sessão (`getSession`) → 401 com `{ error: "unauthorized" }`.
- `id` que não é inteiro → 400.
- `limit` limitado entre 1 e 5, default 3.
- Responde `{ urls }`.

**`src/app/reader/[chapterId]/page.tsx`** (li inteiro, 144 linhas): só troque a
montagem inline das urls dentro de `loadSuwayomi` pela chamada a
`suwayomiPageUrls`. Nada mais muda nesse arquivo.

**`src/components/Reader.tsx`** (li inteiro, 513 linhas): acrescente um efeito
novo, sem tocar no efeito de `PRELOAD_AHEAD` que já existe (linhas 271-277).

- Constantes novas no topo, junto de `PRELOAD_AHEAD`:
  `NEXT_CHAPTER_AT = 0.7`, `NEXT_CHAPTER_PAGES = 3`, `REPREFETCH_EVERY_MS = 25_000`.
- Refs: uma booleana para "já aqueci as imagens do próximo" e uma numérica com o
  instante do último `prefetch`.
- Efeito com dependências `[page, total, nextChapterId, router]`:
  - Sai fora quando não há `nextChapterId`, quando `total === 0`, ou quando
    `(page + 1) / total < NEXT_CHAPTER_AT`.
  - Sai fora quando `navigator.connection?.saveData` é verdadeiro (o projeto já
    respeita isso em `src/components/PrefetchLink.tsx`).
  - Chama `router.prefetch(\`/reader/${nextChapterId}\`)`, repetindo no máximo a
    cada `REPREFETCH_EVERY_MS`. **Armadilha:** o payload de rota dinâmica
    prefetchado vale ~30 s no cliente (`experimental.staleTimes.dynamic` no
    `next.config.mjs`); por isso a repetição, e por isso não basta prefetchar uma
    vez só.
  - Uma única vez por capítulo: `fetch("/api/chapter-pages?id=…&limit=3")`, e
    para cada url devolvida cria `new window.Image()` com `decoding = "async"` e
    `src` na url — exatamente o padrão do aquecimento que já existe no arquivo.
    Erro engolido.
- Não precisa resetar nada ao trocar de capítulo: a página do leitor monta o
  componente com `key={chapterId}`, então o estado é novo a cada capítulo.

Comentários novos em inglês, curtos.

## Fora do escopo

- Baixar o capítulo inteiro adiante. São só as 3 primeiras páginas.
- Pré-baixar o próximo capítulo não lido de obra favorita, fora do leitor: é da
  próxima rodada.
- Mudar o comportamento de salvar progresso, o modo paginado, ou o aquecimento
  de 4 páginas dentro do capítulo atual.
- Mexer em `next.config.mjs`.

## Pronto quando

- [ ] Existe `GET /api/chapter-pages`, que responde 401 sem sessão, 400 com id
      inválido, e no máximo 5 urls.
- [ ] `suwayomiPageUrls` é usada tanto pela página do leitor quanto pela rota
      nova (uma implementação só).
- [ ] Antes de 70% do capítulo o leitor não pede nada do próximo capítulo.
- [ ] A partir de 70%, o leitor pede as páginas do próximo capítulo uma única
      vez e chama o prefetch da rota do próximo capítulo, repetindo o prefetch no
      máximo a cada 25 segundos.
- [ ] Num capítulo que é o último da obra (sem próximo), nada é disparado.
- [ ] O aquecimento de 4 páginas dentro do capítulo atual continua igual.
- [ ] `npm run build` passa.

## Como testar (humano)

1. Suba o app, abra uma obra e comece a ler um capítulo que tenha várias páginas.
2. Role até passar bem da metade do capítulo e continue até o fim.
3. Toque em "Próximo capítulo". O capítulo seguinte tem que abrir na hora, já com
   as primeiras páginas na tela, sem aquela tela preta de espera.
4. Faça o mesmo pulando direto para o fim (arrastando a barra de rolagem até o
   final): o próximo capítulo também tem que abrir rápido.
5. Abra o último capítulo de uma obra e leia até o fim: no lugar do botão aparece
   "Fim." e nada trava.
