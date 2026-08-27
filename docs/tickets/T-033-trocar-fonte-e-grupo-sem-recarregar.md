---
id: T-033
title: Trocar de fonte e de grupo de scan sem recarregar a página da obra
status: ready
blockedBy: []
files: [src/app/(app)/work/[slug]/page.tsx, src/lib/workChapters.ts, src/app/api/work-chapters/route.ts, src/components/ChapterBrowser.tsx]
---

## O que fazer

Hoje, na página de uma obra, clicar em outra fonte (ou em outro grupo de scan)
recarrega a página inteira no servidor. A tela fica no esqueleto cinza, sem
nenhum aviso, até a fonte responder — e uma fonte lenta segura isso por minutos.
Trocar de grupo de scan, que não precisa de nenhum dado novo, paga o mesmo preço.

Passa a valer:

- **Grupo de scan troca na hora.** Os capítulos de todos os grupos da fonte
  aberta já vêm juntos, então clicar em outro grupo só troca a lista na tela.
  Zero espera, zero requisição.
- **Fonte troca sem sair da página.** Clicar em outra fonte marca aquela fonte
  como escolhida na mesma hora, e a área de capítulos mostra
  `Carregando capítulos de <nome da fonte>…` enquanto a lista chega. Se a fonte
  demorar mais de 8 segundos, entra a linha
  `Esta fonte está demorando — pode levar até um minuto.`. Passados 45 segundos
  sem resposta, aparece `<nome da fonte> não respondeu.` com um botão
  `Tentar de novo`.
- **O endereço acompanha a escolha**, sem recarregar: trocar de fonte deixa o
  endereço em `?src=<id>`, trocar de grupo acrescenta `&scan=<grupo>`. Recarregar
  a página nesse endereço abre na mesma fonte e no mesmo grupo.
- **A fileira de fontes fica limpa**: fonte com zero capítulos some, e fontes
  repetidas com o mesmo nome e mesmo idioma viram uma só (fica a que tem mais
  capítulos). A fonte aberta nunca some da fileira.
- **Atualizar fontes deixa de zerar o que já estava pronto**: o botão continua
  procurando fontes novas, mas as listas de capítulos guardadas não são mais
  apagadas, então a página volta preenchida em vez de vazia.

## Onde mexer

### `src/lib/workChapters.ts` (novo)

Concentra o preparo do que a lista de capítulos precisa, para a página e a rota
usarem exatamente o mesmo formato.

```ts
import type { DownloadStatus } from "@/components/DownloadButton";

export type ChapterView = {
  id: number;
  name: string;
  chapterNumber: number;
  uploadDate: string | null;
};

export type GroupView = { key: string; count: number; chapters: ChapterView[] };

export type ProgressView = {
  chapterId: number;
  read: boolean;
  lastPageRead: number;
  updatedAt: number; // epoch ms (Date não sobrevive ao JSON da rota)
};

export type SourceView = {
  linkId: number;
  sourceMangaId: number;
  sourceName: string;
  groups: GroupView[];
  progress: ProgressView[];
  downloadStatus: [number, DownloadStatus][];
  mirrored: [number, number][]; // chapterId -> chapterId já baixado em outra fonte
  autoReadCount: number;
};

export async function buildSourceView(
  link: { id: number; workId: number; kind: string | null; sourceId: string | null; sourceMangaId: number; sourceName: string | null },
  opts: { uid: number | null; budgetMs?: number },
): Promise<SourceView | null>;
```

Regras de `buildSourceView`, nesta ordem:

1. Lista de capítulos: `getCachedChapters<ChapterView[]>(link)` de
   `@/lib/chapterCache`. Acertou → usa os dados e, se `hit.stale`, chama
   `revalidateChapters(link)` (não espera).
2. Não acertou → `loadChaptersForLink(link)` correndo contra um timer de
   `budgetMs` (padrão `8_000`) com `Promise.race`; use
   `new Promise((r) => setTimeout(() => r(null), budgetMs))` como o outro lado da
   corrida. Veio lista com pelo menos um capítulo → `setCachedChapters(link, lista)`.
   Estourou o prazo ou veio vazio → dispare `void refreshChapters(link)` e
   **devolva `null`** (é o estado "ainda buscando"). Nunca lance.
3. Grupos: `groupByScanlator(chapters)` de `@/lib/chapters`; para cada grupo,
   `chapters: dedupeByNumber(g.chapters).sort((a, b) => b.chapterNumber - a.chapterNumber)`
   e `count` igual ao tamanho dessa lista já deduplicada. A ordem dos grupos é a
   que `groupByScanlator` devolve.
4. `progress`: com `opts.uid`, `prisma.progress.findMany({ where: { userId: uid, mangaId: link.sourceMangaId } })`,
   filtrado pelos ids de capítulo que aparecem em algum grupo, mapeado para
   `ProgressView` com `updatedAt: row.updatedAt.getTime()`. Sem `uid`, array vazio.
5. Downloads: `prisma.chapterDownload.findMany({ where: { workId: link.workId }, select: { chapterId: true, chapterNumber: true, mangaId: true, status: true } })`.
   `downloadStatus` é o par `[chapterId, status]` de todas as linhas.
6. `mirrored`: mesma regra que a página usa hoje. Monte o conjunto
   `doneIds` (linhas com `status === "DONE"`), pegue até 4 outros links da obra
   que tenham download pronto (`prisma.sourceLink.findMany({ where: { workId } })`
   cruzado com os `mangaId` das linhas `DONE`), leia a lista de cada um **sem ir
   à rede**: `getCachedChapters` e, só quando `link.kind === "scraper"`,
   `loadChaptersForLink` (é leitura do banco local). Junte tudo, filtre por
   `doneIds` e, para cada capítulo dos grupos que ainda não esteja `DONE` na
   própria fonte, guarde `[capítulo.id, findChapterMatch(capítulo, baixadosEmOutraFonte)!.id]`
   quando houver casamento. `findChapterMatch` vem de `@/lib/chapterMatch`.
7. `autoReadCount`: com `uid`,
   `prisma.progress.count({ where: { userId: uid, read: true, lastPageRead: 0, OR: [{ workId: link.workId }, { mangaId: link.sourceMangaId }] } })`;
   sem `uid`, zero.

Todo acesso ao banco vai com `.catch(...)` e valor neutro, como o resto do
projeto faz.

### `src/app/api/work-chapters/route.ts` (novo)

`GET /api/work-chapters?link=<sourceLinkId>`, `export const runtime = "nodejs"`.

- Sem sessão (`getSession()` de `@/lib/session`) → `401 { error: "unauthorized" }`.
- `link` não inteiro → `400 { error: "bad_link" }`.
- Carrega o `SourceLink` por id; não existe → `404 { error: "not_found" }`.
- Chama `buildSourceView(link, { uid: session.uid })`.
- Devolveu `null` → `200 { status: "pending" }`.
- Devolveu a view → `200 { status: "ready", view }`.

A rota nunca demora mais que o orçamento de `buildSourceView` mais o tempo das
consultas ao banco: ela não pode ficar pendurada esperando a fonte.

### `src/components/ChapterBrowser.tsx` (novo, `"use client"`)

Recebe tudo pronto do servidor e passa a ser dono das três seções que hoje estão
no fim de `SourcesAndChapters` (Fontes, Grupos de scan, Capítulos).

```ts
type SourceChip = {
  id: number;
  sourceName: string;
  chapterCount: number;
  healthScore: number;
  lang: string | null;
};

type Props = {
  slug: string;
  workId: number;
  sources: SourceChip[];        // já na ordem do banco
  initialSourceId: number | null;
  initialScan: string | null;
  initialView: SourceView | null; // null = a fonte inicial ainda está sendo buscada
};
```

Estado: `activeId`, `views` (um `Map<number, SourceView>` semeado com
`initialView`), `scan` (chave do grupo escolhido, ou `null` = primeiro grupo),
`phase` (`"ready" | "loading" | "slow" | "failed"`).

Comportamento:

- **Fileira de fontes.** Renderize os chips com o mesmo visual de hoje (bolinha
  de saúde por `healthScore` usando os mesmos cortes 55/30, nome truncado em
  `max-w-[10rem]`, contagem ao lado, ativo com `bg-accent text-on-accent`), mas
  como `<button type="button">`, não mais como link. Antes de renderizar,
  filtre: descarte `chapterCount === 0` e colapse chips com o mesmo par
  (`sourceName`, `lang`) mantendo o de maior `chapterCount`; o chip cujo `id` é
  `activeId` nunca é descartado.
- **Clique numa fonte.** `setActiveId(id)`, `setScan(null)` e
  `window.history.replaceState(null, "", \`/work/${slug}?src=${id}\`)` (o App
  Router do Next 15 acompanha `replaceState` sem ida ao servidor). Se `views` já
  tem essa fonte, `phase = "ready"` e acabou — troca instantânea. Se não tem,
  `phase = "loading"` e começa o ciclo: `GET /api/work-chapters?link=${id}`,
  repetido a cada 2 s enquanto a resposta for `status: "pending"`. Aos 8 s,
  `phase = "slow"`. Aos 45 s sem `ready`, `phase = "failed"`. Chegou `ready` →
  guarda a view em `views`, `phase = "ready"`. Um clique em outra fonte no meio
  do ciclo cancela o ciclo anterior (guarde o id pedido e ignore respostas de
  outro id).
- **Aquecer no cursor.** No `onPointerEnter` e no `onTouchStart` de cada chip,
  uma única vez por fonte, dispare
  `fetch("/api/warm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ href: \`/work/${slug}?src=${id}\` }) })`
  e ignore o resultado. A rota `/api/warm` já trata esse formato.
- **Grupos de scan.** Só aparece quando a view ativa tem mais de um grupo.
  Mesmos chips de hoje, também como `<button>`. Clicar chama `setScan(g.key)` e
  `window.history.replaceState(null, "", \`/work/${slug}?src=${activeId}&scan=${encodeURIComponent(g.key)}\`)`.
  Nenhuma requisição.
- **Capítulos.** Grupo ativo = o de chave `scan`, ou o primeiro da view. A partir
  dele monte `visible` (já vem ordenado do servidor) e `chaptersAsc` (o inverso).
  - Botão de leitura: `pickResumeChapter(chaptersAsc, progress.map((p) => ({ ...p, updatedAt: new Date(p.updatedAt) })))`
    de `@/lib/continueReading`, com os mesmos textos
    (`Começar a ler` / `Continuar` / `Reler último`) e o mesmo
    `formatChapterNumber`. O alvo do link é o id espelhado (`mirrored`) quando
    houver, senão o próprio.
  - `DownloadButton` com `label="Baixar 5 próximos"`, `BulkDownloadBar` e
    `UndoAutoReadButton` continuam com as mesmas props de hoje, com
    `mangaId` vindo de `view.sourceMangaId` e `count` de `view.autoReadCount`.
  - Cada linha da lista mantém exatamente o layout atual: nome, data formatada
    (`uploadDate` em epoch ms como string, com o mesmo `toLocaleDateString("pt-BR", …)`),
    selo `Baixado em outra fonte` quando houver espelho, `Check` quando lido,
    e `DownloadButton` de um capítulo à direita.
  - Enquanto `phase` for `"loading"` ou `"slow"`, a área de capítulos mostra um
    spinner (mesma classe do `ResolvingSources`) e o texto
    `Carregando capítulos de <nome>…`; em `"slow"` some mais a linha
    `Esta fonte está demorando — pode levar até um minuto.`. Em `"failed"`,
    `<nome> não respondeu.` e um `<button>` `Tentar de novo` que reinicia o
    ciclo daquela fonte.

### `src/app/(app)/work/[slug]/page.tsx`

`SourcesAndChapters` continua sendo quem resolve as fontes, mas para de montar a
lista de capítulos na mão:

- O bloco de `refresh` deixa de chamar `bustChapters`. Depois de
  `resolveSourcesForWork(workId, { force: true })`, percorra os links e chame
  `revalidateChapters(link)` (de `@/lib/chapterCache`) para cada um antes do
  `redirect`. `bustChapters` deixa de ser importada aqui.
- `chapterIdsForLink` (usada para escolher a fonte pelo progresso) para de ir à
  rede: use `getCachedChapters` e, só quando `link.kind === "scraper"`,
  `loadChaptersForLink`. Sem cache e sem ser scraper, devolva um `Set` vazio.
- A escolha de `selected` (explícito por `src`, depois progresso, depois mais
  baixado, depois `links[0]`) fica igual.
- Todo o trecho que hoje calcula `chapters`, `scanned`, `downloadedElsewhere`,
  `groups`, `visible`, `progressList`, `readSet`, `resume`, `nextChapters` e o
  JSX das três seções sai da página. No lugar:
  `const view = selected ? await buildSourceView(selected, { uid }) : null;`
  e o render passa a ser a seção de Fontes/Grupos/Capítulos delegada:

```tsx
{links.length > 0 ? (
  <ChapterBrowser
    slug={slug}
    workId={workId}
    sources={links.map((l) => ({
      id: l.id,
      sourceName: l.sourceName || "Fonte",
      chapterCount: l.chapterCount,
      healthScore: l.healthScore,
      lang: l.lang,
    }))}
    initialSourceId={selected?.id ?? null}
    initialScan={wantScan}
    initialView={view}
  />
) : (
  <ResolvingSources />
)}
```

O cabeçalho `Fontes` com o `RefreshSourcesButton` continua na página (fora do
componente cliente), como está hoje. `wantScan` continua saindo de
`decodeURIComponent(scan)` com `try/catch`.

## Fora do escopo

- Trocar de fonte de dentro do leitor (o leitor continua como está).
- Guardar por usuário qual fonte foi escolhida numa obra: a escolha vale para a
  visita atual e para o endereço, não é salva no banco.
- Apagar do banco os `SourceLink` repetidos — a fileira só esconde; a limpeza de
  verdade continua com `pruneDuplicateLinks`.
- Emendar capítulos de fontes diferentes numa lista só.
- Mudar a ordem das fontes ou o cálculo de `healthScore`.
- Paginar ou virtualizar a lista de capítulos.

## Pronto quando

- [ ] `npm run build` passa.
- [ ] Em `/work/kingdom-1h0qhf1` aparecem duas fontes e, abaixo delas, a seção
      `Grupos de scan` com dois botões.
- [ ] Clicar no segundo grupo de scan troca a lista de capítulos em menos de
      2 segundos e o endereço passa a conter `scan=`, sem a tela voltar para o
      esqueleto cinza.
- [ ] Clicar na segunda fonte deixa o botão dela destacado imediatamente e a
      lista de capítulos vira a dessa fonte em menos de 5 segundos; o endereço
      passa a conter `src=` com o id dessa fonte.
- [ ] Recarregar o endereço resultante abre já na mesma fonte e no mesmo grupo.
- [ ] Voltar para a primeira fonte já visitada troca a lista sem nenhuma espera
      (a lista muda no mesmo segundo do clique).
- [ ] Abrir `/api/work-chapters?link=88` devolve um JSON que começa com
      `{"status":` em menos de 15 segundos (nunca fica pendurado).
- [ ] Em `/work/solo-leveling-3w0wvo`, clicar numa fonte que não responde mostra
      `Carregando capítulos de` e, no máximo 60 segundos depois, a frase
      `não respondeu.` com um botão `Tentar de novo`.
- [ ] Nenhuma fonte com `0` capítulos aparece na fileira, e não há dois botões
      com o mesmo nome e o mesmo idioma.
- [ ] Clicar em `Atualizar fontes` numa obra recarrega a página com a lista de
      capítulos já preenchida (não fica vazia esperando a fonte).

## Como testar (humano)

1. No terminal, dentro da pasta do projeto, rode `npm run dev -- -p 3100`. Abra
   `http://localhost:3100` e entre com sua conta. (Se precisar de uma conta:
   `npm run user -- add qaburro burro12345`; se disser que já existe, use
   `npm run user -- passwd qaburro burro12345`.)
2. Abra `http://localhost:3100/work/kingdom-1h0qhf1`. Em cima da lista de
   capítulos há uma fileira de fontes e, abaixo, uma fileira chamada
   "Grupos de scan".
3. Clique no segundo botão de "Grupos de scan". A lista de capítulos tem que
   mudar na hora, sem a página piscar nem virar blocos cinzas. Olhe o endereço no
   alto do navegador: ele tem que ter ganhado um pedaço com `scan=`.
4. Clique no segundo botão da fileira de fontes. Ele tem que ficar destacado no
   mesmo instante, e em poucos segundos a lista de capítulos tem que virar a
   dessa fonte. O endereço tem que ter ganhado um pedaço com `src=`.
5. Aperte F5 nesse mesmo endereço. A página tem que abrir já com essa fonte e
   esse grupo escolhidos.
6. Clique de volta na primeira fonte: a lista tem que trocar imediatamente, sem
   nenhuma espera.
7. Abra `http://localhost:3100/work/solo-leveling-3w0wvo` e clique numa fonte
   qualquer da fileira. Enquanto ela não responde, tem que aparecer o texto
   "Carregando capítulos de" com o nome da fonte. Se ela não responder, no máximo
   um minuto depois tem que aparecer a frase "não respondeu" e um botão
   "Tentar de novo".
8. Ainda nessa página, confira que nenhum botão de fonte mostra o número `0` do
   lado, e que não há dois botões com o mesmo nome.
9. Clique em "Atualizar fontes" e espere a página voltar: a lista de capítulos
   tem que aparecer preenchida.
