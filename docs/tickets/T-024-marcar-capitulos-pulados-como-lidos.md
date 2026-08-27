---
id: T-024
title: Marcar sozinho como lidos os capítulos pulados ao terminar um capítulo
status: ready
blockedBy: []
files: [src/lib/skippedChapters.ts, src/app/api/progress/route.ts]
---

## O que fazer

Quem pula capítulos fica com a lista da obra toda esburacada: você leu o
capítulo 100, mas do 1 ao 99 continuam sem marca de lido, e a contagem de
leitura do perfil fica errada.

Passa a valer a regra óbvia: **terminar um capítulo marca como lidos todos os
capítulos anteriores daquela fonte que nunca foram abertos**. Ao voltar para a
página da obra depois de terminar o capítulo 100, os capítulos 1 a 99 aparecem
com a marca de lido e o texto acinzentado, e o botão de continuar leitura segue
apontando para o 101.

Capítulo que você começou e largou pela metade não é tocado — ele continua como
está, para não perder a página onde você parou.

## Onde mexer

### `src/lib/skippedChapters.ts` (novo)

Módulo de servidor. Exporta uma função só:

```ts
export async function markSkippedAsRead(input: {
  userId: number;
  mangaId: number;
  chapterId: number;
  workId: number | null;
  chapterNumber: number | null;
}): Promise<number>;
```

Passos (nada aqui pode lançar; qualquer falha vira `return 0`):

1. Ache a fonte: `prisma.sourceLink.findFirst({ where: { sourceMangaId: input.mangaId } })`.
   Sem fonte, devolva 0.
2. Pegue a lista de capítulos dessa fonte com o cache que já existe em
   `@/lib/chapterCache`: `getCachedChapters<RawChapter[]>(link)`; no miss, use
   `loadChaptersForLink(link)` e grave com `setCachedChapters(link, chapters)`.
   Lista vazia devolve 0. (`RawChapter` vem de `@/lib/chapters`.)
3. Fique dentro do mesmo grupo de scan do capítulo terminado, como a rota
   `src/app/continue/[workId]/route.ts` já faz: `groupByScanlator(chapters)` e
   o grupo cujo `chapters` contém o `chapterId`; se nenhum grupo contiver, use
   o primeiro. Depois `dedupeByNumber(group.chapters)`.
4. O número do capítulo atual é o `chapterNumber` da linha encontrada na lista;
   se ele não estiver na lista, use `input.chapterNumber`. Sem número maior que
   zero, devolva 0.
5. Candidatos: capítulos do grupo com `chapterNumber > 0` e
   `chapterNumber < atual`. Ordene do maior para o menor e corte em 500 (uma
   obra com mil capítulos não pode virar mil escritas numa requisição de
   progresso).
6. Tire os que já têm progresso:
   `prisma.progress.findMany({ where: { userId, chapterId: { in: ids } }, select: { chapterId: true } })`.
   Linha existente nunca é alterada — nem a que está `read: false`.
7. Grave o que faltou com `prisma.progress.createMany({ data })`, cada item
   `{ userId, workId: input.workId ?? link.workId, mangaId: input.mangaId, chapterId, chapterNumber, lastPageRead: 0, read: true }`.
   **Não** use `skipDuplicates` (SQLite não suporta) — o passo 6 já garante que
   não há duplicata. Devolva quantas linhas foram criadas.

Não escreva nada em `ReadingHistory`: capítulo pulado não é evento de leitura,
e a linha do tempo do perfil não pode ganhar cem entradas falsas.

### `src/app/api/progress/route.ts`

No `POST`, dentro do `try` que já existe, **depois** do `prisma.progress.upsert`
e do bloco de `ReadingHistory`, quando `read` for verdadeiro chame
`await markSkippedAsRead({ userId: session.uid, mangaId, chapterId, workId, chapterNumber })`.
A resposta continua `{ ok: true }` — acrescente o campo `autoRead` com a
quantidade devolvida, para dar como conferir sem abrir o banco:
`{ ok: true, autoRead: <n> }`. O caminho de erro já existente (`catch` →
`{ ok: false }`) fica igual.

## Fora do escopo

- Marcar como lido o que está em outra fonte da mesma obra (a regra é por
  fonte, dentro do mesmo grupo de scan).
- Desfazer: não existe botão para desmarcar em massa.
- Mexer em `src/lib/continueReading.ts` ou na tela da obra — a marca de lido já
  é desenhada a partir das linhas de progresso.
- Criar eventos de leitura (`ReadingHistory`) ou mudar a exportação do perfil.

## Pronto quando

- [ ] `npm run build` passa.
- [ ] Terminar um capítulo do meio da lista faz todos os capítulos de número
      menor daquela fonte, que não tinham progresso, aparecerem com a marca de
      lido na página da obra.
- [ ] Os capítulos de número maior que o terminado continuam sem marca de lido.
- [ ] Um capítulo que estava começado pela metade (progresso salvo, não lido)
      continua sem marca de lido e mantém a página onde parou.
- [ ] `POST /api/progress` com `read: true` responde `{ "ok": true, "autoRead": <n> }`,
      e repetir a mesma chamada logo em seguida responde `"autoRead": 0`.
- [ ] `POST /api/progress` com `read: false` não marca nada (`autoRead` ausente
      ou zero) e não cria linha de progresso para outro capítulo.
- [ ] O botão de continuar leitura da obra continua apontando para o capítulo
      seguinte ao que foi terminado.

## Como testar (humano)

1. No terminal rode `npm run dev -- -p 3100`, abra `http://localhost:3100` e
   entre com sua conta. (Se precisar de uma conta:
   `npm run user -- add qaburro burro12345`; se disser que já existe, use
   `npm run user -- passwd qaburro burro12345`.)
2. Abra `http://localhost:3100/work/solo-leveling-3w0wvo`. A lista mostra os
   capítulos do maior número para o menor. Anote o nome de um capítulo do meio
   da lista e clique nele.
3. No leitor, role até o fim do capítulo, onde aparece o botão
   `Próximo capítulo →`. Espere dois segundos.
4. Volte para `http://localhost:3100/work/solo-leveling-3w0wvo` (use o botão de
   voltar do leitor) e recarregue a página.
5. Todos os capítulos abaixo do que você leu (números menores) têm que aparecer
   acinzentados e com a marca de confirmação de lido, do lado direito da linha.
6. Os capítulos acima do que você leu (números maiores) continuam sem marca.
7. Clique no botão azul do topo da lista de capítulos: ele tem que abrir o
   capítulo seguinte ao que você leu, não um capítulo antigo.
