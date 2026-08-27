---
id: T-034
title: Dar prazo a toda chamada à engine e colocar a leitura do usuário na frente da varredura
status: ready
blockedBy: []
files: [src/lib/suwayomi.ts, src/lib/backbone/engineGate.ts, src/lib/chapterCache.ts, src/components/info/ServicesPanel.tsx]
---

## O que fazer

Quando o app precisa da lista de capítulos de uma fonte, ele pergunta ao motor de
scans (a "engine"). Hoje essa pergunta pode ficar pendurada: são até três idas
seguidas de 30 segundos cada, enfileiradas atrás da varredura que procura fontes
novas para outras obras. É por isso que abrir uma fonte diferente às vezes leva
minutos.

Passa a valer:

- **Toda pergunta à engine tem prazo.** Nenhuma busca de capítulo pode passar do
  orçamento que o chamador deu. Estourou, devolve vazio e segue.
- **Quem está esperando na tela passa na frente.** Enquanto houver uma leitura de
  capítulos de um leitor de verdade em andamento, a varredura que procura fontes
  novas cai para no máximo 2 buscas simultâneas em vez de 8, e volta ao normal
  assim que a leitura termina.
- **O painel de infra mostra isso**: no cartão "Engine (Suwayomi)", ao lado de
  "Buscas em voo" e "Na fila", passa a existir "Leituras na frente" com quantas
  leituras de usuário estão segurando a varredura naquele instante.

## Onde mexer

### `src/lib/backbone/engineGate.ts`

O arquivo já é o teto de buscas simultâneas contra a engine (`LIMIT`, hoje 8, de
`SUWAYOMI_SEARCH_CONCURRENCY`), com `active`, a fila `waiting`, `pump()` e
`acquireEngineSlot(deadline)`.

Acrescente a reserva para leitura de usuário:

- `const FOREGROUND_LIMIT = Math.max(1, Math.floor(LIMIT / 4));`
- `const LEASE_MAX_MS = 60_000;`
- um contador `let foreground = 0;`
- `function effectiveLimit(): number { return foreground > 0 ? FOREGROUND_LIMIT : LIMIT; }`
- `pump()` e o caminho de concessão imediata de `acquireEngineSlot` passam a
  comparar `active` com `effectiveLimit()` em vez de `LIMIT`. Quem já está com
  slot não é interrompido: o efeito é só parar de conceder novos.
- `export async function withForegroundRead<T>(fn: () => Promise<T>): Promise<T>`:
  incrementa `foreground`, executa `fn()`, e libera **uma vez só** — no `finally`
  ou por um `setTimeout(LEASE_MAX_MS)` de segurança, o que vier primeiro (guarde
  um booleano `released` para não decrementar duas vezes; chame `.unref?.()` no
  timer). Ao liberar, decremente e chame `pump()`, que é o que devolve a
  varredura ao ritmo normal.
- `engineGateSnapshot()` ganha dois campos: `foreground` e `effectiveLimit`.
  `limit` continua sendo o teto configurado (`LIMIT`), porque o painel já o usa.

`src/lib/metrics/services.ts` não precisa de mudança: ele espalha o snapshot e
tipa por `ReturnType<typeof engineGateSnapshot>`.

### `src/lib/suwayomi.ts`

Hoje só `browseSource` recebe `timeoutMs`; o resto usa o padrão de 30 s de
`GQL_TIMEOUT_MS`. Dê a todas as operações de leitura um parâmetro opcional, como
**último argumento e como objeto**, para não quebrar nenhuma chamada existente:

- `getManga(id: number, opts?: { timeoutMs?: number })`
- `getChapters(mangaId: number, opts?: { timeoutMs?: number })`
- `refreshManga(id: number, fetchManga = true, fetchChapters = true, opts?: { timeoutMs?: number })`
- `fetchChapterPages(chapterId: number, opts?: { timeoutMs?: number })`
- `getMangaEnsured(id: number, opts?: { timeoutMs?: number })`

Cada uma repassa o valor para `gql(query, variables, timeoutMs)`; sem `opts`,
tudo continua com `GQL_TIMEOUT_MS`.

`getMangaEnsured` deixa de encadear três chamadas de 30 s. Com
`opts.timeoutMs` (padrão `20_000`), ela trabalha com um orçamento único:
guarde `const deadline = Date.now() + budget` e, antes de cada passo, calcule
`const left = deadline - Date.now()`. Se `left <= 0`, devolva o que já tiver
(inclusive `null`). O primeiro `getManga` usa `Math.min(8_000, left)`; quando o
mangá volta não inicializado, o `refreshManga` usa o `left` daquele momento e o
segundo `getManga` usa `Math.min(8_000, left)` do momento seguinte. A função
nunca pode passar do orçamento recebido.

`fetchChapterPages` é sempre alguém esperando na tela: envolva seu corpo em
`withForegroundRead(...)` de `@/lib/backbone/engineGate`.

### `src/lib/chapterCache.ts`

`loadChaptersForLink` é o caminho por onde a página da obra e o leitor pedem
capítulos. Assinatura nova, com o parâmetro opcional:

```ts
export async function loadChaptersForLink(
  link: ChapterLink,
  opts?: { timeoutMs?: number },
): Promise<RawChapter[]>
```

- `kind === "scraper"` continua indo em `getNativeChapters(link.id)`, que é
  leitura do banco local — sem prazo e sem reserva.
- No caminho Suwayomi, tudo (o `getMangaEnsured` mais o `getChapters`) roda
  dentro de um único `withForegroundRead(async () => { … })` e dentro de um
  orçamento único de `opts?.timeoutMs ?? 20_000`: `getMangaEnsured` recebe
  `Math.min(12_000, restante)` e `getChapters` recebe o restante depois dele.
  Restante zerado antes do `getChapters` → devolve `[]`.
- As regras que já existem continuam iguais: engine inalcançável devolve `[]` sem
  derrubar o link; `belongsElsewhere` ou mangá inexistente continua chamando
  `dropStaleLink`.

`refreshChapters(link, opts?: { timeoutMs?: number })` repassa `opts` para
`loadChaptersForLink` e mantém a coalescência por chave que já tem.
`revalidateChapters` continua igual.

### `src/components/info/ServicesPanel.tsx`

No cartão `Engine (Suwayomi)`, a grade que hoje tem `GraphQL`, `Buscas em voo` e
`Na fila` ganha um quarto `Stat`:

```tsx
<Stat
  label="Leituras na frente"
  value={count(suwayomi.graphql.gate.foreground)}
  sub={`teto agora ${suwayomi.graphql.gate.effectiveLimit}`}
  tone={suwayomi.graphql.gate.foreground > 0 ? "warn" : "ok"}
/>
```

A grade passa de `sm:grid-cols-3` para `sm:grid-cols-4`. `count` já é importado
no arquivo.

## Fora do escopo

- Mudar a fila de downloads ou os limites do T-028.
- Mexer em `browseSource` ou na ordem em que as fontes são varridas.
- Trocar o valor padrão de `SUWAYOMI_SEARCH_CONCURRENCY`.
- Instalar, subir ou configurar o Suwayomi.
- Qualquer mudança na página da obra ou no leitor: este ticket só mexe nas
  camadas que eles chamam.

## Pronto quando

- [ ] `npm run build` passa.
- [ ] `getManga`, `getChapters`, `refreshManga`, `fetchChapterPages` e
      `getMangaEnsured` aceitam `opts?: { timeoutMs?: number }` como último
      argumento, e todas as chamadas que já existiam no projeto continuam
      compilando sem alteração.
- [ ] `getMangaEnsured` com um orçamento de N ms nunca faz uma chamada cujo
      `timeoutMs` somado ao tempo já gasto ultrapasse N.
- [ ] `loadChaptersForLink` no caminho Suwayomi devolve `[]` ao estourar o
      orçamento, em vez de continuar esperando.
- [ ] `engineGateSnapshot()` devolve `foreground` e `effectiveLimit`, e
      `effectiveLimit` vale `Math.max(1, Math.floor(LIMIT / 4))` enquanto houver
      pelo menos uma leitura em voo.
- [ ] `withForegroundRead` libera a reserva mesmo quando a função passada lança,
      e no máximo 60 segundos depois de começar.
- [ ] Em `/info`, o cartão "Engine (Suwayomi)" mostra quatro números, incluindo
      um chamado `Leituras na frente`.
- [ ] `/work/kingdom-1h0qhf1` continua abrindo e listando os capítulos da
      primeira fonte.

## Como testar (humano)

1. No terminal, dentro da pasta do projeto, rode
   `npm run user -- add qaburroadmin burro12345 --admin`. Se disser que já
   existe, rode `npm run user -- passwd qaburroadmin burro12345`.
2. Rode `npm run build`. Ele tem que terminar sem erro.
3. Rode `npm run dev -- -p 3100`, abra `http://localhost:3100` e entre com
   `qaburroadmin` / `burro12345`.
4. Abra `http://localhost:3100/info`. Procure o cartão "Engine (Suwayomi)": além
   de "GraphQL", "Buscas em voo" e "Na fila", tem que aparecer um quarto número
   chamado "Leituras na frente", com um texto embaixo começando por "teto agora".
5. Abra `http://localhost:3100/work/kingdom-1h0qhf1`. A página tem que mostrar as
   fontes e a lista de capítulos da primeira delas.
6. Abra `http://localhost:3100/reader/999999999`. Em menos de 30 segundos tem que
   aparecer a tela de "não encontrado" — a página não pode ficar carregando sem
   fim.
