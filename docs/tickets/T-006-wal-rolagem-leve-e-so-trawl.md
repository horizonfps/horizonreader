---
id: T-006
title: Ligar WAL no SQLite, aliviar a rolagem das listas e deixar só o trawl no pool de solvers
status: ready
blockedBy: []
files: [src/lib/db.ts, src/app/globals.css, src/components/InfiniteGrid.tsx, src/components/CardRow.tsx, src/components/MangaCard.tsx, docker-compose.yml, .env.example, DEPLOY.md]
---

## O que fazer

Três ajustes de infraestrutura, independentes entre si, que fecham o pacote de
otimização:

- **(a)** O banco passa a usar o modo em que gravar não trava quem está lendo.
  Hoje uma gravação segura todas as leituras concorrentes.
- **(b)** As listas grandes ficam mais leves de rolar: card fora da tela deixa de
  ser desenhado e as primeiras capas de cada lista carregam com prioridade.
- **(c)** O stack passa a ter um motor de desafio só, o trawl. Os containers
  `byparr` e `flaresolverr` saem do compose. Isso foi medido neste repositório:
  a partir de um IP brasileiro o trawl acertou 20 de 20 alvos e o Byparr 0 de 9.
  O app vai rodar num servidor local com IP brasileiro, então bloqueio por IP
  deixa de ser o problema que justificava três motores. **O código do pool
  continua genérico: nada em `src/lib/scrapers` é apagado.** O que muda é só a
  configuração.

## Onde mexer

### (a) WAL no SQLite

**`src/lib/db.ts`** (li inteiro, 7 linhas): depois de criar o `PrismaClient`, e
só quando `process.env.DATABASE_URL` começa com `file:`, execute uma vez
`PRAGMA journal_mode=WAL;` e `PRAGMA synchronous=NORMAL;` via
`prisma.$queryRawUnsafe` (é `$queryRawUnsafe`, não `$executeRawUnsafe`: a pragma
de journal devolve uma linha de resultado). Dispare sem `await` no topo do
módulo e engula o erro — banco que não aceita a pragma não pode derrubar o app.
Proteja contra repetição no hot-reload de desenvolvimento com uma flag no mesmo
objeto global que já guarda o `prisma`.

### (b) Rolagem mais leve

**`src/app/globals.css`** (li inteiro, 90 linhas): acrescente uma classe junto
das outras utilitárias do arquivo (comentário em inglês, curto):

```css
.card-lazy {
  content-visibility: auto;
  contain-intrinsic-size: auto 280px;
}
```

O `auto` no `contain-intrinsic-size` é obrigatório: sem ele o tamanho estimado é
fixo e a barra de rolagem pula quando o card entra e sai da tela.

**`src/components/InfiniteGrid.tsx`** (li inteiro, 115 linhas): o componente
`MangaCard` local (linha 13) recebe também o índice do item. Aplique:
- `card-lazy` no `className` do `PrefetchLink`;
- nas 6 primeiras capas, `loading="eager"` e `fetchPriority="high"`; nas demais,
  `loading="lazy"` e `fetchPriority="low"`.
O `<img>` é uma tag nativa (o projeto não usa `next/image` aqui), e o React 19
repassa `fetchPriority` direto para o DOM.

**`src/components/CardRow.tsx`** (li inteiro, 58 linhas): mesma coisa, usando o
`i` do `map` que já existe: `card-lazy` no `PrefetchLink` e prioridade alta nas 4
primeiras capas da fileira.

**`src/components/MangaCard.tsx`** (li inteiro, 43 linhas): só a classe
`card-lazy` no `PrefetchLink`. Este componente não recebe índice de quem o usa,
então a parte de prioridade não se aplica aqui.

### (c) Só o trawl

**`docker-compose.yml`** (li inteiro):
- Apague os serviços `byparr` e `flaresolverr` inteiros, com os comentários
  deles.
- `redis` e `trawl` ficam. O trawl depende do redis para a sessão em cache, que
  é o que faz a segunda visita ao mesmo site voltar em ~500 ms.
- No serviço `web`: `SOLVERS: ${SOLVERS:-trawl@http://trawl:8191}` e
  `FLARE_CONCURRENCY: ${FLARE_CONCURRENCY:-2}` (dois, para casar com
  `BROWSER_POOL_SIZE: 2` do trawl — cada solve concorrente é um contexto de
  navegador).
- Reescreva o comentário em inglês do bloco `SOLVERS` para descrever um motor
  só, com a escalada dele (HTTP → sessão em cache → Camoufox → proxy), em vez de
  três.
- Tetos de memória para servidor local: `TRAWL_MEM` default `2048m` e
  `REDIS_MEM` default `128m`.
- Não mexa no serviço `suwayomi`: ele continua apontando `FLARESOLVERR_URL` para
  a fachada `/api/solver/<token>/v1` do próprio app, que é o que dá fallback a
  ele. Esse nome de variável é do Suwayomi, não do FlareSolverr.

**`.env.example`** (li inteiro): a linha `SOLVERS=` passa a ser
`SOLVERS=trawl@http://localhost:8191` e o comentário acima dela passa a
descrever um motor só. Tire as menções a Byparr e FlareSolverr desse bloco.
Mantenha o bloco legado (`FLARESOLVERR_URL` / `SOLVER_KIND`) comentado, as
variáveis do trawl, do redis e dos proxies como estão.

**`DEPLOY.md`** (li inteiro, 123 linhas): o bullet da seção "1. App em Docker"
que descreve os três motores (linhas 33-42) passa a descrever só o trawl, com o
motivo em uma linha (medição deste repositório a partir de IP brasileiro: trawl
20/20, Byparr 0/9). O aviso do fim do arquivo sobre `SOLVERS` no `.env` continua,
mas com o valor novo. Acrescente que este deploy precisa de
`docker compose up -d --build --remove-orphans`, senão os dois containers
removidos continuam de pé.

## Fora do escopo

- Apagar ou simplificar qualquer coisa em `src/lib/scrapers/` (`flare.ts`,
  `solverMemory.ts`) e em `src/lib/metrics/services.ts`. A fachada segue
  genérica e multi-motor; ela passa a enxergar um motor só porque a
  configuração diz isso.
- `scripts/solver-bench.mjs` e o `README.md` (que ainda descreve um perfil antigo
  do FlareSolverr).
- Virtualizar a lista com biblioteca de janela virtual. Aqui é só
  `content-visibility` e prioridade de carregamento.
- Trocar o banco de SQLite para outro, ou mexer em `prisma/schema.prisma`.
- Migrar os tetos de memória de `web` e `suwayomi` (eles não têm `mem_limit` no
  compose versionado; quem define isso hoje é um arquivo de override fora do
  git).

## Pronto quando

- [ ] `docker-compose.yml` não tem mais os serviços `byparr` nem `flaresolverr`, e
      continua tendo `trawl` e `redis`.
- [ ] O default de `SOLVERS` no serviço `web` é só `trawl@http://trawl:8191`, e
      `FLARE_CONCURRENCY` tem default 2.
- [ ] `TRAWL_MEM` default `2048m` e `REDIS_MEM` default `128m`.
- [ ] Nenhum arquivo dentro de `src/lib/scrapers/` foi alterado.
- [ ] `.env.example` e `DEPLOY.md` descrevem um motor só, e o `DEPLOY.md` avisa
      do `--remove-orphans`.
- [ ] `src/lib/db.ts` aplica `journal_mode=WAL` só quando `DATABASE_URL` começa
      com `file:`, sem `await` no topo do módulo, e o app sobe normalmente se a
      pragma falhar.
- [ ] Depois de subir o app, existe um arquivo terminado em `-wal` ao lado do
      arquivo de banco.
- [ ] `globals.css` tem `.card-lazy` com `content-visibility: auto` e
      `contain-intrinsic-size: auto 280px`, aplicada nos três componentes de card.
- [ ] As 6 primeiras capas da grade e as 4 primeiras de cada fileira carregam com
      `loading="eager"` e `fetchPriority="high"`.
- [ ] `npm run build` passa.

## Como testar (humano)

1. Na pasta do projeto, suba tudo com
   `docker compose up -d --build --remove-orphans`. O `--remove-orphans` é o que
   desliga os dois motores que saíram.
2. Abra o painel do site em `/info`. Na caixa de containers não pode mais existir
   `byparr` nem `flaresolverr`; na caixa de serviços tem que aparecer só o
   `trawl`, marcado como online.
3. Faça uma busca por um título qualquer e confirme que ainda vêm resultados
   (pode demorar até uns 20 segundos na primeira busca de cada site).
4. Abra a home e role a lista de baixo bem rápido e bem longe. A rolagem tem que
   continuar lisa, sem travadinhas, e as primeiras capas de cada fileira têm que
   aparecer antes das outras.
5. Abra a pasta `data` dentro da pasta do projeto: ao lado do arquivo do banco
   tem que existir um arquivo com o mesmo nome terminado em `-wal`.
6. Marque e desmarque um favorito enquanto o site está carregando outra coisa:
   nada pode ficar travado esperando.
