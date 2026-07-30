---
id: T-004
title: Persistir a lista de capítulos das fontes Suwayomi e revalidar em segundo plano
status: ready
blockedBy: []
files: [prisma/schema.prisma, src/lib/chapterCache.ts, src/app/(app)/work/[slug]/page.tsx]
---

## O que fazer

A lista de capítulos de uma obra hoje só existe na memória do processo, por 5
minutos. Passou disso, ou reiniciou o app, e abrir a obra volta a esperar o
engine de scans responder — que é a parte lenta da página.

Depois deste ticket a lista fica gravada no banco por fonte. Abrir a obra pinta
a lista na hora, mesmo depois de reiniciar o app, e a atualização acontece por
trás. Fonte de scraper nativo já é persistida hoje (modelo `ScrapedChapter`);
este ticket faz o equivalente para as fontes que vêm do Suwayomi.

## Onde mexer

**`prisma/schema.prisma`** (li inteiro, 174 linhas): acrescente um modelo novo,
seguindo o estilo dos que já existem (comentário curto em inglês por cima,
`onDelete: Cascade` na relação):

```prisma
model ChapterListCache {
  id           Int        @id @default(autoincrement())
  sourceLinkId Int        @unique
  payload      String     // JSON array of chapters, as served to the page
  fetchedAt    DateTime   @default(now())
  sourceLink   SourceLink @relation(fields: [sourceLinkId], references: [id], onDelete: Cascade)
}
```

E a contrapartida em `SourceLink`: `chapterCache ChapterListCache?`.

Depois de editar o schema, rode `npm run db:push` no ambiente local para o banco
de desenvolvimento ganhar a tabela (no Docker o `prisma db push` já roda sozinho
no start, veja o `CMD` do `Dockerfile`).

**`src/lib/chapterCache.ts`** (li inteiro, 33 linhas): hoje é um Map com TTL de 5
minutos e chave em string. Reescreva mantendo o tier de memória na frente e
acrescentando o tier de banco. A API passa a receber o link inteiro em vez da
chave (o chamador já tem o objeto):

- `getCachedChapters<T>(link: { id: number; kind?: string | null; sourceMangaId: number }): Promise<{ data: T; stale: boolean } | null>`
  - Memória primeiro (TTL de 30 minutos, teto de 500 entradas, chave igual à de
    hoje: `n:${id}` para scraper, `s:${sourceMangaId}` para Suwayomi).
  - Depois, só quando `kind !== "scraper"`, a linha de `ChapterListCache` por
    `sourceLinkId`. Linha com mais de 7 dias conta como miss. Ao acertar,
    preenche a memória.
  - `stale: true` quando a origem do acerto tem mais de 30 minutos.
- `setCachedChapters(link, data): Promise<void>` — grava na memória e, para link
  que não é scraper, faz `upsert` da linha com `payload` serializado e
  `fetchedAt` atualizado.
- `bustChapters(links): Promise<void>` — limpa memória e apaga as linhas
  correspondentes (`deleteMany` por `sourceLinkId`).
- `revalidateChapters(link, load: () => Promise<unknown[]>): void` — dispara uma
  releitura em segundo plano e regrava o cache; deduplicada por id de link num
  Map de in-flight; erro engolido; nunca aguardada por quem chama.
- Erro de banco nunca sobe: cache é best-effort, igual ao resto do projeto.

**`src/app/(app)/work/[slug]/page.tsx`** (li inteiro, 402 linhas). O trecho a
mudar é o bloco `if (selected) { … }` dentro de `SourcesAndChapters`, onde hoje
está `chapterCacheKey` + `getCachedChapters` + `setCachedChapters`:

- Extraia a leitura de verdade numa função local `loadChapters()` com o código
  que já existe (scraper → `getNativeChapters(selected.id)`; Suwayomi →
  `getMangaEnsured` quando `!selected.chapterCount` e depois
  `getChapters(selected.sourceMangaId)`).
- Fluxo novo: `const hit = await getCachedChapters<ChapterView[]>(selected)`.
  - Acertou → usa `hit.data`; se `hit.stale`, chama
    `revalidateChapters(selected, loadChapters)` sem `await`.
  - Não acertou → `chapters = await loadChapters()` e, se vier algo,
    `await setCachedChapters(selected, chapters)`.
- No bloco do `refresh` (linhas ~192-199), `bustChapters` passa a ser aguardado
  e recebe os objetos de link (o `findMany` logo acima já seleciona
  `id`, `kind` e `sourceMangaId`). **Armadilha:** `redirect()` lança por dentro;
  o `await bustChapters(...)` tem que vir ANTES do `redirect`, nunca dentro de
  try/catch em volta dele.
- `chapterCacheKey` deixa de ser importado aqui se não for mais usado.

Comentários novos em inglês, curtos.

## Fora do escopo

- Mudar como o leitor (`src/app/reader/[chapterId]/page.tsx`) busca capítulo
  vizinho; ele continua indo no engine.
- Persistir as páginas do capítulo (imagens) — já existe cache de disco para
  isso em outro caminho.
- Job que atualiza a lista de capítulos sozinho, sem ninguém abrir a obra: é da
  próxima rodada.
- Mexer no modelo `ScrapedChapter` ou em `src/lib/scrapers/native.ts`.
- Criar migration versionada: o projeto usa `prisma db push`.

## Pronto quando

- [ ] O schema tem `ChapterListCache` com `sourceLinkId` único e cascade, e
      `SourceLink` tem a relação de volta.
- [ ] `getCachedChapters`/`setCachedChapters`/`bustChapters` são assíncronas e
      recebem o link, não a chave.
- [ ] Linha de cache com mais de 7 dias não é usada.
- [ ] Acerto com mais de 30 minutos é servido na hora e dispara revalidação em
      segundo plano, deduplicada por link.
- [ ] Link de scraper nativo continua sem gravar linha nova (ele já tem
      `ScrapedChapter`).
- [ ] Depois de abrir uma obra e reiniciar o app, abrir a mesma obra mostra a
      lista de capítulos sem ficar no esqueleto de carregamento.
- [ ] O botão de atualizar fontes apaga a linha persistida e a lista é buscada
      de novo.
- [ ] `npm run build` passa.

## Como testar (humano)

1. Suba o app, abra uma obra qualquer e espere a lista de capítulos aparecer.
2. Reinicie o app (`docker compose restart web`) e espere subir.
3. Abra a mesma obra: a lista de capítulos tem que aparecer imediatamente, sem
   as barrinhas cinzas de carregamento.
4. Clique no botão de atualizar fontes dessa obra. A página recarrega e a lista
   volta (pode demorar alguns segundos nessa vez, é o esperado).
5. Abra uma obra que você nunca abriu: a primeira vez continua demorando o
   normal; feche e abra de novo e agora tem que ser instantâneo.
