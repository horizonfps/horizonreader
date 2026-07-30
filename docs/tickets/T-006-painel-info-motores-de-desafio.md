---
id: T-006
title: Mostrar no /info os três motores de desafio e a taxa de acerto por motor e por site
status: ready
blockedBy: [T-002]
files: [src/lib/metrics/services.ts, src/components/info/ServicesPanel.tsx]
---

## O que fazer

O painel `/info` hoje mostra só se cada solver está online. Não dá para responder
a pergunta que interessa — "qual motor está resolvendo qual site, e onde cada um
falha" — sem ler log de container por SSH. O aprendizado por par (motor, host) já
passa a existir em disco no T-002; falta expor.

Depois deste ticket, `/info` ganha um cartão "Motores de desafio" com uma linha por
motor configurado, mostrando sucessos, falhas, taxa de acerto e tempo médio, mais
os sites onde aquele motor mais falha e quem venceu em cada site. E a linha de
serviço do trawl passa a mostrar a ocupação do pool de navegadores dele em vez de
um "ok" seco.

## Onde mexer

**`src/lib/metrics/services.ts`** (li inteiro, 327 linhas):

1. Em `solverProbes()` (linha 138), existe hoje um ramo especial para `byparr`
   (que bate em `/docs` porque o `/health` dele dirige um navegador de verdade) e
   um ramo genérico que bate em `/health` e lê `body.version`. Acrescente um ramo
   para `name === "trawl"`: o `/health` dele devolve
   `{ status, uptime, pool: { total, busy, available, restarts, avgRestarts } }`
   (verifiquei em `apps/api/src/routes/health.ts` do projeto) e **não** tem campo
   `version`. O `detail` deve virar algo como
   `pool 1/2 livre · 3 reinícios`, usando os campos `available`, `total` e
   `restarts`. Timeout de 5s, no estilo do ramo do byparr.
2. Novo bloco de estatística: importe `solverMemorySnapshot()` de
   `@/lib/scrapers/solverMemory` (criado no T-002) e monte uma função
   `solverEngineStats()` que devolve, para cada `kind` presente em `SOLVERS`
   (reaproveite `solverTargets()`, linha 120, que já parseia a variável):
   - `kind`, `ok`, `fail`, `successRate` (0–100, `null` quando `ok + fail === 0`),
     `avgMs` (média dos pares, ponderada por `ok`),
   - `worstHosts`: até 5 hosts com mais falhas naquele motor, cada um com
     `{ host, ok, fail }`,
   - `hosts` — no nível de fora, não por motor: até 10 hosts com mais atividade,
     cada um com `{ host, winner }`, onde `winner` é o motor com o `lastOkAt` mais
     recente naquele host (ou `null`).
   É tudo leitura de mapa em memória; **não** faça I/O nem chamada de rede aqui, e
   não use o helper `cached()` (linha 29) — não precisa.
3. Inclua o resultado em `readServices()` (linha 303) como campo
   `solverEngines: { engines: [...], hosts: [...] }`. `ServicesSnapshot` é
   inferido do retorno (linha 301), então o tipo se propaga sozinho e a rota
   `src/app/api/info/services/route.ts` não precisa de mudança — ela espalha o
   objeto.

**`src/components/info/ServicesPanel.tsx`** (li inteiro, 152 linhas):

- Desestruture o campo novo em `services` (linha 41) e acrescente um `<Card
  title="Motores de desafio" className="lg:col-span-2">` depois do cartão
  "Serviços".
- Uma linha por motor: nome, `Pill` com tom vindo de `toneFor` invertido pela taxa
  (taxa alta = `ok`), taxa em `pct()`, `count()` de sucessos e falhas, tempo médio
  em ms, e uma `Bar` com a taxa de acerto. Use os helpers que já existem em
  `./ui`: `Card`, `Pill`, `Stat`, `Bar`, `count`, `pct`, `toneFor`.
- Abaixo de cada motor, os `worstHosts` como as mesmas "pastilhas" de texto usadas
  hoje para os idiomas das extensões (linhas 73–82): `host` e a contagem de
  falhas.
- Um bloco final com os `hosts` e o motor vencedor de cada um, no mesmo estilo de
  pastilha.
- Quando não houver dado nenhum (app recém-subido), mostre a frase padrão do
  painel para caixa vazia, no estilo da linha 88 ("Catálogo indisponível — ..."),
  em português.
- Rótulos em português como o resto do painel; comentários (se precisar) em
  inglês.

Armadilhas:

- `/info` é somente leitura (está escrito no `DEPLOY.md`): nenhuma rota nova,
  nenhum botão que reinicie ou limpe estatística.
- A rota `/api/info/services` exige sessão de admin (`session.isAdmin`); não
  afrouxe isso.
- O painel recarrega os serviços a cada 30s (`InfoDashboard.tsx`, `refreshInterval`
  do SWR); a função nova roda nesse ritmo, então tem que continuar barata.
- O projeto não tem test runner. Não instale um; o gate é `npm run build`.

## Fora do escopo

- Editar `src/app/api/info/services/route.ts`, `src/lib/metrics/docker.ts`,
  `src/lib/metrics/host.ts` ou `src/lib/metrics/logs.ts`.
- Botão de "limpar aprendizado" ou qualquer escrita a partir do painel.
- Gráfico histórico (sparkline) de taxa de acerto: só os números atuais.
- Mostrar o `/stats` do trawl (existe, mas o `/health` já traz o pool).
- Mudar a saúde das fontes do Suwayomi (`sourceStats`) ou o cartão de engine.

## Pronto quando

- [ ] `GET /api/info/services` devolve `solverEngines.engines` com um item por
      motor configurado em `SOLVERS`, cada um com `ok`, `fail`, `successRate`,
      `avgMs` e `worstHosts`.
- [ ] `GET /api/info/services` devolve `solverEngines.hosts` com o motor vencedor
      por host.
- [ ] `/info` mostra um cartão "Motores de desafio" com uma linha por motor e a
      taxa de acerto em porcentagem.
- [ ] A linha de serviço do `trawl` mostra a ocupação do pool de navegadores.
- [ ] Sem nenhum solve registrado, o cartão aparece com mensagem de vazio em vez de
      quebrar.
- [ ] `npm run build` passa.

## Como testar (humano)

1. No servidor: `git pull` e `docker compose up -d --build web`.
2. Abra https://reader.horizonfps.space e faça umas dez buscas em fontes
   diferentes, incluindo dragontea, toonlivre, mangastop, risentoons, luratoons e
   comick.
3. Abra https://reader.horizonfps.space/info e procure o cartão "Motores de
   desafio".
4. Ele tem que listar os três motores, cada um com quantos acertos e quantas
   falhas teve, a porcentagem de acerto e o tempo médio. Embaixo de cada motor,
   os sites onde ele mais falha.
5. Confirme que existe também a lista de sites com o nome do motor que está
   vencendo em cada um.
6. Na caixa de serviços, a linha do trawl tem que mostrar quantos navegadores do
   pool dele estão livres.
