---
id: T-008
title: Ligar WAL no SQLite, aliviar a rolagem das listas e deixar só o trawl no pool de solvers
status: ready
blockedBy: []
files: [src/lib/db.ts, src/app/globals.css, src/components/InfiniteGrid.tsx, src/components/CardRow.tsx, src/components/MangaCard.tsx, docker-compose.yml, .env.example, DEPLOY.md]
---

> Rodada de otimização de navegação, segunda leva. Os IDs T-001..T-006 em
> `docs/tickets/` são de rodadas ANTERIORES. Ignore-os: este ticket é o T-008.

## O que fazer

Três ajustes de infraestrutura, independentes entre si, num ticket só:

- **(a)** O banco passa a usar o modo em que gravar não trava quem está lendo.
  Hoje uma gravação segura todas as leituras concorrentes.
- **(b)** As listas grandes ficam mais leves de rolar: card fora da tela deixa de
  ser desenhado e as primeiras capas de cada lista carregam com prioridade.
- **(c)** O stack passa a ter um motor de desafio só, o trawl. Os containers
  `byparr` e `flaresolverr` saem do compose. Isso foi medido neste repositório:
  a partir de um IP brasileiro o trawl acertou 20 de 20 alvos e o Byparr 0 de 9.
  O app sai da VPS e passa a rodar num servidor local com IP brasileiro, então
  bloqueio por IP deixa de ser o problema que justificava três motores. **O
  código do pool continua genérico: nada em `src/lib/scrapers` é apagado.** O
  que muda é só a configuração.

## Onde mexer

### (a) WAL no SQLite

**`src/lib/db.ts`** (li inteiro, 7 linhas): depois de criar o `PrismaClient`, e
só quando `process.env.DATABASE_URL` começa com `file:`, execute uma vez
`PRAGMA journal_mode=WAL;` e `PRAGMA synchronous=NORMAL;` via
`prisma.$queryRawUnsafe` (é `$queryRawUnsafe`, não `$executeRawUnsafe`: a pragma
de journal devolve uma linha de resultado, e `$executeRawUnsafe` estoura com
ela). Dispare sem `await` no topo do módulo e engula o erro com `.catch(() => {})`:
banco que não aceita a pragma não pode derrubar o app. Proteja contra repetição
no hot-reload de desenvolvimento com uma flag no mesmo objeto global que já
guarda o `prisma` (o `globalForPrisma` da linha 3, estendendo o tipo com
`walDone?: boolean`).

### (b) Rolagem mais leve

**`src/app/globals.css`** (li inteiro, 90 linhas): acrescente uma classe junto
das outras utilitárias do arquivo (comentário em inglês, curto):

```css
.card-lazy {
  content-visibility: auto;
  contain-intrinsic-size: auto 280px;
}
```

O `auto` dentro do `contain-intrinsic-size` é obrigatório: sem ele o tamanho
estimado é fixo e a barra de rolagem pula quando o card entra e sai da tela.

**`src/components/InfiniteGrid.tsx`** (li inteiro, 115 linhas): o componente
local `MangaCard` (linha 13) passa a receber também o índice do item; quem
renderiza é o `items.map` da linha 94, que hoje não usa índice — troque para
`items.map((item, i) => …)` e repasse. Dentro do card:
- `card-lazy` no `className` do `PrefetchLink` (hoje é só `"block"`);
- nas 6 primeiras capas (`i < 6`), `loading="eager"` e `fetchPriority="high"`;
  nas demais, `loading="lazy"` e `fetchPriority="low"`.

Atenção: o `<img>` aqui é tag nativa (o projeto não usa `next/image` nessas
listas) e o React 19 repassa `fetchPriority` direto para o DOM.

**`src/components/CardRow.tsx`** (li inteiro, 58 linhas): mesma coisa, usando o
`i` do `map` que já existe (linha 24): acrescente `card-lazy` ao `className` do
`PrefetchLink` e prioridade alta nas 4 primeiras capas da fileira.

**`src/components/MangaCard.tsx`** (li inteiro, 43 linhas): só a classe
`card-lazy` no `className` do `PrefetchLink`. Este componente não recebe índice
de quem o usa, então a parte de prioridade não se aplica aqui.

### (c) Só o trawl

**`docker-compose.yml`** (li inteiro, 249 linhas):
- Apague os serviços `byparr` (linhas 169-209) e `flaresolverr`
  (linhas 211-224) inteiros, com os comentários deles.
- `redis` e `trawl` **ficam**. O trawl depende do redis para a sessão em cache,
  que é o que faz a segunda visita ao mesmo site voltar em ~500 ms.
- No serviço `web`: `SOLVERS: ${SOLVERS:-trawl@http://trawl:8191}` e
  `FLARE_CONCURRENCY: ${FLARE_CONCURRENCY:-2}` (dois, para casar com
  `BROWSER_POOL_SIZE: 2` do trawl; cada solve concorrente é um contexto de
  navegador).
- Reescreva o comentário em inglês acima do bloco `SOLVERS` (linhas 13-17) para
  descrever um motor só e a escalada dele (HTTP → sessão em cache → Camoufox →
  proxy), em vez de três.
- Tetos de memória para servidor local: `mem_limit` do trawl vira
  `${TRAWL_MEM:-2048m}` e o do redis vira `${REDIS_MEM:-128m}`.
- **Não mexa no serviço `suwayomi`.** Ele continua apontando `FLARESOLVERR_URL`
  para a fachada `/api/solver/<token>/v1` do próprio app, que é o que dá
  fallback a ele. Esse nome de variável é do Suwayomi, não do container
  FlareSolverr. Só atualize o comentário das linhas 97-98, que fala em "both
  solvers", para falar da fachada e do motor único.
- O comentário das linhas 23-24 do serviço `web` diz "Sized for the VPS, not for
  a laptop"; troque por uma frase curta em inglês dizendo que o dimensionamento
  é do servidor local.

**`.env.example`** (li inteiro, 77 linhas):
- A linha 23 vira `SOLVERS=trawl@http://localhost:8191` e o comentário acima
  dela (linhas 18-22) passa a descrever um motor só. Tire as menções a Byparr e
  FlareSolverr desse bloco.
- `#TRAWL_MEM=2560m` vira `#TRAWL_MEM=2048m`; `#REDIS_MEM=256m` vira
  `#REDIS_MEM=128m`.
- O comentário dos proxies (linhas 40-43) fala em "VPS's own datacenter IP";
  reescreva para o servidor local com IP brasileiro, deixando claro que os
  proxies seguem vazios por padrão. Mantenha as variáveis.
- Linha 57: "para o Suwayomi ganhar todos os três solvers" — ajuste para o motor
  único, mantendo a explicação da fachada.
- Mantenha o bloco legado (`FLARESOLVERR_URL` / `SOLVER_KIND`) comentado como
  está: o código ainda o honra.

**`DEPLOY.md`** (li inteiro, 123 linhas):
- Linha 4: "Suwayomi e FlareSolverr ficam internos" → o motor de desafio agora é
  o trawl.
- Linha 25: "reaproveita Suwayomi/FlareSolverr se já estiverem de pé" → idem.
- O bullet das linhas 33-42, que descreve os três motores, passa a descrever só
  o trawl, com o motivo em uma linha (medição deste repositório a partir de IP
  brasileiro: trawl 20/20, Byparr 0/9). O trecho sobre `SOLVER_PROXY_TOKEN` e a
  fachada `/api/solver/<token>/v1` continua, porque continua valendo.
- O aviso do fim do arquivo (linhas 121-123) sobre `SOLVERS` no `.env` continua,
  mas com o valor novo.
- Acrescente que este deploy precisa de
  `docker compose up -d --build --remove-orphans`, senão os dois containers
  removidos continuam de pé na máquina.

## Fora do escopo

- Apagar ou simplificar qualquer coisa em `src/lib/scrapers/` (`flare.ts`,
  `solverMemory.ts`) e em `src/lib/metrics/services.ts`. A fachada segue
  genérica e multi-motor; ela passa a enxergar um motor só porque a configuração
  diz isso. `flare.ts` continua conhecendo os três tipos.
- `scripts/solver-bench.mjs` e o `README.md`.
- Virtualizar a lista com biblioteca de janela virtual. Aqui é só
  `content-visibility` e prioridade de carregamento.
- Trocar o banco de SQLite para outro, ou mexer em `prisma/schema.prisma`.
- Definir `mem_limit` para `web` e `suwayomi`: eles não têm essa chave no
  compose versionado, e quem define isso em produção é um arquivo de override
  fora do git.
- Mexer em `src/lib/coverImage.ts`, `src/lib/diskCache.ts`,
  `src/lib/backbone/httpCache.ts`, `src/lib/backbone/prewarm.ts`,
  `src/lib/readerPages.ts`, `src/components/Reader.tsx` e nas rotas
  `/api/cover`, `/api/image`, `/api/chapter-pages`: são a leva anterior, já
  pronta.

## Pronto quando

- [ ] `docker-compose.yml` não tem mais os serviços `byparr` nem `flaresolverr`,
      e continua tendo `trawl`, `redis`, `suwayomi`, `dockerproxy` e
      `cloudflared`.
- [ ] O default de `SOLVERS` no serviço `web` é só `trawl@http://trawl:8191`, e
      `FLARE_CONCURRENCY` tem default 2.
- [ ] `mem_limit` do trawl tem default `2048m` e o do redis, `128m`.
- [ ] Nenhum arquivo dentro de `src/lib/scrapers/` foi alterado.
- [ ] Uma busca por `byparr` e por `flaresolverr` em `.env.example` e `DEPLOY.md`
      só encontra as variáveis legadas (`FLARESOLVERR_URL`, `SOLVER_KIND`,
      `FLARESOLVERR_ENABLED`) e a fachada do Suwayomi, nunca os containers.
- [ ] `DEPLOY.md` avisa que o deploy desta mudança pede
      `docker compose up -d --build --remove-orphans`.
- [ ] `src/lib/db.ts` aplica `journal_mode=WAL` e `synchronous=NORMAL` só quando
      `DATABASE_URL` começa com `file:`, sem `await` no topo do módulo, e o app
      sobe normalmente se a pragma falhar.
- [ ] Depois de subir o app existe um arquivo terminado em `-wal` ao lado do
      arquivo de banco.
- [ ] `globals.css` tem `.card-lazy` com `content-visibility: auto` e
      `contain-intrinsic-size: auto 280px`, aplicada nos três componentes de
      card.
- [ ] As 6 primeiras capas da grade infinita e as 4 primeiras de cada fileira
      saem com `loading="eager"` e `fetchPriority="high"`; as demais, com
      `loading="lazy"` e `fetchPriority="low"`.
- [ ] `npm run build` passa.

## Como testar (humano)

1. Na pasta do projeto, suba tudo com
   `docker compose up -d --build --remove-orphans`. Esse `--remove-orphans` é o
   que desliga os dois motores que saíram.
2. Abra o painel do site em `/info`. Na caixa de containers não pode mais
   existir `byparr` nem `flaresolverr`; na caixa de serviços tem que aparecer só
   o `trawl`, marcado como online.
3. Faça uma busca por um título qualquer e confirme que ainda vêm resultados
   (pode demorar até uns 20 segundos na primeira busca de cada site).
4. Abra a home e role a lista de baixo bem rápido e bem longe. A rolagem tem que
   continuar lisa, sem travadinhas, e as primeiras capas de cada fileira têm que
   aparecer antes das outras.
5. Abra a pasta `data` dentro da pasta do projeto: ao lado do arquivo do banco
   tem que existir um arquivo com o mesmo nome terminado em `-wal`.
6. Marque e desmarque um favorito enquanto o site está carregando outra coisa:
   nada pode ficar travado esperando.
