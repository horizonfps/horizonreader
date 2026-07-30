---
id: T-007
title: Persistir a lista de capítulos das fontes Suwayomi e revalidar em segundo plano
status: ready
blockedBy: []
files: [prisma/schema.prisma, src/lib/chapterCache.ts, src/app/(app)/work/[slug]/page.tsx]
---

> Rodada de otimização de navegação, segunda leva. Os IDs T-001..T-006 em
> `docs/tickets/` são de rodadas ANTERIORES (uma sobre solvers, outra sobre a
> primeira leva desta otimização). Ignore-os: este ticket é o T-007.

## O que fazer

A lista de capítulos de uma obra hoje só existe na memória do processo, por 5
minutos. Passou disso, ou o app reiniciou, e abrir a obra volta a esperar o
engine de scans responder, que é a parte lenta da página.

Depois deste ticket a lista fica gravada no banco, por fonte. Abrir a obra pinta
a lista na hora, mesmo depois de reiniciar o app, e a atualização acontece por
trás. Fonte de scraper nativo já é persistida hoje (modelo `ScrapedChapter`);
este ticket faz o equivalente para as fontes que vêm do Suwayomi.

Além disso, a função que realmente busca a lista sai de dentro da página e vira
uma função exportada, porque outros dois tickets desta mesma rodada (T-009 e
T-010) vão chamá-la de um laço de segundo plano.

## Onde mexer

### `prisma/schema.prisma` (li inteiro, 174 linhas)

Acrescente um modelo novo, seguindo o estilo dos que já existem (comentário
curto em inglês por cima, `onDelete: Cascade` na relação):

```prisma
model ChapterListCache {
  id           Int        @id @default(autoincrement())
  sourceLinkId Int        @unique
  payload      String // JSON array of chapters, as served to the page
  fetchedAt    DateTime   @default(now())
  sourceLink   SourceLink @relation(fields: [sourceLinkId], references: [id], onDelete: Cascade)
}
```

E a contrapartida dentro de `model SourceLink`: `chapterCache ChapterListCache?`.

Depois de editar o schema, rode `npm run db:push` para o banco de
desenvolvimento ganhar a tabela. Não crie migration versionada: o projeto usa
`prisma db push` (o `CMD` do `Dockerfile` roda `npx prisma db push` no start).
`npm run build` já roda `prisma generate` antes do `next build`, então o cliente
tipado nasce sozinho.

### `src/lib/chapterCache.ts` (li inteiro, 33 linhas)

Hoje é um `Map` com TTL de 5 minutos, teto de 500 entradas, e a API recebe uma
chave em string. Reescreva o arquivo mantendo o tier de memória na frente e
acrescentando o tier de banco. A API passa a receber o objeto do link (todo
chamador já tem o objeto). Exporte exatamente isto:

```ts
export type ChapterLink = {
  id: number;
  kind?: string | null;
  sourceMangaId: number;
  chapterCount?: number;
};
```

- `chapterCacheKey(link: ChapterLink): string` — continua igual ao de hoje:
  `n:${link.id}` quando `kind === "scraper"`, senão `s:${link.sourceMangaId}`.
- `loadChaptersForLink(link: ChapterLink): Promise<RawChapter[]>` — a busca de
  verdade, movida para cá a partir da página. `RawChapter` vem de
  `@/lib/chapters` (li o arquivo: `{ id, name, chapterNumber, scanlator?, uploadDate? }`).
  Corpo: se `link.kind === "scraper"`, `getNativeChapters(link.id)` de
  `@/lib/scrapers/native`; senão, quando `!link.chapterCount`, chama antes
  `getMangaEnsured(link.sourceMangaId)` e depois `getChapters(link.sourceMangaId)`,
  ambos de `@/lib/suwayomi`. Todo erro vira `[]` (o padrão `.catch(() => [])`
  que a página já usa hoje).
- `getCachedChapters<T>(link: ChapterLink): Promise<{ data: T; stale: boolean } | null>`
  - Memória primeiro: TTL de 30 minutos, teto de 500 entradas, mesma chave.
  - Depois, **só quando `link.kind !== "scraper"`**, a linha de
    `ChapterListCache` por `sourceLinkId`. Linha com mais de 7 dias conta como
    miss. Ao acertar, faz `JSON.parse` do `payload` e preenche a memória.
  - `stale: true` quando o acerto tem mais de 30 minutos de idade.
- `setCachedChapters(link: ChapterLink, data: unknown[]): Promise<void>` — grava
  na memória sempre e, para link que não é scraper, faz `upsert` da linha por
  `sourceLinkId` com `payload` serializado e `fetchedAt: new Date()`.
- `bustChapters(links: ChapterLink[]): Promise<void>` — limpa as entradas de
  memória correspondentes e apaga as linhas com um `deleteMany` por
  `sourceLinkId`.
- `refreshChapters(link: ChapterLink): Promise<void>` — `loadChaptersForLink` +
  `setCachedChapters` quando vier algo. Deduplicada por `chapterCacheKey` num
  `Map` de in-flight, para dois chamadores concorrentes pagarem uma busca só.
  Nunca lança.
- `revalidateChapters(link: ChapterLink): void` — `void refreshChapters(link)`,
  para quem não pode esperar.

Regra do arquivo inteiro: **erro de banco nunca sobe**. O cache é best-effort,
igual ao resto do projeto (`try/catch` em volta de cada chamada ao `prisma`).
Comentários novos em inglês, curtos.

### `src/app/(app)/work/[slug]/page.tsx` (li inteiro, 402 linhas)

Duas regiões mudam.

1. Bloco do `refresh`, linhas 191-199. `bustChapters` agora é assíncrona e
   recebe os objetos de link. O `findMany` logo acima já seleciona `id`, `kind`
   e `sourceMangaId`, então passe `freshLinks` direto. **Armadilha:**
   `redirect()` funciona lançando uma exceção; o `await bustChapters(...)` tem
   que vir ANTES do `redirect` e o `redirect` não pode ficar dentro de um
   `try/catch`.

2. Bloco `if (selected) { … }`, linhas 240-253. Substitua o corpo por:
   - `const hit = await getCachedChapters<ChapterView[]>(selected);`
   - acertou → `chapters = hit.data`; se `hit.stale`, chama
     `revalidateChapters(selected)` sem `await`;
   - não acertou → `chapters = (await loadChaptersForLink(selected)) as ChapterView[];`
     e, se vier algo, `await setCachedChapters(selected, chapters)`.
   - O código que hoje chama `getNativeChapters` / `getMangaEnsured` /
     `getChapters` some daqui (foi para `loadChaptersForLink`), junto com os
     imports que ficarem sem uso (`getMangaEnsured`, `getChapters`,
     `getNativeChapters`, `chapterCacheKey`).

## Fora do escopo

- Mudar como `src/app/reader/[chapterId]/page.tsx` busca capítulo vizinho; ele
  continua indo direto no engine.
- Persistir as páginas (imagens) do capítulo: já existe cache de disco para isso
  e o aquecimento delas é o T-010.
- O laço que atualiza a lista sem ninguém abrir a obra: é o T-009.
- Mexer no modelo `ScrapedChapter` ou em `src/lib/scrapers/native.ts`.
- Criar migration versionada.
- Mexer em `src/lib/coverImage.ts`, `src/lib/diskCache.ts`,
  `src/lib/backbone/httpCache.ts`, `src/lib/backbone/prewarm.ts`,
  `src/lib/readerPages.ts`, `src/components/Reader.tsx` e nas rotas
  `/api/cover`, `/api/image`, `/api/chapter-pages`: são a leva anterior, já
  pronta.

## Pronto quando

- [ ] `prisma/schema.prisma` tem `ChapterListCache` com `sourceLinkId` único e
      `onDelete: Cascade`, e `SourceLink` tem o campo `chapterCache`.
- [ ] `src/lib/chapterCache.ts` exporta `ChapterLink`, `chapterCacheKey`,
      `loadChaptersForLink`, `getCachedChapters`, `setCachedChapters`,
      `bustChapters`, `refreshChapters` e `revalidateChapters`, com as
      assinaturas acima.
- [ ] `getCachedChapters` só consulta o banco quando `kind !== "scraper"`.
- [ ] Linha de `ChapterListCache` com mais de 7 dias não é usada.
- [ ] Acerto com mais de 30 minutos é servido na hora e dispara revalidação em
      segundo plano, deduplicada por link.
- [ ] Nenhuma função de `chapterCache.ts` propaga exceção de banco.
- [ ] A página da obra não chama mais `getChapters`/`getMangaEnsured`/
      `getNativeChapters` diretamente, e `await bustChapters(...)` acontece
      antes do `redirect`.
- [ ] Depois de abrir uma obra e reiniciar o app, abrir a mesma obra mostra a
      lista de capítulos sem passar pelas barrinhas cinzas de carregamento.
- [ ] `npm run build` passa.

## Como testar (humano)

1. Suba o app e abra uma obra qualquer. Espere a lista de capítulos aparecer.
2. Reinicie o app (`docker compose restart web`) e espere subir de novo.
3. Abra a mesma obra. A lista de capítulos tem que aparecer imediatamente, sem
   as barrinhas cinzas piscando antes.
4. Nessa mesma obra, clique no botão de atualizar fontes. A página recarrega e a
   lista volta a aparecer; nessa vez pode demorar alguns segundos, é o esperado.
5. Abra uma obra que você nunca abriu. A primeira vez continua demorando o
   normal. Saia, entre de novo nela e agora tem que ser instantâneo.
6. Confira que os capítulos continuam clicáveis e que abrir um deles leva ao
   leitor normalmente.
