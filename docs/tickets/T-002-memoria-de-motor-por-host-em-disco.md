---
id: T-002
title: Persistir em disco qual motor funciona (e qual só falha) em cada host
status: ready
blockedBy: [T-001]
files: [src/lib/scrapers/solverMemory.ts, src/lib/scrapers/flare.ts]
---

## O que fazer

O app já aprende, durante a execução, qual motor de desafio ganha em cada site —
mas esse aprendizado mora só na memória do processo Next.js. Todo deploy ou
restart zera tudo, e o primeiro motor da lista volta a ser tentado em todos os
hosts, inclusive nos 7 onde ele só sabe falhar. Foi assim que 48h de log
acumularam 81 falhas "IP is banned" concentradas em dragontea.ink,
api.luacomic.org, www.frieren.online, api.housesaikai.net, toonlivre.net,
risentoons.xyz e mangastop.net — cada uma custando um navegador inteiro para
terminar em erro.

Depois deste ticket, o placar por par (motor, host) vive num arquivo no volume
`/data`. Um motor que falhou 3 vezes seguidas num host é **pulado** naquele host
enquanto existir outro motor não punido, e volta a ser tentado — por último —
seis horas depois da última falha. Reiniciar o app não apaga mais nada. Efeito
visível: depois de um restart, buscar naqueles sites continua rápido em vez de
recomeçar a série de falhas.

## Onde mexer

**Arquivo novo `src/lib/scrapers/solverMemory.ts`.** É o dono do placar. Padrão
a seguir: `src/lib/diskCache.ts` (li inteiro) já mostra o jeito da casa de
escrever no volume — grava num nome temporário e faz `rename`, para nenhum leitor
ver arquivo pela metade, e trata erro de escrita como best-effort.

- Diretório: `process.env.SOLVER_STATE_DIR || (existsSync("/data") ? "/data" : ".cache")`,
  arquivo `solver-memory.json`. Mesma lógica de fallback que `diskCache.ts` e
  `src/lib/metrics/services.ts` já usam para `/data`.
- Formato: `{ "v": 1, "pairs": { "<kind>|<host>": { ok, fail, streak, avgMs, lastOkAt, lastFailAt } } }`.
  `streak` é a sequência de falhas atual (zera em qualquer sucesso), `avgMs` é a
  mesma média móvel de `src/lib/backbone/sourceStats.ts` (`avg * 0.7 + ms * 0.3`).
- Carregue uma vez, na inicialização do módulo, com `readFileSync` dentro de
  try/catch (o arquivo é minúsculo e isso mantém a primeira ordenação
  determinística; carregar assíncrono deixaria a primeira requisição sem
  histórico). JSON inválido ou versão diferente de 1 = começa vazio, sem lançar.
- API exportada:
  - `recordSolverOk(kind: string, host: string, ms: number)` e
    `recordSolverFail(kind: string, host: string)`.
  - `isBenched(kind, host)`: `streak >= 3` **e** `lastFailAt` a menos de 6h.
    Passado esse prazo o par sai da punição sozinho (senão um motor nunca se
    recupera depois de uma instabilidade passageira do site).
  - `lastWinner(host)`: o kind com o `lastOkAt` mais recente naquele host, ou
    `null`.
  - `lastFailAt(kind, host)`: usado para desempate.
  - `solverMemorySnapshot()`: devolve o mapa de pares (o T-006 lê isso para o
    painel; não mexa em painel aqui).
- Escrita: no máximo uma a cada 10s (`setTimeout` guardado numa variável, com
  `.unref?.()` para não segurar o processo), sempre com temp + `rename`, erro
  engolido. Antes de gravar, pode no máximo 800 pares, descartando os de
  `max(lastOkAt, lastFailAt)` mais antigo.
- Comentários em inglês e no mínimo, como no resto do projeto.

**`src/lib/scrapers/flare.ts`** (li inteiro, 323 linhas):

- Apague o mapa em memória `const preferred = new Map<string, SolverKind>()`
  (linha 61) e o `preferred.set(host, solver.kind)` dentro do `flareSolve`
  (linha 303). Quem responde "qual ganhou aqui" passa a ser `lastWinner(host)`.
- Em `solverOrder()` (linha 238), hoje o rank é
  `(isMuted(solverKey(s.kind, host)) ? 2 : 0) + (s.kind === win ? -1 : 0)`.
  A nova regra:
  1. calcule os candidatos como hoje (o filtro de `request.post` do T-001);
  2. separe em punidos (`isBenched`) e não punidos;
  3. se houver pelo menos um não punido, **descarte os punidos da lista** (é o
     ponto central do ticket: não gastar navegador em motor que só falha ali);
  4. se todos estiverem punidos, mantenha todos, ordenados por `lastFailAt` mais
     antigo primeiro — o host nunca pode ficar com zero tentativas;
  5. entre os não punidos, o `lastWinner(host)` vai primeiro; o resto mantém a
     ordem de `SOLVERS`.
- Troque a contabilidade por motor: `recordOk(solverKey(...), ms)` (linha 304) e
  `recordFail(solverKey(...))` (linha 310) passam a ser `recordSolverOk` /
  `recordSolverFail`. O helper `solverKey()` (linha 93) fica sem uso — remova.
- **Não** mexa no breaker por host: `breakerKey(host)`, `isMuted(breakerKey(host))`
  (linha 274) e os `recordOk/recordFail(breakerKey(host))` continuam em
  `sourceStats` e continuam em memória. Isso é de propósito: aquele mute chega a
  6h e persistir ele faria um deploy de correção nascer com fontes silenciadas.

Armadilha: o projeto **não tem test runner** (não há vitest/jest no
`package.json`; os scripts são `dev`, `build`, `lint`, `start` e os utilitários
`scripts/*.ts`). Não instale um. O gate é `npm run build`.

## Fora do escopo

- Persistir o breaker por host de `sourceStats.ts` (o mute de fonte inteira).
- Persistir os cookies de clearance (`clearances`, linha 58 de `flare.ts`): eles
  expiram em 90 min e o trawl já mantém sessão em Redis.
- Persistir a saúde das fontes do Suwayomi (`partitionByHealth`).
- Mostrar esse placar em qualquer tela — é o T-006.
- Criar tabela no Prisma. Arquivo JSON no volume é suficiente e evita migração.

## Pronto quando

- [ ] Existe `src/lib/scrapers/solverMemory.ts` exportando `recordSolverOk`,
      `recordSolverFail`, `isBenched`, `lastWinner` e `solverMemorySnapshot`.
- [ ] O mapa `preferred` não existe mais em `flare.ts`, e nada mais importa
      `solverKey`.
- [ ] Depois de um solve bem-sucedido existe `solver-memory.json` no diretório de
      estado, e o conteúdo carregado de volta reproduz a mesma ordenação.
- [ ] Um par (motor, host) com 3 falhas seguidas e falha recente não aparece na
      lista devolvida por `solverOrder` enquanto houver outro motor disponível
      para o mesmo host e comando.
- [ ] Se todos os motores estão punidos para um host, `solverOrder` devolve lista
      não vazia.
- [ ] `isMuted(breakerKey(host))` continua sendo consultado no começo do
      `flareSolve`.
- [ ] `npm run build` passa.

## Como testar (humano)

1. No servidor, atualize e suba: `git pull` e `docker compose up -d --build web`.
2. Abra https://reader.horizonfps.space e busque um título em cada uma destas
   fontes: dragontea, toonlivre, mangastop, risentoons. Anote quanto tempo cada
   uma levou.
3. Reinicie só o app: `docker compose restart web`. Espere uns 30 segundos.
4. Repita as mesmas quatro buscas. Elas têm que voltar tão rápido quanto na
   segunda tentativa do passo 2 — não podem voltar a demorar como se fosse a
   primeira vez.
5. Abra https://reader.horizonfps.space/info, seção de erros dos logs, e confirme
   que depois do restart **não** apareceu uma nova enxurrada de erros dizendo que
   o IP está banido nesses mesmos sites.
