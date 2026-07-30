---
id: T-010
title: Pré-baixar em disco as páginas do próximo capítulo não lido de cada favorito
status: ready
blockedBy: [T-007, T-009]
files: [src/lib/pageWarm.ts, src/instrumentation.ts, .env.example]
---

> Rodada de otimização de navegação, segunda leva. Os IDs T-001..T-006 em
> `docs/tickets/` são de rodadas ANTERIORES. Ignore-os: este ticket é o T-010.

## O que fazer

As imagens de capítulo já ficam guardadas em disco para sempre depois da
primeira leitura (`src/lib/diskCache.ts`, tier `page`, li o arquivo). O que
falta é o app baixar essas imagens ANTES de alguém pedir.

Depois deste ticket existe um laço de segundo plano que, de tempos em tempos,
pega o próximo capítulo não lido de cada obra favoritada e baixa as primeiras
páginas dele para o cache de disco. Quando o usuário abrir esse capítulo, as
páginas aparecem instantâneas em vez de esperar o site de scan. O laço tem
liga/desliga e limites por variável de ambiente, e não roda enquanto alguém
está lendo.

## Onde mexer

### `src/lib/pageWarm.ts` (arquivo novo)

Exporta uma função só: `startPageWarm(): void`. Comentário de topo em inglês,
curto.

Configuração (lida uma vez, no topo do módulo; valor não numérico ou `<= 0` cai
no default):

- `PAGE_WARM` — liga/desliga, mesma regra do T-009:
  ```ts
  const raw = (process.env.PAGE_WARM || "").trim().toLowerCase();
  const ENABLED = raw ? raw === "true" || raw === "1" : process.env.NODE_ENV === "production";
  ```
- `PAGE_WARM_INTERVAL_MIN` — intervalo entre passadas, default `60`.
- `PAGE_WARM_MAX_WORKS` — teto de obras por passada, default `20`.
- `PAGE_WARM_PAGES` — páginas aquecidas por capítulo, default `5`.
- `PAGE_WARM_IDLE_MIN` — minutos de silêncio de leitura exigidos para a passada
  rodar, default `5`.

Agendamento igual ao do T-009: `setTimeout` recursivo (nunca `setInterval`),
próxima passada marcada só quando a atual termina, primeira passada 5 minutos
depois do boot (constante do módulo), `unref` no timer com o cast defensivo
`(t as unknown as { unref?: () => void }).unref?.()`, e uma flag em `globalThis`
para o hot-reload não agendar duas vezes. Sai imediatamente quando `!ENABLED`.

**Nunca competir com uma leitura em andamento.** O leitor grava progresso
enquanto se lê (`src/components/Reader.tsx` chama `POST /api/progress`, que faz
`upsert` em `Progress`, e o campo `updatedAt` é `@updatedAt`; li os dois). Então:

```ts
async function someoneIsReading(): Promise<boolean> {
  const since = new Date(Date.now() - IDLE_MIN * 60_000);
  const row = await prisma.progress
    .findFirst({ where: { updatedAt: { gt: since } }, select: { id: true } })
    .catch(() => null);
  return !!row;
}
```

A passada checa isso no começo (e sai sem fazer nada se der `true`) e de novo
antes de cada obra (e para a passada no meio se der `true`).

Passada (`async function cycle()`, tudo em `try/catch`, nunca lança). Além do
`someoneIsReading`, respeite uma constante `CYCLE_DEADLINE_MS` de 10 minutos:
passou disso, a passada termina onde estiver.

1. `prisma.favorite.findMany({ select: { userId: true, workId: true }, orderBy: { updatedAt: "desc" }, take: PAGE_WARM_MAX_WORKS })`.
2. Para cada favorito, em série:
   - `const link = await getPrimaryLink(workId)` de `@/lib/backbone/resolve`
     (li o arquivo, linha 797; devolve a linha inteira de `SourceLink`). Sem
     link, pule.
   - Lista de capítulos, via `@/lib/chapterCache` (T-007):
     ```ts
     const hit = await getCachedChapters<RawChapter[]>(link);
     let chapters = hit?.data ?? [];
     if (!chapters.length) {
       chapters = await loadChaptersForLink(link);
       if (chapters.length) await setCachedChapters(link, chapters);
     }
     ```
     `RawChapter` vem de `@/lib/chapters`. Sem capítulos, pule.
   - Progresso do dono do favorito:
     `prisma.progress.findMany({ where: { userId, mangaId: link.sourceMangaId } })`.
     Monte um `Set` com os `chapterId` cujo `read` é `true`.
   - Próximo não lido: `dedupeByNumber(chapters)` (de `@/lib/chapters`),
     ordenado por `chapterNumber` crescente, primeiro cujo `id` não está no
     `Set`. Se todos foram lidos, pule a obra.
   - `const urls = await chapterPageUrls(next.id, PAGE_WARM_PAGES)` de
     `@/lib/readerPages` (li o arquivo: já existe, já trata capítulo nativo e
     Suwayomi, e nunca lança).
   - Para cada url, em série, `await warmProxiedPage(url)`.
3. Uma linha de log por passada: `console.log` com prefixo `[pagewarm]`, número
   de obras percorridas, número de páginas efetivamente baixadas e duração em
   segundos. Também logue, com o mesmo prefixo, quando a passada é pulada por
   leitura em andamento.

### `warmProxiedPage(proxiedUrl: string): Promise<boolean>` (no mesmo arquivo)

`chapterPageUrls` devolve URLs internas do app (`/api/image?path=…` ou
`/api/image?url=…`), não a URL de origem. Esta função traduz de volta para o
alvo de origem e grava no cache de disco **com a mesma chave que
`src/app/api/image/route.ts` usa**, senão o aquecimento não serve para nada.

**Decisão consciente:** `src/app/api/image/route.ts` é da leva anterior e está
PRONTO, então este ticket **não o edita**. As poucas linhas de derivação de alvo
são reescritas aqui. Copie exatamente o comportamento de lá (li o arquivo
inteiro, 128 linhas):

- `const BASE = process.env.SUWAYOMI_URL || "http://localhost:4567";`
- User-Agent idêntico ao da rota:
  `"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36"`.
- Caminho de Suwayomi permitido, idêntico ao da rota:
  `/^\/api\/v1\/manga\/\d+\/(thumbnail|chapter\/\d+\/page\/\d+)(\?.*)?$/`.
- Leia os parâmetros com `new URL(proxiedUrl, "http://internal")`:
  - parâmetro `url` presente → valide `protocol === "https:"` e
    `isAllowedImageHost(u.host)` (de `@/lib/scrapers`); `target = u.toString()`
    e `referer = `${u.protocol}//${u.host}/``;
  - senão, parâmetro `path` → tem que casar com o regex acima;
    `target = BASE + path`, sem `referer`.
  - Qualquer outra coisa: devolve `false` sem fazer nada.
- `const isPage = !!urlParam || path.includes("/chapter/");` Se não for página,
  devolve `false`: este laço só aquece páginas de capítulo, nunca capa.
- **A chave do cache do tier `page` é o próprio `target`, sem prefixo nenhum.**
  (Prefixo `cover:v1:` é só do tier de capa.)
- `if (await getDiskImage(target, "page")) return false;` — já está em disco,
  nada a fazer.
- `fetch(target, { cache: "no-store", redirect: "manual", headers, signal: AbortSignal.timeout(20_000) })`,
  com `headers` = `{ "User-Agent": UA, Referer: referer }` quando há referer,
  senão `undefined`. Sem retentativa: página que falhou fica para a próxima
  passada.
- Status 200 → `await setDiskImage(target, new Uint8Array(await res.arrayBuffer()), res.headers.get("content-type") || "application/octet-stream", "page")`
  e devolve `true`. `setDiskImage` já aplica o teto de disco e a limpeza por
  idade, então **nunca escreva no diretório de cache por fora dela**.
- Todo erro é engolido e vira `false`.

### `src/instrumentation.ts`

Já existe (criado no T-009). Acrescente, dentro do mesmo `register()`, depois da
chamada do T-009:

```ts
const { startPageWarm } = await import("@/lib/pageWarm");
startPageWarm();
```

Mantenha o guarda `process.env.NEXT_RUNTIME !== "nodejs"` que já está lá.

### `.env.example`

Acrescente as cinco variáveis novas, comentadas com o default, num bloco logo
abaixo do bloco criado pelo T-009. Diga em uma linha o que o laço faz.

## Fora do escopo

- Editar `src/app/api/image/route.ts`, `src/lib/diskCache.ts`,
  `src/lib/readerPages.ts`, `src/app/api/chapter-pages/route.ts` e
  `src/components/Reader.tsx`: são a leva anterior, já pronta. Este ticket só
  importa deles.
- Aquecer capas: já saem prontas do proxy de capa.
- Aquecer capítulo inteiro. São as `PAGE_WARM_PAGES` primeiras páginas, e o
  resto continua sendo baixado sob demanda.
- Usar a fila do `queueSourceResolve` ou revalidar fontes: é o T-009.
- Rota de API, botão ou tela para disparar o aquecimento à mão.
- Fila persistida em banco: o estado do laço vive em memória e recomeça a cada
  boot, o que é aceitável porque o cache de disco sobrevive.

## Pronto quando

- [ ] `src/lib/pageWarm.ts` existe e exporta só `startPageWarm`.
- [ ] Com `PAGE_WARM=false`, nenhuma passada acontece e nenhum log `[pagewarm]`
      aparece.
- [ ] A passada é pulada inteira quando existe alguma linha de progresso
      atualizada nos últimos `PAGE_WARM_IDLE_MIN` minutos, e a checagem se
      repete antes de cada obra.
- [ ] Duas passadas nunca rodam ao mesmo tempo, e uma passada nunca passa de 10
      minutos.
- [ ] Para cada favorito, o capítulo escolhido é o de menor número ainda não
      marcado como lido pelo dono daquele favorito.
- [ ] As páginas gravadas usam exatamente a mesma chave do tier `page` do cache
      de disco que `/api/image` usa (a URL de origem, sem prefixo), de modo que
      abrir o capítulo depois não baixa nada de novo.
- [ ] Página que já está em disco não é baixada de novo.
- [ ] Nada é escrito no diretório de cache por fora de `setDiskImage`.
- [ ] Nenhuma exceção do laço escapa.
- [ ] Cada passada imprime uma linha começando com `[pagewarm]`.
- [ ] `.env.example` documenta as cinco variáveis com seus defaults.
- [ ] `npm run build` passa.

## Como testar (humano)

1. No `.env`, coloque `PAGE_WARM=true`, `PAGE_WARM_INTERVAL_MIN=5` e
   `PAGE_WARM_IDLE_MIN=1`. Suba com `docker compose up -d --build web`.
2. Favorite uma obra e leia o primeiro capítulo dela até o fim, para ele ficar
   marcado como lido. Depois feche o leitor e fique uns 2 minutos sem abrir
   nada.
3. Rode `docker compose logs --tail 100 web` e procure uma linha começando com
   `[pagewarm]` dizendo quantas páginas foram baixadas.
4. Agora abra o capítulo SEGUINTE dessa obra. As primeiras páginas têm que
   aparecer praticamente na hora, sem tela preta esperando.
5. Repita a leitura de um capítulo e, enquanto ainda está lendo, olhe o log: no
   período em que você está lendo tem que aparecer a linha de passada pulada, ou
   nenhuma passada, nunca uma passada baixando páginas.
6. Troque para `PAGE_WARM=false`, suba de novo e confira que nenhuma linha nova
   de `[pagewarm]` aparece.
