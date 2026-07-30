---
id: T-005
title: Fachada do solver nunca devolver identidade vazia e entregar a página quando não há desafio
status: ready
blockedBy: []
files: [src/app/api/solver/[token]/v1/route.ts]
---

## O que fazer

O Suwayomi só aceita um endereço de solver, então ele aponta para a fachada do
próprio app (`/api/solver/<token>/v1`), que fala o formato do FlareSolverr. Dois
problemas nessa fachada, ambos confirmados no código do Suwayomi
(`eu.kanade.tachiyomi.network.interceptor.CloudflareInterceptor` /
`CFClearance`, que eu li):

1. Quando o solve dá certo mas nenhum cookie de clearance foi guardado para aquele
   host, a fachada responde `userAgent: ""` e `cookies: []`. O Suwayomi, no
   caminho de sucesso, chama `setUserAgent(solution.userAgent)` — que é
   **global**, não por host. Ou seja: um único solve sem cookie zera o
   User-Agent do engine inteiro, e todas as requisições seguintes, de todas as
   fontes, saem com identidade vazia.
2. Nesse mesmo caso, o Suwayomi repete a requisição original sem cookie nenhum,
   toma 403 de novo e a fonte morre — mesmo tendo a fachada em mãos o HTML da
   página que o motor já baixou.

Depois deste ticket: nenhuma resposta de sucesso sai com User-Agent vazio, e
quando não há cookie a fachada avisa o engine de que não havia desafio e entrega o
HTML, que o engine usa direto como resposta. Efeito visível: fontes como
luratoons e comick, que hoje aparecem como busca vazia, voltam a trazer resultado,
e o feed de erros do `/info` para de acumular `CFClearance ... HTTP error 500` e
`InterruptedIOException: timeout` no `getSearchManga`.

## Onde mexer

**`src/app/api/solver/[token]/v1/route.ts`** (li inteiro, 105 linhas). Só este
arquivo.

Fatos do lado do Suwayomi que definem o contrato (verificados no fonte, não
adivinhados):

- Ele só chama a fachada quando a resposta original foi 403 ou 503 **e** o header
  `Server` é da Cloudflare.
- Ele considera o desafio resolvido a menos que o campo `message` da resposta
  contenha `"not detected"` (comparação sem diferenciar maiúsculas).
- No caminho "resolvido", ele faz `setUserAgent(solution.userAgent)` e guarda
  `solution.cookies` no cookie store.
- No caminho "not detected", com `server.flareSolverrAsResponseFallback` ligado,
  ele usa `solution.response` como corpo da resposta, desde que
  `solution.status` esteja em 200..299 e o corpo não seja o template de imagem do
  Chrome (`<title>algo (800×600)</title>`). Essa flag é ligada no compose pelo
  T-001, com a grafia de env `FLARESOLVERR_RESPONSE_AS_FALLBACK`.

Mudanças:

1. Constante local com um User-Agent de desktop real (o mesmo padrão de string que
   `src/lib/scrapers/http.ts` usa no topo dele). A resposta de sucesso passa a
   usar `clearance?.userAgent || FALLBACK_UA`, nunca string vazia.
2. Quando a lista de cookies montada a partir da clearance estiver vazia,
   responda com `message: "Challenge not detected"` e mantenha o HTML em
   `solution.response`. O helper `ok()` (linha 32) espalha `...body` **depois** de
   `message: ""`, então basta passar `message` no objeto — não precisa refatorar o
   helper.
3. Quando houver cookies, nada muda: `message` continua vazia e os cookies saem no
   mesmo formato de hoje (`name`, `value`, `domain`, `path`).
4. Um comentário curto em inglês explicando por que a mensagem "not detected"
   existe (o engine usa o corpo em vez de repetir a requisição sem cookie).

Armadilhas:

- `solution.status` precisa continuar sendo 200 nas respostas de sucesso, senão o
  engine trata como falha de bypass e lança exceção.
- Não invente sessão: os comandos `sessions.*` já são respondidos aqui mesmo
  (linhas 64–66) e nunca chegam aos motores. Deixe como está — o trawl, aliás,
  não implementa `sessions.*`.
- Comportamento conhecido do engine, esperado e sem risco de laço infinito: quando
  a resposta diz "not detected", outras threads que estavam esperando o mesmo host
  recebem `CloudflareNotDetected` e tentam de novo (uma vez cada). Como o caminho
  de sucesso comum continua com `message: ""`, isso só acontece nos hosts sem
  cookie, e a segunda chamada tende a cair no cache de sessão do motor.
- O erro (linha 43) continua respondendo HTTP 500. Não mude isso aqui.

## Fora do escopo

- Mexer no `docker-compose.yml`. Quem liga `FLARESOLVERR_RESPONSE_AS_FALLBACK` é o
  T-001; se ele ainda não tiver rodado, este ticket já vale pela correção do
  User-Agent vazio.
- Honrar o campo `returnOnlyCookies` que o engine manda (economizaria banda ao
  omitir o corpo). Fica para depois.
- Mudar orçamento/timeout da fachada (`MAX_BUDGET_MS`, `MIN_BUDGET_MS`,
  `CALLER_GRACE_MS`) — é o T-003, e em outro arquivo.
- Mexer em `src/lib/scrapers/flare.ts`.
- Mudar a validação de host privado (`PRIVATE_HOST`) ou a checagem do token.

## Pronto quando

- [ ] Nenhuma resposta de sucesso da fachada pode sair com `solution.userAgent`
      vazio (há fallback constante).
- [ ] Quando não há cookie de clearance para o host, a resposta traz `message`
      contendo `not detected`, `solution.status` 200 e o HTML em
      `solution.response`.
- [ ] Quando há cookie, `message` continua vazia e os cookies saem no formato
      atual.
- [ ] Comandos `sessions.*` e as validações de token/URL continuam iguais.
- [ ] `npm run build` passa.

## Como testar (humano)

1. No servidor: `git pull` e `docker compose up -d --build`.
2. Abra https://reader.horizonfps.space e busque títulos em luratoons, comick,
   mangalivre, toonily e manhuaus. Cada uma tem que voltar com resultado.
3. Abra https://reader.horizonfps.space/info, seção de erros dos logs, e confirme
   que as mensagens do engine sobre "erro 500" ao pedir bypass de Cloudflare, e as
   de "timeout" na busca de fontes, param de crescer.
4. Faça uma busca genérica (uma palavra que apareça em muitos títulos) e confirme
   que várias fontes diferentes respondem, não só uma ou duas. Isso mostra que a
   identidade do engine não foi zerada.
