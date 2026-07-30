---
id: T-004
title: Só pagar um navegador quando a falha do fetch direto tem cara de bloqueio
status: ready
blockedBy: []
files: [src/lib/scrapers/http.ts]
---

## O que fazer

Os scrapers nativos tentam um fetch direto e, **em qualquer erro**, escalam para o
pool de solvers. Qualquer erro mesmo: 404 de capítulo que não existe, 500 do site,
429 de rate limit, timeout. Cada escalada dessas custa um navegador inteiro e
dezenas de segundos, e é parte da explicação para os 78 registros de "Challenge
not detected!" em 48h (luratoons.net 31, api.comick.dev 14, mangalivre.to 5,
toonily.com 3, manhuaus.com 2, batcave.biz 2) — navegador bootado num host que
não tinha desafio nenhum.

O espelho disso é um bug de conteúdo: quando o fetch direto responde **200** mas o
corpo ainda é a página de desafio da Cloudflare, o texto do desafio é devolvido
como se fosse a página da obra, e o scraper tenta parsear aquilo.

Depois deste ticket: falha que não tem cara de bloqueio sobe como erro para quem
chamou (rápido, sem navegador), falha com cara de bloqueio continua escalando, e
resposta 200 que é desafio disfarçado passa a escalar em vez de virar conteúdo
podre.

## Onde mexer

**`src/lib/scrapers/http.ts`** (li inteiro, 101 linhas). Só este arquivo.

Estado atual: `getText` (linha 35) faz `if (!res.ok) throw` e o `catch` chama
`flareSolve("request.get", url)`; `postForm` (linha 79) faz o mesmo através de
`rawPost` (linha 57). Os dois também chamam `dropClearance(url)` em qualquer
falha.

Mudanças:

1. Um classificador local, no topo do arquivo:
   - `const BLOCKED_STATUS = new Set([403, 429, 503, 520, 521, 522, 523, 524, 525, 526, 530]);`
     (403 é o WAF/IP de datacenter, 503 é o interstitial da Cloudflare, 429 é o
     rate limit que o navegador do solver costuma atravessar, e a faixa 52x é erro
     de borda da Cloudflare). **Não** inclua 404, 400, 410, 451, 500 e 502.
   - `function shouldSolve(status: number | undefined, body?: string): boolean` —
     `true` quando `status` está em `BLOCKED_STATUS`, quando `status` é
     `undefined` (erro de rede/timeout: o fetch nem chegou a responder), ou
     quando `body` é passado e `looksLikeChallenge(body)` é `true`.
2. `looksLikeChallenge` já é exportado por `./flare` (linha 176 de `flare.ts`);
   acrescente-o ao import que já existe no topo do arquivo.
3. Os erros de status precisam carregar o status para o classificador. Crie um
   helper local que devolve o erro com o campo, mantendo a mensagem atual do
   projeto:
   `const httpError = (method: string, url: string, status: number) => Object.assign(new Error(`${method} ${url} -> ${status}`), { status });`
   e use nos dois lugares que hoje montam essa string (linhas 45 e 72). Leia de
   volta com `(e as { status?: number }).status`.
4. `getText`: quando `res.ok`, leia o texto **antes** de devolver e, se
   `looksLikeChallenge(text)`, escale para o solver em vez de devolver o texto.
   Quando `!res.ok`, lance `httpError`. No `catch`: se `shouldSolve(status)` for
   `false` (ou o solver estiver desabilitado), repasse o erro original sem chamar
   o solver.
5. `postForm`: mesma classificação no `catch`, antes de decidir entre
   `solveClearance` + replay e `flareSolve("request.post", ...)`. A lógica de
   escolha entre esses dois caminhos (que depende de `solverSupportsPost()`) fica
   como está.
6. `dropClearance(url)` passa a ser chamado **somente** quando a decisão é
   escalar. Um 404 não invalida o cookie de clearance e hoje o descarte joga fora
   uma clearance boa, forçando um solve novo na próxima chamada.
7. Comentários novos em inglês, curtos, no estilo do arquivo.

Armadilhas:

- O timeout local é `TIMEOUT = 20_000` com `AbortController`; um abort cai no
  `catch` sem `status`, e isso **deve** escalar (é o caso do site lento atrás de
  desafio). Não trate abort como erro comum.
- Não escale duas vezes: `flareSolve` já lança `solver_challenge` quando a
  resposta do motor ainda é desafio (linha 225 de `flare.ts`); não tente resolver
  de novo em cima disso.
- O projeto não tem test runner (`package.json` só tem `dev`, `build`, `lint`,
  `start` e scripts utilitários). Não instale um; o gate é `npm run build`.

## Fora do escopo

- `src/lib/backbone/comick.ts` (linha 242) chama `flareSolve` direto depois do
  fetch próprio dele falhar. Não mexa nesse arquivo.
- A fachada `/api/solver/<token>/v1` (o caminho pelo qual o Suwayomi pede solve)
  — é o T-005.
- Mudar `TIMEOUT`, o User-Agent ou os headers padrão.
- Mudar as regras de `looksLikeChallenge` em `flare.ts`.
- Cachear respostas de erro por host.

## Pronto quando

- [ ] Uma resposta 404 ou 500 do fetch direto não chama mais nenhum solver: o erro
      sobe para quem chamou.
- [ ] 403, 429, 503 e a faixa 52x continuam escalando para o solver.
- [ ] Erro de rede ou timeout (sem status) continua escalando.
- [ ] Resposta 200 cujo corpo passa em `looksLikeChallenge` escala para o solver em
      vez de ser devolvida como conteúdo.
- [ ] `dropClearance` só é chamado nos casos em que há escalada.
- [ ] `postForm` aplica a mesma classificação que `getText`.
- [ ] `npm run build` passa.

## Como testar (humano)

1. No servidor: `git pull` e `docker compose up -d --build web`.
2. Abra https://reader.horizonfps.space e abra três ou quatro obras que tenham
   várias fontes ligadas, incluindo alguma fonte que esteja fora do ar.
3. A página tem que terminar de carregar em poucos segundos. Antes, uma fonte
   morta podia segurar o carregamento por dezenas de segundos porque o app
   tentava abrir um navegador para ela.
4. Abra https://reader.horizonfps.space/info, seção de erros dos logs, e confirme
   que a contagem de mensagens "Challenge not detected" (desafio não encontrado)
   para de crescer no mesmo ritmo de antes.
5. Leia um capítulo de uma obra qualquer até o fim para confirmar que nada de
   conteúdo quebrou: as páginas têm que carregar normalmente.
