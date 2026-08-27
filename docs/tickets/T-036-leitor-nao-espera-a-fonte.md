---
id: T-036
title: Abrir um capítulo sem esperar a fonte devolver a lista de capítulos
status: ready
blockedBy: []
files: [src/app/reader/[chapterId]/page.tsx, src/lib/crossSource.ts]
---

## O que fazer

Abrir um capítulo hoje custa muito mais do que as páginas dele. Antes de mostrar
qualquer coisa, o leitor pergunta ao motor de scans a lista inteira de capítulos
daquela fonte (todas as vezes, sem aproveitar a lista já guardada) e ainda vai
buscar a lista de até três outras fontes da mesma obra, para saber se o próximo
capítulo está em outro lugar. Quando alguma dessas fontes está lenta, o capítulo
não abre.

Passa a valer: **abrir um capítulo não vai mais à fonte para montar o `‹ cap` e o
`cap ›`.** As listas saem do que já está guardado. Quando a lista da fonte aberta
ainda não estiver guardada, o leitor espera no máximo 6 segundos por ela e, se
não vier, abre mesmo assim com as páginas do capítulo, apenas sem os botões de
anterior/próximo — e manda buscar a lista em segundo plano, para a próxima vez já
estar pronta. O pulo para outra fonte quando a fonte aberta acabou (o
comportamento do T-030) continua funcionando exatamente igual.

## Onde mexer

### `src/app/reader/[chapterId]/page.tsx`

Em `loadSuwayomi`, hoje a lista vem de `await getChapters(mangaId).catch(() => [])`
e só depois é que o `SourceLink` é consultado, para descobrir a obra. Inverta:

1. Suba o `const link = await prisma.sourceLink.findFirst({ where: { sourceMangaId: mangaId }, include: { work: true } });`
   para antes de montar a lista (o restante da função continua usando `link` como
   já usa).
2. Com `link`, a lista passa a vir do cache: `getCachedChapters<SuwayomiChapter[]>(link)`
   de `@/lib/chapterCache`. Acertou → use `hit.data`, e quando `hit.stale` chame
   `revalidateChapters(link)` sem esperar.
3. Não acertou → corra `loadChaptersForLink(link)` contra um timer de 6 segundos
   com `Promise.race`, usando `new Promise((r) => setTimeout(() => r(null), 6_000))`
   do outro lado. Veio lista não vazia → `setCachedChapters(link, lista)` e use.
   Estourou ou veio vazia → `void refreshChapters(link)` e siga com `[]`.
4. Sem `link` nenhum (mangá que não está ligado a nenhuma obra), mantenha o
   `getChapters(mangaId).catch(() => [])` de hoje como último recurso.

Com a lista em mãos, o resto de `loadSuwayomi` fica idêntico: filtro por
`scanlatorKey` do capítulo aberto (as listas guardadas trazem `scanlator`),
`dedupeByNumber(pool, chapterId)`, ordenação crescente, `idx` e os
`prevId`/`nextId`/`prevNumber`/`nextNumber`. Lista vazia significa `idx === -1`,
que a função já trata: título vazio e vizinhos nulos.

Nada mais da página muda — `storedChapter`, `loadNative`, o `Progress` e a
chamada a `crossSourceNeighbours` continuam onde estão.

### `src/lib/crossSource.ts`

`chaptersOf` é o que hoje pode ir à rede três vezes no caminho da requisição.
Regra nova, decidida pelo tipo do link:

- `link.kind === "scraper"`: continua como hoje (`getCachedChapters` e, no vazio,
  `loadChaptersForLink` + `setCachedChapters`). É leitura do banco local, barata.
- Qualquer outro tipo (Suwayomi): **só cache**. `getCachedChapters(link)` acertou
  → segue com `hit.data` e, se `hit.stale`, `revalidateChapters(link)`. Não
  acertou → `void refreshChapters(link)` e devolva `[]`, sem esperar.

O resto de `crossSourceNeighbours` fica igual: os mesmos `needNext`/`needPrev`,
o mesmo corte em `MAX_SOURCES`, o mesmo `findChapterMatch`, o mesmo
`pickNext`/`pickPrev` e o mesmo retorno de `fallback` quando algo falha. Uma
fonte que devolve `[]` simplesmente não oferece candidato, que é o comportamento
que a função já espera.

Importe `refreshChapters` e `revalidateChapters` de `@/lib/chapterCache`.

## Fora do escopo

- Trocar de fonte de dentro do leitor.
- Mudar o pré-carregamento do próximo capítulo (`router.prefetch` e
  `/api/chapter-pages`) ou o cache de imagens.
- Mudar como o progresso de leitura é salvo.
- Mudar a página da obra.
- Aumentar `MAX_SOURCES` ou a ordem em que as outras fontes são consultadas.
- Buscar páginas de capítulo com prazo diferente: só a **lista de capítulos**
  muda de caminho.

## Pronto quando

- [ ] `npm run build` passa.
- [ ] `crossSourceNeighbours` nunca chama `loadChaptersForLink` para um link cujo
      `kind` seja diferente de `"scraper"`; nesse caso ela dispara
      `refreshChapters` e segue com lista vazia.
- [ ] `loadSuwayomi` só chama `getChapters` direto quando não existe `SourceLink`
      para aquele `mangaId`.
- [ ] Quando não há lista guardada, `loadSuwayomi` espera no máximo 6 segundos
      pela fonte e depois segue sem vizinhos, em vez de segurar a página.
- [ ] Abrir `http://localhost:3100/work/gyakusatsu-happy-end-luozhk?src=915` e
      clicar no primeiro capítulo da lista abre o leitor com as páginas em menos
      de 30 segundos.
- [ ] Nesse capítulo (o último dessa fonte), o fim da leitura mostra
      `Próximo capítulo →` com o nome de outra fonte entre parênteses, em vez de
      `Fim.`.
- [ ] Clicar nesse botão abre o capítulo seguinte e mostra as páginas.
- [ ] Num capítulo do meio de uma fonte que tem o próximo, o botão `cap ›`
      continua sem nome de fonte e abre o capítulo da mesma fonte.

## Como testar (humano)

1. No terminal, dentro da pasta do projeto, rode `npm run dev -- -p 3100`. Abra
   `http://localhost:3100` e entre com sua conta. (Se precisar de uma conta:
   `npm run user -- add qaburro burro12345`; se disser que já existe, use
   `npm run user -- passwd qaburro burro12345`.)
2. Abra `http://localhost:3100/work/gyakusatsu-happy-end-luozhk?src=915`. Vai
   aparecer a lista de capítulos da fonte "Manga Livre", que é a fonte com menos
   capítulos dessa obra.
3. Clique no primeiro capítulo da lista (o de número mais alto). O leitor tem que
   abrir e mostrar as páginas em até meio minuto.
4. Role até o fim do capítulo. No lugar de "Fim.", tem que aparecer um botão
   "Próximo capítulo →" com o nome de outra fonte entre parênteses.
5. Clique nesse botão: o capítulo seguinte tem que abrir e mostrar as páginas.
6. Volte para `http://localhost:3100/work/gyakusatsu-happy-end-luozhk?src=914` e
   abra um capítulo do meio da lista.
7. Clique uma vez no meio da tela para abrir as barras. O botão do canto de baixo
   à direita tem que aparecer **sem** nome de fonte nenhum, e clicar nele tem que
   abrir o capítulo seguinte da mesma fonte.
