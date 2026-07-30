---
id: T-009
title: Revalidar fontes e lista de capítulos dos favoritos num laço periódico que sobe com o app
status: ready
blockedBy: [T-007]
files: [src/lib/backbone/favoritesRefresh.ts, src/instrumentation.ts, .env.example]
---

> Rodada de otimização de navegação, segunda leva. Os IDs T-001..T-006 em
> `docs/tickets/` são de rodadas ANTERIORES. Ignore-os: este ticket é o T-009.

## O que fazer

Hoje, abrir um favorito paga na hora o resolve das fontes e a busca dos
capítulos. Na página da obra isso é limitado a 3,5 segundos
(`RESOLVE_BUDGET_MS` em `src/app/(app)/work/[slug]/page.tsx`, li o arquivo) e o
resto termina depois, o que dá a espera que se vê ao abrir uma obra da
biblioteca.

Depois deste ticket o app tem um laço próprio que, de tempos em tempos, percorre
as obras favoritadas e as do histórico recente e revalida fontes e lista de
capítulos com folga de tempo, antes de o usuário chegar. O laço sobe junto com o
app: nada de cron externo. Tem liga/desliga e ritmo por variável de ambiente.

## Onde mexer

### `src/lib/backbone/favoritesRefresh.ts` (arquivo novo)

Exporta uma função só: `startFavoritesRefresh(): void`. Comentário de topo em
inglês, curto, dizendo do que o módulo é responsável.

Configuração (leia `process.env` uma vez, no topo do módulo):

- `FAVORITES_REFRESH` — liga/desliga. Regra exata:
  ```ts
  const raw = (process.env.FAVORITES_REFRESH || "").trim().toLowerCase();
  const ENABLED = raw ? raw === "true" || raw === "1" : process.env.NODE_ENV === "production";
  ```
  Ou seja: ligado por padrão em produção, desligado por padrão em
  desenvolvimento, e um valor explícito sempre vence.
- `FAVORITES_REFRESH_INTERVAL_MIN` — intervalo entre passadas, default `30`.
- `FAVORITES_REFRESH_MAX` — teto de obras por passada, default `60`.
- `FAVORITES_REFRESH_SPACING_MS` — pausa entre uma obra e a próxima, default
  `5000`.

Qualquer valor não numérico ou `<= 0` cai no default.

`startFavoritesRefresh()`:
- Sai imediatamente quando `!ENABLED`.
- Só pode agendar uma vez por processo. Use uma flag em `globalThis` (o mesmo
  padrão de `globalForPrisma` em `src/lib/db.ts`, que li), porque o hot-reload
  de desenvolvimento reexecuta o módulo.
- Agenda com `setTimeout` recursivo, **nunca** `setInterval`: a próxima passada
  só é marcada quando a atual termina, então duas passadas jamais se sobrepõem.
  Primeira passada 2 minutos depois do boot (constante do módulo), as seguintes
  a cada `FAVORITES_REFRESH_INTERVAL_MIN`. Dê `unref` no timer com o cast
  defensivo `(t as unknown as { unref?: () => void }).unref?.()`, para o timer
  não segurar o processo.

Passada (`async function cycle()`, tudo dentro de `try/catch`, nunca lança):
1. Monta a lista de `workId`:
   - `prisma.favorite.findMany({ select: { workId: true }, orderBy: { updatedAt: "desc" }, take: MAX })`
   - mais `prisma.readingHistory.findMany({ where: { readAt: { gt: new Date(Date.now() - 7 * 86_400_000) } }, select: { workId: true }, orderBy: { readAt: "desc" }, take: MAX })`
   - junta as duas na ordem (favoritos primeiro), tira repetidos e corta em
     `MAX`.
2. Para cada `workId`, em série:
   - `queueSourceResolve(workId)` de `@/lib/backbone/resolve` (li o arquivo,
     linha 466). É a faixa de fundo que já existe: concorrência 6, cooldown de
     1 hora por obra, e a resolução em si ainda pula obra cujos links foram
     sincronizados nas últimas 24 h. Não espere por ela — a função devolve
     `void` de propósito.
   - `const link = await getPrimaryLink(workId)` (mesmo arquivo, linha 797;
     devolve a linha inteira de `SourceLink`). Se não vier link, siga para a
     próxima obra.
   - `await refreshChapters(link)` de `@/lib/chapterCache` (criada no T-007:
     busca a lista e grava no cache de memória e no banco; nunca lança).
   - `await sleep(SPACING_MS)` antes da próxima obra. É esse espaçamento que
     impede o laço de socar o Suwayomi e a MangaDex.
3. No fim, uma linha de log: `console.log` com prefixo `[favrefresh]`, a
   quantidade de obras percorridas e a duração da passada em segundos. É por
   essa linha que se confere que o laço rodou.

### `src/instrumentation.ts` (arquivo novo)

O projeto usa a pasta `src/`, então o arquivo de instrumentação do Next fica em
`src/instrumentation.ts` (não existe hoje; conferi). Ele é chamado uma vez por
processo de servidor, no start, e é o gancho oficial para subir trabalho de
fundo junto com o app.

```ts
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startFavoritesRefresh } = await import("@/lib/backbone/favoritesRefresh");
  startFavoritesRefresh();
}
```

O guarda de `NEXT_RUNTIME` e o `import` dinâmico são obrigatórios: `register` também
roda no runtime edge, onde `@prisma/client` não carrega.

### `.env.example` (li inteiro, 77 linhas)

Acrescente um bloco novo com as quatro variáveis, comentadas com o default,
logo depois do bloco `EXTENSION_REPOS` e antes de `# ---- Docker deploy ----`.
Diga em uma linha o que o laço faz e que ele já sobe com o app.

## Fora do escopo

- Rodar o laço por usuário ou com sessão: ele é do servidor e percorre os
  favoritos de todos os usuários.
- Aquecer as imagens das páginas dos capítulos: é o T-010.
- Mudar `queueSourceResolve`, `getPrimaryLink`, `doResolveSourcesForWork` ou
  qualquer outra coisa dentro de `src/lib/backbone/resolve.ts`. Este ticket só
  os chama.
- Mudar `src/lib/chapterCache.ts` (é do T-007) ou a página da obra.
- Rota de API, botão ou tela nova para disparar o laço à mão.
- Mexer em `docker-compose.yml`: as variáveis novas têm default embutido no
  código, então não é obrigatório declará-las lá.
- Mexer em `src/lib/coverImage.ts`, `src/lib/diskCache.ts`,
  `src/lib/backbone/httpCache.ts`, `src/lib/backbone/prewarm.ts`,
  `src/lib/readerPages.ts`, `src/components/Reader.tsx` e nas rotas
  `/api/cover`, `/api/image`, `/api/chapter-pages`: são a leva anterior, já
  pronta.

## Pronto quando

- [ ] `src/lib/backbone/favoritesRefresh.ts` existe e exporta só
      `startFavoritesRefresh`.
- [ ] Com `FAVORITES_REFRESH=false`, nenhuma passada acontece e nenhum log
      `[favrefresh]` aparece.
- [ ] Sem a variável definida e com `NODE_ENV=production`, o laço liga sozinho.
- [ ] A primeira passada acontece 2 minutos depois do boot e as seguintes
      respeitam `FAVORITES_REFRESH_INTERVAL_MIN`.
- [ ] Duas passadas nunca rodam ao mesmo tempo (agendamento por `setTimeout`
      recursivo, marcado só no fim da passada anterior).
- [ ] A lista de obras junta favoritos e histórico dos últimos 7 dias, sem
      repetidos, cortada em `FAVORITES_REFRESH_MAX`.
- [ ] Cada obra passa por `queueSourceResolve` e por `refreshChapters` do link
      primário, com `FAVORITES_REFRESH_SPACING_MS` de pausa entre uma obra e a
      seguinte.
- [ ] Nenhuma exceção do laço escapa: erro de uma obra não interrompe a passada
      nem derruba o app.
- [ ] Cada passada imprime uma linha começando com `[favrefresh]`.
- [ ] `src/instrumentation.ts` só chama o laço quando `NEXT_RUNTIME` é
      `nodejs`, e importa o módulo dinamicamente.
- [ ] `.env.example` documenta as quatro variáveis com seus defaults.
- [ ] `npm run build` passa.

## Como testar (humano)

1. No arquivo `.env`, coloque `FAVORITES_REFRESH=true` e
   `FAVORITES_REFRESH_INTERVAL_MIN=3`. Suba o app com
   `docker compose up -d --build web`.
2. Espere uns 3 minutos e rode `docker compose logs --tail 100 web`. Tem que
   aparecer pelo menos uma linha começando com `[favrefresh]`, dizendo quantas
   obras foram percorridas.
3. Favorite uma obra que você nunca abriu e saia da página. Espere a próxima
   linha de `[favrefresh]` aparecer no log.
4. Abra essa obra. As fontes e a lista de capítulos têm que aparecer
   praticamente na hora, sem as barrinhas cinzas de carregamento.
5. Troque para `FAVORITES_REFRESH=false`, suba de novo e confira que nenhuma
   linha nova de `[favrefresh]` aparece no log.
6. Durante tudo isso, navegar pelo site (home, busca, abrir capítulo) tem que
   continuar com a mesma velocidade de sempre.
