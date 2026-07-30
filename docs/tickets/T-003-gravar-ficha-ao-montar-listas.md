---
id: T-003
title: Gravar a ficha da obra em segundo plano enquanto feed, browse e home são servidos
status: ready
blockedBy: []
files: [src/lib/backbone/prewarm.ts, src/app/api/feed/route.ts, src/app/api/browse/route.ts, src/lib/backbone/sections.ts, src/app/(app)/page.tsx]
---

## O que fazer

Card de obra que nunca foi aberta aponta para um endereço de "ponte"
(`/w/…`), e é só no clique que o app descobre quem é a obra, cria a ficha dela e
redireciona. Isso é uma espera visível no clique, toda vez, para toda obra nova.

Depois deste ticket, montar uma lista (home, "Recém-atualizados", explorar)
também grava a ficha das obras daquela lista no banco, em segundo plano, sem
atrasar a resposta. Da segunda visita em diante os cards já apontam direto para
a página da obra e essa página abre com título, capa, gêneros e nota já prontos.

## Onde mexer

**`src/lib/backbone/prewarm.ts`** (arquivo novo, server-side). É uma fila de
fundo; nenhuma função dela pode ser aguardada por quem serve a requisição.
Copie o formato da fila que já existe em `src/lib/backbone/resolve.ts`
(`queueSourceResolve` / `pumpBackground`: fila em array, `Set` de enfileirados,
`Map` de cooldown, contador de ativos).

- `indexBackboneWorks(works: BackboneWork[]): void`
  - Ignora item bloqueado por `isBlocked` (`src/lib/backbone/filter.ts`), item
    sem `externalId`, e item cujo `origin` não é `"mangadex"`.
  - Deduplica por `` `${origin}:${externalId}` `` com cooldown em memória de 6
    horas (mesma obra não é regravada em série).
  - Enfileira `upsertWork(bw)` (já exportado por `resolve.ts`). É só banco, sem
    rede: `upsertWork` grava title, altTitles, matchKeys, coverUrl, genres,
    rating, type, status, description, year, contentRating.
- `indexComickItems(items: SectionItem[]): void`
  - Só para `origin === "comick"`, item sem `localSlug`, não bloqueado.
  - Cooldown de 24 horas por referência (essa via custa rede).
  - Enfileira
    `resolveWorkFromRef({ origin: "comick", externalId, title, coverUrl, type, status })`.
    **Não** chame `upsertWork` direto para item do Comick: `resolveWorkFromRef` é
    quem tenta canonicalizar em cima da entrada equivalente do MangaDex e quem
    aplica a política de conteúdo. Gravar direto criaria obra duplicada e com
    títulos alternativos pobres, o que estraga o casamento com as fontes pt-BR.
- Concorrência máxima de 4 tarefas, fila com teto de 200 pendentes (o que passar
  disso é descartado; volta a ser enfileirado numa visita futura).
- Todo erro engolido.

**`src/app/api/feed/route.ts`** (li inteiro, 40 linhas): depois de obter `works`
de `listMangaDex` e antes do `return`, chame `indexBackboneWorks(works)` sem
`await`. `attachLocalSlugs` continua onde está e continua rodando antes.

**`src/app/api/browse/route.ts`** (li inteiro, 63 linhas): mesma chamada de
indexação; e além disso acrescente `await attachLocalSlugs([items])`
(`src/lib/backbone/localslugs.ts`) antes do `return` — hoje o browse não chama,
então mesmo obra já conhecida sai apontando para a ponte.

**`src/lib/backbone/sections.ts`** (li inteiro, 182 linhas): as duas listas
vindas do MangaDex já estão em mãos como `BackboneWork` completo, com títulos
alternativos. Chame `indexBackboneWorks` sobre `mdxCompleted` e sobre `mdxNew`,
logo depois de cada `safe(listMangaDex(...))`. Nada mais muda nesse arquivo — o
cache de 1 hora em memória continua igual.

**`src/app/(app)/page.tsx`** (li inteiro, 147 linhas): logo depois do
`await attachLocalSlugs([...])` que já existe, chame `indexComickItems` sobre as
mesmas listas. A ordem importa: `attachLocalSlugs` primeiro, porque quem já tem
`localSlug` é justamente quem não precisa ser indexado.

Comentários novos em inglês, curtos.

## Fora do escopo

- Fazer o card já sair com o endereço final na PRIMEIRA visita. A gravação é em
  segundo plano por decisão de projeto; o link direto aparece a partir da visita
  seguinte.
- Resolver as fontes de leitura (`resolveSourcesForWork`) das obras indexadas.
  Isso continua acontecendo só no aquecimento por viewport (`/api/warm`) e ao
  abrir a obra.
- Mexer em `src/components/PrefetchLink.tsx` ou em `/api/warm`.
- Indexar resultado de busca (`/api/search`) ou os itens do carrossel de
  favoritos.
- Job que atualiza favoritos sozinho: é da próxima rodada.

## Pronto quando

- [ ] `prewarm.ts` exporta `indexBackboneWorks` e `indexComickItems`, ambas
      síncronas (retornam `void`), com teto de concorrência 4, teto de fila 200 e
      cooldown por referência.
- [ ] Item bloqueado por `isBlocked` nunca é enfileirado.
- [ ] Item do Comick passa por `resolveWorkFromRef`, nunca por `upsertWork` direto.
- [ ] `/api/feed` e `/api/browse` disparam a indexação sem `await` e continuam
      respondendo o mesmo JSON de hoje.
- [ ] `/api/browse` passa a chamar `attachLocalSlugs`.
- [ ] Depois de abrir a home, esperar cerca de um minuto e recarregar, os cards
      da lista "Recém-atualizados" apontam para endereço `/work/…` (nenhum `/w/…`).
- [ ] `npm run build` passa.

## Como testar (humano)

1. Suba o app e abra a home. Role um pouco a lista de baixo ("Recém-atualizados").
2. Espere cerca de um minuto e recarregue a página.
3. Clique num card daquela lista. O endereço que aparece na barra do navegador
   tem que ser o endereço final da obra já no primeiro instante, sem passar por
   uma tela de espera intermediária.
4. Volte, vá em "Explorar", escolha um gênero, e repita: clicar num card leva
   direto para a página da obra.
5. Numa obra que você nunca tinha aberto, confira que título, capa, gêneros e
   nota já aparecem assim que a página abre (a lista de capítulos pode demorar
   mais, isso é normal).
