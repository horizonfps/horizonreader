---
id: T-035
title: Aquecer a lista de capítulos de todas as fontes da obra e parar de varrer o catálogo à toa
status: ready
blockedBy: []
files: [src/lib/chapterWarm.ts, src/app/api/warm/route.ts, src/lib/backbone/favoritesRefresh.ts, src/lib/backbone/resolve.ts]
---

## O que fazer

Hoje o app só guarda a lista de capítulos da fonte que você abriu. As outras
fontes da mesma obra ficam frias: no momento em que você clica numa delas, é que
o app vai perguntar do zero — e é aí que nasce a espera de minutos.

E há um agravante: sempre que uma obra passa de um dia sem ser sincronizada, abrir
a página dela dispara uma varredura do catálogo inteiro de fontes em segundo
plano, mesmo quando a obra já tem várias fontes boas ligadas. Essa varredura é
justamente o que entope o motor de scans enquanto você tenta trocar de fonte.

Passa a valer:

- **As fontes da obra são aquecidas em segundo plano.** Quando o app toma
  conhecimento de uma obra (o cartão dela entra na tela, alguém pede o
  aquecimento, ou a rotina de favoritos passa por ela), as listas de capítulos
  das melhores fontes dessa obra são buscadas e guardadas, de duas em duas, sem
  segurar nenhuma tela.
- **Obra que já tem fontes boas não manda varrer o catálogo.** Com 3 ou mais
  fontes com capítulos, sincronizadas nos últimos 7 dias, abrir a obra só reaquece
  essas fontes. Procurar fontes novas continua acontecendo, só que uma vez por
  semana em vez de todo dia — e o botão `Atualizar fontes` continua forçando a
  busca completa na hora.
- **Dá para conferir o estado de uma obra pela API**: `GET /api/warm?slug=<slug>`
  responde quantas fontes a obra tem, quantas já estão com a lista guardada, e em
  que modo a próxima resolução vai rodar.

## Onde mexer

### `src/lib/chapterWarm.ts` (novo)

```ts
export async function warmWorkChapters(
  workId: number,
  opts?: { max?: number },
): Promise<number>;
```

- Nunca lança e nunca é esperada por uma tela: quem chama pode usar `void`.
- Carrega os links com
  `prisma.sourceLink.findMany({ where: { workId, chapterCount: { gt: 0 } }, orderBy: [{ isPrimary: "desc" }, { healthScore: "desc" }] })`
  e fica com os primeiros `opts?.max ?? 8`.
- Pula link que já foi aquecido há menos de `COOLDOWN_MS = 600_000`, controlado
  por um `Map<number, number>` de id do link para o instante do último aquecimento
  (mesmo padrão de `bgDoneAt` em `resolve.ts`).
- Pula link Suwayomi cuja lista guardada ainda é nova: consulte
  `prisma.chapterListCache.findUnique({ where: { sourceLinkId: link.id }, select: { fetchedAt: true } })`
  e pule quando `Date.now() - fetchedAt.getTime() < FRESH_MS` (`6 * 3_600_000`).
  Link com `kind === "scraper"` não tem essa linha e nunca é pulado por aqui —
  para ele o aquecimento é uma leitura barata do banco.
- Os que sobrarem passam por `refreshChapters(link)` de `@/lib/chapterCache`, com
  no máximo **2 ao mesmo tempo** (um laço de trabalhadores igual ao `runPool` de
  `resolve.ts`, sem o prazo). Marque o instante no `Map` antes de disparar.
- Devolve quantos links foram efetivamente aquecidos.

Cuidado com import circular: este arquivo importa `@/lib/db` e
`@/lib/chapterCache`, e **não** importa `@/lib/backbone/resolve`.

### `src/lib/backbone/resolve.ts`

1. **Modo leve.** No topo do arquivo, ao lado das outras constantes:
   `const LIGHT_WINDOW_MS = 7 * DAY_MS;` e `const LIGHT_MIN_LINKS = 3;`.
   Em `doResolveSourcesForWork`, o `select` de `work.links` já traz
   `lastSyncedAt` e `chapterCount`. Logo depois do teste de `fresh` que já
   existe (o de 24 h, que continua igual), acrescente: quando `!force`, conte os
   links com `chapterCount > 0`; se forem `>= LIGHT_MIN_LINKS` e o maior
   `lastSyncedAt` entre eles estiver dentro de `LIGHT_WINDOW_MS`, registre
   `console.info(\`[resolve] work ${workId}: modo leve (${n} fontes)\`)`, chame
   `void warmWorkChapters(workId)` e **retorne** — sem `listSources`, sem
   `runPool`, sem `runScraperLane`, sem passe de fundo.
   Com `force` (o botão `Atualizar fontes`), nada muda: a varredura completa
   roda como hoje.

2. **Relatório do modo.** Exporte um ajudante puro de leitura, usado pela rota:

```ts
export async function sweepModeForWork(workId: number): Promise<"fresh" | "light" | "sweep">;
```

   Lê os links da obra (`chapterCount` e `lastSyncedAt`) e aplica exatamente os
   mesmos dois testes, na mesma ordem: existe link com capítulos sincronizado nos
   últimos `DAY_MS` → `"fresh"`; existem `LIGHT_MIN_LINKS` links com capítulos e o
   mais novo está dentro de `LIGHT_WINDOW_MS` → `"light"`; caso contrário
   → `"sweep"`. Falha de banco devolve `"sweep"`.

3. Importe `warmWorkChapters` de `@/lib/chapterWarm`.

### `src/app/api/warm/route.ts`

O `POST` continua com o mesmo contrato e a mesma resposta rápida. Acrescente o
aquecimento das listas:

- Caminho `/work/<slug>?src=<id>` (que já dispara `refreshChapters(link)`):
  dispare também `void warmWorkChapters(work.id)` antes de responder.
- Caminho `/work/<slug>` sem `src`: além do `queueSourceResolve(work.id)` que já
  existe, `void warmWorkChapters(work.id)`.
- Caminho `/w/<origin>/<externalId>`: depois de `queueSourceResolve(resolved.workId)`,
  `void warmWorkChapters(resolved.workId)`.

Acrescente um `GET` no mesmo arquivo:

```
GET /api/warm?slug=<slug>
```

- Sem sessão → `401 { error: "unauthorized" }` (mesmo teste do `POST`).
- `slug` vazio ou obra inexistente → `404 { error: "not_found" }`.
- Caso contrário: conta `links` (`prisma.sourceLink.count({ where: { workId } })`),
  conta `cached` (`prisma.chapterListCache.count({ where: { sourceLink: { workId } } })`
  somado aos links com `kind: "scraper"` que tenham pelo menos um
  `ScrapedChapter` — use `prisma.sourceLink.count({ where: { workId, kind: "scraper", scrapedChapters: { some: {} } } })`),
  pega `mode` de `sweepModeForWork(workId)`, dispara `void warmWorkChapters(workId)`
  e responde
  `200 { ok: true, workId, links, cached, mode }` **sem esperar o aquecimento**.

### `src/lib/backbone/favoritesRefresh.ts`

O ciclo hoje aquece só o link principal (`getPrimaryLink` + `refreshChapters`).
Troque essas duas linhas por `await warmWorkChapters(workId);`, para que a rotina
deixe prontas todas as fontes de cada obra favoritada ou lida na semana. O
`queueSourceResolve(workId)` que vem antes continua. Remova o import de
`getPrimaryLink` e o de `refreshChapters` se ficarem sem uso, e importe
`warmWorkChapters` de `@/lib/chapterWarm`. O `sleep(SPACING_MS)` entre obras
continua como está.

## Fora do escopo

- Aquecer as **imagens** das páginas: isso é do `pageWarm`/downloads e não muda.
- Mudar a ordem de saúde das fontes ou o cálculo de `healthScore`.
- Apagar fontes repetidas do banco.
- Mudar a página da obra, o leitor ou qualquer componente de tela.
- Trocar o intervalo (`FAVORITES_REFRESH_INTERVAL_MIN`) ou o teto de obras da
  rotina de favoritos.
- Aquecer fontes de obras que ninguém abriu nem favoritou.

## Pronto quando

- [ ] `npm run build` passa.
- [ ] `warmWorkChapters` nunca dispara mais de 2 aquecimentos ao mesmo tempo,
      nunca lança, e devolve o número de links aquecidos.
- [ ] Um link aquecido há menos de 10 minutos é pulado na chamada seguinte.
- [ ] Um link Suwayomi com lista guardada há menos de 6 horas é pulado.
- [ ] `doResolveSourcesForWork` sem `force`, numa obra com 3 ou mais fontes com
      capítulos e sincronizadas nos últimos 7 dias, não chama `listSources` nem
      `runPool`, e imprime uma linha contendo `modo leve`.
- [ ] Com `force`, a varredura completa continua rodando como antes.
- [ ] `GET /api/warm?slug=solo-leveling-3w0wvo` responde um JSON com `"ok":true`
      e os campos `links`, `cached` e `mode`, onde `mode` é `fresh`, `light` ou
      `sweep`.
- [ ] `GET /api/warm?slug=nao-existe-mesmo` responde `404`.
- [ ] `GET /api/warm?slug=…` responde em menos de 3 segundos, mesmo quando o
      aquecimento que ele dispara for demorado.
- [ ] `/work/gyakusatsu-happy-end-luozhk` continua listando as fontes e os
      capítulos da primeira delas.

## Como testar (humano)

1. No terminal, dentro da pasta do projeto, rode `npm run dev -- -p 3100`. Abra
   `http://localhost:3100` e entre com sua conta. (Se precisar de uma conta:
   `npm run user -- add qaburro burro12345`; se disser que já existe, use
   `npm run user -- passwd qaburro burro12345`.)
2. Abra `http://localhost:3100/api/warm?slug=solo-leveling-3w0wvo`. A página tem
   que mostrar um texto no formato de dados começando com `{"ok":true` e conter as
   palavras `links`, `cached` e `mode`. A resposta tem que aparecer em poucos
   segundos.
3. Abra `http://localhost:3100/api/warm?slug=nao-existe-mesmo`. Tem que aparecer
   uma resposta de erro dizendo `not_found`.
4. Abra `http://localhost:3100/work/gyakusatsu-happy-end-luozhk`. A fileira de
   fontes e a lista de capítulos da primeira fonte têm que aparecer normalmente.
5. Abra `http://localhost:3100/api/warm?slug=gyakusatsu-happy-end-luozhk`. Tem
   que aparecer de novo um texto começando com `{"ok":true`.
6. Volte para `http://localhost:3100/work/gyakusatsu-happy-end-luozhk` e recarregue
   a página. Ela tem que continuar abrindo com as fontes e os capítulos.
