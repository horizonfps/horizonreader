---
id: T-029
title: Casar capítulos entre fontes também por nome e por data, não só pelo número
status: ready
blockedBy: []
files: [src/lib/chapterMatch.ts, scripts/chapter-match-test.ts, package.json, src/app/(app)/work/[slug]/page.tsx]
---

## O que fazer

Uma obra costuma ter várias fontes, e cada fonte nomeia e numera os capítulos do
seu jeito. Hoje o app só reconhece que "é o mesmo capítulo em outra fonte"
quando as duas fontes usam **exatamente o mesmo número**, e capítulo com número
zero ou desconhecido nunca casa. Resultado: numa fonte que não numera (só
`Ato final`, `Extra`, nomes assim), ou que numera por temporada, a etiqueta
`Baixado em outra fonte` nunca aparece e o app baixa o mesmo capítulo de novo.

Passa a valer o casamento por três sinais: **número**, **nome** e **data de
publicação**. Dois capítulos são o mesmo quando os números batem; quando os
números não existem mas o nome, limpo de "Capítulo/Chapter/Cap.", é igual; ou
quando nenhum dos dois tem número nem nome comparável e foram publicados dentro
da mesma janela de 12 horas. Números diferentes continuam sendo prova de que
**não** é o mesmo capítulo, a não ser que o nome seja idêntico (fonte que numera
por temporada contra fonte que numera corrido).

Na tela da obra isso aparece assim: capítulos já baixados por outra fonte passam
a mostrar `Baixado em outra fonte` (e abrir o arquivo do disco) também quando o
número não bate ou não existe.

## Onde mexer

### `src/lib/chapterMatch.ts` (novo)

Módulo puro, sem banco e sem rede. `src/lib/chapters.ts` já existe e exporta
`uploadMs(c)` (converte `uploadDate`, que vem como epoch em milissegundos numa
string, para número); reaproveite-o, não reescreva.

```ts
export type MatchChapter = {
  id: number;
  name?: string | null;
  chapterNumber?: number | null;
  uploadDate?: string | null;
};

export const MATCH_ACCEPT = 0.4;

export function chapterNameKey(name?: string | null): string;
export function numberFromName(name?: string | null): number;
export function matchScore(a: MatchChapter, b: MatchChapter): number;
export function findChapterMatch<T extends MatchChapter>(
  target: MatchChapter,
  candidates: T[],
): T | null;
```

- `chapterNameKey`: minúsculas, acentos removidos com `normalize("NFD").replace(/[̀-ͯ]/g, "")`, prefixos de rótulo
  removidos do começo, repetidamente, com
  `/^(capitulo|cap|chapter|chap|ch|episodio|ep)\b[\s.:#\-–—]*/`, tudo que não
  for letra ou dígito virando espaço, espaços colapsados, `trim`. Se o que
  sobrar for só dígitos e pontos (`/^[\d.]+$/`), devolva `""` — nome que é só o
  número não acrescenta nada ao número.
- `numberFromName`: primeiro número (aceitando decimal com ponto) que aparece no
  nome depois de tirar os mesmos prefixos; `0` quando não houver.
- `matchScore(a, b)`, exatamente nesta ordem:

```ts
const numOf = (c) => {
  const n = Number(c.chapterNumber);
  return Number.isFinite(n) && n > 0 ? n : numberFromName(c.name);
};
const na = numOf(a), nb = numOf(b);
const ka = chapterNameKey(a.name), kb = chapterNameKey(b.name);
const ta = uploadMs(a), tb = uploadMs(b);

if (na > 0 && nb > 0) {
  if (na === nb) return 1;
  if (ka && ka === kb) return 0.8;
  return 0;
}
if (ka && ka === kb) return 0.8;
if (ta && tb && Math.abs(ta - tb) <= 12 * 3_600_000) return 0.4;
return 0;
```

- `findChapterMatch`: percorre `candidates`, ignora quem tem o mesmo `id` do
  alvo, calcula `matchScore` e fica com o maior. Empate: menor diferença de data
  e, persistindo, menor `id`. Devolve `null` quando o melhor ficar abaixo de
  `MATCH_ACCEPT`.

### `scripts/chapter-match-test.ts` (novo) e `package.json`

Mesmo formato de `scripts/match-test.ts` (que já existe e testa o casador de
títulos): uma lista de casos, um `console.log` por caso com `ok`/`FAIL`, a
contagem no fim e `process.exit(1)` quando algum falhar. Registre em
`package.json`:
`"chapter-match-test": "node --experimental-strip-types scripts/chapter-match-test.ts"`.

Casos obrigatórios (alvo, candidato, esperado):

1. `{n:5,"Chapter 5"}` × `{n:5,"Cap. 5"}` → casa.
2. `{n:5,"Chapter 5"}` × `{n:6,"Chapter 6"}`, mesma data → **não** casa.
3. `{n:0,"Ato Final"}` × `{n:0,"ato final"}` → casa.
4. `{n:0,"Capítulo 12"}` × `{n:12,"Ch. 12"}` → casa.
5. `{n:7,"Capítulo 7 – O Retorno"}` × `{n:7,"Chapter 7: O Retorno"}` → casa.
6. `{n:0,"Extra"}` × `{n:0,"Bônus"}`, publicados com 2 h de diferença → casa
   (regra da data).
7. `{n:0,"Extra"}` × `{n:0,"Bônus"}`, publicados com 3 dias de diferença →
   **não** casa.
8. `{n:2,"Temporada 2 Capítulo 1"}` × `{n:26,"Temporada 2 Capítulo 1"}` → casa
   (nomes iguais vencem números diferentes).
9. `{n:0,""}` × `{n:0,""}`, sem data → **não** casa.
10. `{n:10.5,"Chapter 10.5"}` × `{n:10.5,"Cap 10.5"}` → casa.
11. `{n:10.5,"Chapter 10.5"}` × `{n:10,"Chapter 10"}` → **não** casa.

### `src/app/(app)/work/[slug]/page.tsx`

Tudo dentro de `SourcesAndChapters`. Hoje o arquivo monta
`doneCandidatesByNumber` e depois `downloadedByNumber` (número → `chapterId`
baixado) e usa esse mapa em dois lugares: na linha de cada capítulo
(`mirroredId`) e no botão de continuar leitura (`resumeMirroredId`). Troque o
mapa por um casamento de verdade:

1. Continue montando `workDownloads`, `downloadStatusByChapter` e
   `doneByMangaId` como estão hoje (a escolha da fonte mais baixada não muda).
   Remova `doneCandidatesByNumber` e `downloadedByNumber`.
2. Depois de `selected` e da lista `chapters` da fonte escolhida já estarem
   carregados, monte a lista de candidatos baixados:
   - `const doneIds = new Set(workDownloads.filter((r) => r.status === "DONE").map((r) => r.chapterId));`
   - `const scanLinks = links.filter((l) => (doneByMangaId.get(l.sourceMangaId) ?? 0) > 0).slice(0, 4);`
   - para cada link de `scanLinks`: se for o `selected`, reaproveite o array
     `chapters` que a página já carregou; senão, carregue a lista dele com o
     mesmo par que a página já usa — `getCachedChapters(link)` e, no vazio,
     `loadChaptersForLink(link)` seguido de `setCachedChapters(link, lista)`
     quando vier alguma coisa. Faça os links em `Promise.all`.
   - junte num array só os capítulos cujo `id` está em `doneIds`:
     `downloadedElsewhere`.
3. Na `map` de `visible`, troque a linha do `mirroredId` por:

```ts
const ownStatus = downloadStatusByChapter.get(c.id) ?? null;
const mirrored = ownStatus === "DONE" ? null : findChapterMatch(c, downloadedElsewhere);
const mirroredId = mirrored?.id ?? null;
const status = ownStatus ?? (mirroredId ? "DONE" : null);
```

   O `<Link>` continua apontando para `/reader/${mirroredId ?? c.id}`, a etiqueta
   `Baixado em outra fonte` continua aparecendo quando `mirroredId` existir e o
   `DownloadButton` continua recebendo `initialStatus={status}`.
4. O mesmo para o botão de continuar: `resumeMirroredId` passa a sair de
   `findChapterMatch(resumeChapter, downloadedElsewhere)`, onde `resumeChapter` é
   a linha de `chaptersAsc` cujo `id` é `resume.chapterId` (a lista já está
   montada ali). Sem essa linha, `resumeMirroredId` é `null`.

Um capítulo que aparece na própria lista visível nunca deve casar consigo mesmo:
`findChapterMatch` já ignora candidato com o mesmo `id`.

## Fora do escopo

- Trocar de fonte dentro do leitor (o próximo/anterior atravessar fontes) — é
  outro ticket, que vai usar este casador.
- Casar obras entre fontes (isso é `src/lib/backbone/normalize.ts` e não muda).
- Baixar sozinho o capítulo que falta na fonte aberta.
- Mexer na fila de download, na API de download ou na tela `Downloads`.
- Casar por quantidade de páginas ou por conteúdo da imagem.

## Pronto quando

- [ ] `npm run build` passa.
- [ ] `npm run chapter-match-test` roda e imprime `11/11 passed` (ou o total de
      casos escritos), saindo com sucesso.
- [ ] Com um capítulo baixado (`Concluído`) por uma fonte, abrir a obra em outra
      fonte que numera igual mostra a etiqueta `Baixado em outra fonte` na linha
      correspondente, e o botão do lado aparece como `Baixado` e desabilitado.
- [ ] Clicar nessa linha abre o leitor com a etiqueta `Baixado` na barra de cima.
- [ ] Um capítulo sem nada baixado continua abrindo o capítulo da fonte aberta,
      com o botão `Baixar` normal e sem etiqueta.
- [ ] Com o mesmo capítulo baixado na própria fonte aberta, a etiqueta
      `Baixado em outra fonte` **não** aparece.

## Como testar (humano)

1. No terminal, dentro da pasta do projeto, rode
   `npm run chapter-match-test`. Tem que terminar dizendo que todos os casos
   passaram.
2. Rode `npm run dev -- -p 3100`, abra `http://localhost:3100` e entre com sua
   conta. (Se precisar de uma conta: `npm run user -- add qaburro burro12345`;
   se disser que já existe, use `npm run user -- passwd qaburro burro12345`.)
3. Abra `http://localhost:3100/work/solo-leveling-3w0wvo`. Em cima da lista de
   capítulos há uma fileira de fontes; anote qual está destacada.
4. Clique em outra fonte da fileira que também mostre bastante capítulo e espere
   a lista recarregar.
5. Role até o fim da lista e clique no botão `Baixar` da linha do capítulo 1.
6. Abra `http://localhost:3100/downloads` e espere esse capítulo ficar
   `Concluído` (recarregue de vez em quando).
7. Volte para `http://localhost:3100/work/solo-leveling-3w0wvo` e clique na
   primeira fonte (a que estava destacada no passo 3).
8. Ache o capítulo 1 nessa fonte: ele tem que mostrar a etiqueta
   `Baixado em outra fonte`, e o botão do lado tem que estar escrito `Baixado` e
   sem poder clicar.
9. Clique nesse capítulo. No leitor, clique uma vez no meio da tela: na barra de
   cima tem que aparecer a etiqueta `Baixado`.
10. Volte para a obra e abra um capítulo que você não baixou: ele não pode ter a
    etiqueta `Baixado em outra fonte`, e o botão do lado continua escrito
    `Baixar`.
