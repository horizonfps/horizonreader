---
id: T-030
title: Deixar o próximo/anterior do leitor seguir para a fonte que tem o capítulo
status: ready
blockedBy: [T-029]
files: [src/lib/crossSource.ts, src/app/reader/[chapterId]/page.tsx, src/components/Reader.tsx]
---

## O que fazer

Dentro do leitor, `‹ cap` e `cap ›` só andam dentro da fonte do capítulo aberto.
Quando essa fonte acaba (a fonte tem 50 capítulos e a obra tem 200) o rodapé
mostra `Fim.` e a leitura morre ali, mesmo com outra fonte da mesma obra tendo o
capítulo seguinte. O mesmo acontece com buraco no meio: a fonte pulou o capítulo
73, o leitor pula junto.

Passa a valer: quando a fonte aberta não tem o próximo (ou o anterior), o leitor
**atravessa para a fonte que tem**. O botão continua no mesmo lugar e ganha o
nome da fonte de destino ao lado, para ficar claro que trocou: `cap › · Manga
Livre`. No fim do capítulo, em vez de `Fim.`, aparece
`Próximo capítulo → (em Manga Livre)`.

## Onde mexer

### `src/lib/crossSource.ts` (novo)

Toda a busca fica aqui, fora da página, e usa `findChapterMatch` de
`src/lib/chapterMatch.ts` (T-029) para reconhecer o capítulo aberto dentro da
lista de outra fonte, mesmo quando a numeração é diferente.

```ts
export type Neighbour = {
  id: number;
  chapterNumber: number;
  sourceName: string | null;
  fromOtherSource: boolean;
};

export async function crossSourceNeighbours(input: {
  workId: number | null;
  mangaId: number;
  current: { id: number; name: string; chapterNumber: number; uploadDate: string | null };
  inSourceNext: { id: number; chapterNumber: number } | null;
  inSourcePrev: { id: number; chapterNumber: number } | null;
}): Promise<{ next: Neighbour | null; prev: Neighbour | null }>;
```

Regras, nesta ordem:

1. **Só trabalha quando precisa.** `needNext` é verdadeiro quando
   `inSourceNext` é nulo, ou quando o número atual é maior que zero e
   `inSourceNext.chapterNumber - current.chapterNumber > 1`. `needPrev` é o
   espelho (`current.chapterNumber - inSourcePrev.chapterNumber > 1`). Quando
   `workId` for nulo, ou quando nem `needNext` nem `needPrev` forem verdadeiros,
   devolva `{ next: inSource…, prev: inSource… }` com `fromOtherSource: false` e
   `sourceName: null`, **sem** tocar no banco.
2. Carregue as outras fontes da obra:
   `prisma.sourceLink.findMany({ where: { workId }, orderBy: [{ isPrimary: "desc" }, { healthScore: "desc" }] })`,
   descartando o link cujo `sourceMangaId` é igual a `input.mangaId` e os que
   têm `chapterCount` zero. Fique com **no máximo 3**.
3. Para cada um, pegue a lista de capítulos com o par que o resto do projeto já
   usa: `getCachedChapters(link)` de `@/lib/chapterCache` e, quando vier nulo,
   `loadChaptersForLink(link)` seguido de `setCachedChapters(link, lista)` se
   vier alguma coisa. Rode os links em `Promise.all` e engula erro (fonte que
   falha simplesmente não oferece candidato).
4. Ordene cada lista com `dedupeByNumber(lista)` de `@/lib/chapters` seguido de
   `.sort((a, b) => a.chapterNumber - b.chapterNumber)`.
5. Em cada lista, ache `equivalent = findChapterMatch(input.current, lista)`:
   - candidato a próximo: o item logo depois de `equivalent` na lista ordenada;
     sem `equivalent`, o primeiro item com `chapterNumber > current.chapterNumber`
     (só quando `current.chapterNumber > 0`);
   - candidato a anterior: o item logo antes de `equivalent`; sem `equivalent`, o
     último item com `chapterNumber < current.chapterNumber` (idem).
6. Escolha final do próximo, entre o candidato de dentro da fonte (quando
   existir) e os candidatos das outras fontes: vence o **menor**
   `chapterNumber` que ainda seja maior que o atual. Empate, ou números
   desconhecidos (zero), vence o de dentro da fonte; entre fontes diferentes,
   vence a que veio primeiro na ordem do passo 2. O anterior é o espelho (vence o
   **maior** número menor que o atual).
7. `sourceName` sai de `link.sourceName`; `fromOtherSource` é verdadeiro só
   quando o escolhido não é o de dentro da fonte.

Nunca lança: qualquer falha devolve os vizinhos de dentro da fonte.

### `src/app/reader/[chapterId]/page.tsx`

- O tipo `ReaderData` ganha `uploadDate: string | null`, `nextNumber: number | null`
  e `prevNumber: number | null`.
  - Em `loadNative`, `uploadDate` vem de
    `row.uploadDate ? String(row.uploadDate.getTime()) : null`; `nextNumber` e
    `prevNumber` saem do mesmo `siblings[idx ± 1]` que já calcula `prevId`/`nextId`.
  - Em `loadSuwayomi`, os três saem do array `ordered` que a função já monta
    (`ordered[idx].uploadDate`, `ordered[idx ± 1].chapterNumber`).
- Em `ReaderPage`, depois de `data` estar pronto e antes do `return`, chame
  `crossSourceNeighbours` com `workId: data.workId`, `mangaId: data.mangaId`,
  `current: { id: chapterId, name: data.title, chapterNumber: data.chapterNumber ?? 0, uploadDate: data.uploadDate }`
  e os vizinhos de dentro da fonte montados de `data.prevId`/`data.nextId` com
  `data.prevNumber`/`data.nextNumber` (nulo quando o id for nulo).
- Passe para `<Reader>`: `prevChapterId={cross.prev?.id ?? null}`,
  `nextChapterId={cross.next?.id ?? null}`,
  `prevSourceName={cross.prev?.fromOtherSource ? cross.prev.sourceName : null}` e
  `nextSourceName={cross.next?.fromOtherSource ? cross.next.sourceName : null}`.

### `src/components/Reader.tsx`

- O tipo `Props` ganha `prevSourceName?: string | null` e
  `nextSourceName?: string | null`.
- No rodapé que aparece com as barras abertas, os dois `<Link>` de capítulo
  passam a mostrar o nome da fonte quando ele existir:
  `‹ cap` vira `‹ cap · {prevSourceName}` e `cap ›` vira `cap › · {nextSourceName}`,
  com `max-w-[9rem] truncate` no trecho do nome para não estourar a barra.
- No fim do capítulo (o bloco do `endRef`, onde hoje fica o botão
  `Próximo capítulo →` ou o texto `Fim.`), quando `nextSourceName` existir o
  botão mostra `Próximo capítulo → (em {nextSourceName})`. Sem `nextChapterId`,
  continua `Fim.`.
- Nada mais do leitor muda: o pré-carregamento do próximo capítulo (o
  `router.prefetch` e o `fetch` de `/api/chapter-pages`) já usa `nextChapterId` e
  passa a aquecer o capítulo da outra fonte de graça.

## Fora do escopo

- Escolher a fonte por qualidade de imagem ou por idioma: a ordem é a que o
  banco já dá (fonte primária, depois maior nota de saúde).
- Mudar a fonte escolhida na página da obra ao voltar do leitor.
- Baixar sozinho o capítulo da outra fonte.
- Casar capítulos por conteúdo (imagem, número de páginas).
- Emendar a lista de capítulos de várias fontes numa lista só na página da obra.

## Pronto quando

- [ ] `npm run build` passa.
- [ ] Abrindo o **último** capítulo de uma fonte que tem menos capítulos que
      outra fonte da mesma obra, o rodapé do leitor mostra
      `Próximo capítulo → (em <nome da outra fonte>)` em vez de `Fim.`.
- [ ] Clicar nesse botão abre o capítulo seguinte, e o leitor carrega as páginas
      normalmente.
- [ ] Com as barras abertas nesse mesmo capítulo, o botão de baixo à direita
      mostra `cap ›` seguido do nome da outra fonte.
- [ ] Num capítulo do meio, com a fonte aberta tendo o próximo capítulo, o botão
      `cap ›` continua **sem** nome de fonte e abre o capítulo da mesma fonte.
- [ ] Abrindo o **primeiro** capítulo de uma fonte que começa depois do começo da
      obra, o botão `‹ cap` aparece com o nome da outra fonte e abre o capítulo
      anterior.
- [ ] Numa obra com uma fonte só, o leitor continua mostrando `Fim.` no último
      capítulo.

## Como testar (humano)

1. No terminal, dentro da pasta do projeto, rode `npm run dev -- -p 3100`. Abra
   `http://localhost:3100` e entre com sua conta. (Se precisar de uma conta:
   `npm run user -- add qaburro burro12345`; se disser que já existe, use
   `npm run user -- passwd qaburro burro12345`.)
2. Abra `http://localhost:3100/work/solo-leveling-3w0wvo`. Em cima da lista de
   capítulos há uma fileira de fontes, e cada uma mostra um número do lado: é
   quantos capítulos ela tem.
3. Clique na fonte com o **menor** número de capítulos e espere a lista
   recarregar.
4. Clique no capítulo mais recente dessa fonte (o primeiro da lista) para abrir o
   leitor.
5. Role até o fim do capítulo. No lugar de `Fim.`, tem que aparecer um botão
   `Próximo capítulo →` com o nome de outra fonte entre parênteses.
6. Clique nesse botão: o capítulo seguinte tem que abrir e mostrar as páginas.
7. Volte para a obra, clique na fonte com o **maior** número de capítulos e abra
   um capítulo do meio da lista.
8. Clique uma vez no meio da tela para abrir as barras: o botão `cap ›` no canto
   de baixo à direita tem que aparecer **sem** nome de fonte nenhum.
9. Clique nele: o capítulo seguinte da mesma fonte tem que abrir.
