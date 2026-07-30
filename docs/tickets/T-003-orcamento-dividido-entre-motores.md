---
id: T-003
title: Reservar orçamento para o segundo e o terceiro motor em vez de morrer em solver_budget_exhausted
status: ready
blockedBy: [T-002]
files: [src/lib/scrapers/flare.ts]
---

## O que fazer

O gateway de solvers recebe do Suwayomi um orçamento de tempo (hoje 60s, do qual
a fachada reserva 5s para devolver a resposta) e percorre os motores em ordem. O
problema: a **primeira** tentativa recebe quase todo o orçamento
(`min(FLARE_TIMEOUT, remaining - 5s)`), então quando ela estoura por timeout
sobram menos de 15s (`MIN_ATTEMPT_MS`) e o laço aborta com
`solver_budget_exhausted` sem nunca chamar o segundo motor. Em produção isso
aparece como 12 timeouts de 50s do FlareSolverr e 96 respostas HTTP 500 da
fachada, que no Suwayomi viram
`CFClearance.resolveWithFlareSolver ... HttpException: HTTP error 500` e depois
`GraphQL execution failed due to java.io.InterruptedIOException: timeout` no
`getSearchManga` — ou seja, busca vazia pro usuário, mesmo tendo dois motores
sobrando que resolveriam aquele site em 6–17s.

Depois deste ticket, o orçamento é fatiado entre os motores que ainda serão
tentados, de modo que um timeout do primeiro **não** consome a chance do segundo.
E quando todos falham, sai uma linha única de log dizendo host, motores tentados
e o motivo de cada um, para o feed de erros de `/info` parar de mostrar só
"HTTP 500" sem explicação.

## Onde mexer

**`src/lib/scrapers/flare.ts`** (li inteiro, 323 linhas). Todo o trabalho está no
laço `for (const solver of order)` dentro de `flareSolve` (linhas 293–315), onde
hoje há:

```
const remaining = deadline - Date.now();
if (remaining < MIN_ATTEMPT_MS) { lastError = new Error("solver_budget_exhausted"); break; }
...
const budget = Math.min(FLARE_TIMEOUT, remaining - SOLVE_GRACE_MS);
```

Regra nova, com as constantes que já existem no topo do arquivo
(`FLARE_TIMEOUT` = 60s, `SOLVE_GRACE_MS` = 5s, `MIN_ATTEMPT_MS` = 15s):

- `usable = remaining - SOLVE_GRACE_MS` é o que dá para gastar nesta tentativa.
- `left` = quantos motores ainda faltam nesta iteração, inclusive o atual (use o
  índice do laço, ex. trocando para `order.entries()`).
- `reserve = (left - 1) * MIN_ATTEMPT_MS` — o piso guardado para os que vêm
  depois.
- `budget = Math.min(FLARE_TIMEOUT, usable - reserve)`. Se der menos que
  `MIN_ATTEMPT_MS`, use `Math.min(FLARE_TIMEOUT, usable)`: é a última chance
  útil, melhor uma tentativa cheia do que nenhuma.
- Só saia do laço por orçamento quando `usable < MIN_ATTEMPT_MS`; nesse caso
  `lastError = new Error("solver_budget_exhausted")` como hoje.
- Com 3 motores e 55s isso dá ~20s / ~15s / ~15s, que cabe: as soluções reais
  medidas em produção levam 6–17s.
- O `deadline` continua sendo `Infinity` quando o chamador não passa `budgetMs`
  (é o caso de `src/lib/scrapers/http.ts` e de
  `src/lib/backbone/comick.ts`); nesse caso `remaining` é `Infinity` e a conta
  precisa continuar caindo em `FLARE_TIMEOUT` por tentativa, sem `NaN`. Garanta
  isso (`Infinity - 5000` e `Infinity - reserve` seguem `Infinity`, então
  `Math.min` resolve — só não introduza subtração que gere `NaN`).

Além disso, ainda em `flareSolve`:

- Acumule, por tentativa, `kind` e a mensagem do erro, e quando o laço terminar
  sem sucesso emita **uma linha só** com `console.warn`, no formato
  `"[solver] all engines failed"` seguido de host, ms gastos e os pares
  motor=motivo separados por espaço. Uma linha só importa: o parser de logs do
  painel (`src/lib/metrics/logs.ts`) agrupa por assinatura e trata linha
  quebrada como continuação de stack trace. Não use template com números soltos
  variando no meio da frase além dos que já são inevitáveis.
- Mantenha intacto o comportamento de aborto do chamador
  (`if (opts.signal?.aborted) throw e`) e o `recordFail(breakerKey(host))` depois
  de pelo menos uma tentativa.

Contexto útil que verifiquei no Suwayomi (`CloudflareInterceptor.kt`) e que
explica por que essa correção vale tanto: as chamadas do engine à fachada são
serializadas por um `Mutex` global (`resolveWithFlareSolver` roda dentro de
`mutex.withLock`). Cada solve que queima 50s para terminar em erro trava a fila
de desafio de todas as outras fontes durante esses 50s.

## Fora do escopo

- Mudar `MAX_BUDGET_MS`, `MIN_BUDGET_MS` ou `CALLER_GRACE_MS` na fachada
  (`src/app/api/solver/[token]/v1/route.ts`). Não toque nesse arquivo.
- Mudar `FLARESOLVERR_TIMEOUT` no compose.
- Mudar a ordem dos motores ou a regra de punição — isso é o T-002.
- Aumentar `FLARE_CONCURRENCY` (já ajustado no T-001).
- Fazer as tentativas em paralelo. A ordem sequencial é intencional: cada
  tentativa custa um navegador.

## Pronto quando

- [ ] Com orçamento de 55s e três motores na lista, a primeira tentativa recebe no
      máximo `usable - 2 * MIN_ATTEMPT_MS` de budget.
- [ ] Um timeout do primeiro motor ainda deixa o segundo ser chamado dentro da
      mesma requisição (a saída por `solver_budget_exhausted` só acontece quando o
      que resta é menor que uma tentativa mínima).
- [ ] Chamada sem `budgetMs` continua funcionando e cada tentativa recebe
      `FLARE_TIMEOUT`, sem `NaN` no budget.
- [ ] Quando todos os motores falham, sai exatamente uma linha de `console.warn`
      contendo o host e um par motor=motivo por motor tentado.
- [ ] `npm run build` passa.

## Como testar (humano)

1. No servidor: `git pull` e `docker compose up -d --build web`.
2. Abra https://reader.horizonfps.space e busque títulos em várias fontes
   diferentes, incluindo as que costumam falhar (natomanga, comick, mangalivre,
   setsuscans, luratoons).
3. Abra https://reader.horizonfps.space/info e olhe a seção de erros dos logs.
4. Duas coisas têm que mudar: praticamente não deve mais aparecer erro de "tempo
   esgotado" do app antes de ele ter tentado mais de um motor, e quando uma busca
   realmente falhar em todos os motores, deve aparecer **uma** linha de aviso
   dizendo o site e o que cada motor respondeu — em vez de só "erro 500".
5. Confirme que as buscas que antes voltavam vazias agora voltam com resultado na
   maioria dos sites.
