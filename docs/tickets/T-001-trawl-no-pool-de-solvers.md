---
id: T-001
title: Subir o trawl (Camoufox + Redis) no compose e colocá-lo como primeiro motor do pool
status: ready
blockedBy: []
files: [docker-compose.yml, .env.example, DEPLOY.md, src/lib/scrapers/flare.ts]
---

## O que fazer

Hoje o stack tem dois motores de desafio (FlareSolverr e Byparr) e o app tenta
FlareSolverr primeiro em todo host. Em 48h de produção o FlareSolverr devolveu 81
erros "Cloudflare has blocked this request. Probably your IP is banned for this
site" exatamente nos 7 hosts que o Byparr resolve em 6–17s sem um único erro
(dragontea.ink, api.luacomic.org, www.frieren.online, api.housesaikai.net,
toonlivre.net, risentoons.xyz, mangastop.net), e 96 respostas HTTP 500 da fachada
que viram busca vazia pro usuário.

Este ticket adiciona um terceiro motor, o **trawl** (`ghcr.io/germondai/trawl`),
e o coloca como primeira opção do pool, com Byparr e FlareSolverr como fallback.
O trawl escalona em 4 níveis (HTTP puro → sessão em cache no Redis → navegador
Camoufox → proxy residencial), fala o mesmo endpoint `POST /v1` do FlareSolverr
e aceita `request.get` e `request.post`. Efeito visível: depois do deploy, o
painel `/info` lista dois containers novos (trawl e o Redis dele), o motor
`trawl` aparece na lista de serviços como online, e buscas nos hosts acima
voltam a trazer resultado.

Este ticket também deixa as variáveis de proxy do trawl prontas para uso
(`PROXY_URL`, `RESIDENTIAL_PROXY_URL`), vazias por padrão. Encher essas
variáveis é o único caminho real para os 81 "IP banned": eles são reputação do
IP de datacenter da VPS (Contabo, França), não incapacidade do motor. Trocar de
motor melhora o resto, mas não compra IP novo.

## Onde mexer

**`docker-compose.yml`** (arquivo real, li inteiro; o padrão da casa é serviço
com `container_name`, `restart: unless-stopped`, `expose` em vez de `ports`,
`networks: [manga]` e comentário curto em inglês explicando o porquê):

1. Novo serviço `trawl`:
   - `image: ghcr.io/germondai/trawl:latest` (a tag `:baseline` é para CPU sem
     AVX2; a VPS tem AVX2, então `:latest` é a certa).
   - `container_name: trawl`, `restart: unless-stopped`.
   - `shm_size: 1gb` (é o que o compose oficial do projeto usa; sem isso o
     Firefox morre em host OCI/LXC, mesmo problema já documentado no byparr).
   - `expose: ["8191"]` e **nenhum** `ports:` — o app fala com ele pela rede
     `manga`, igual byparr e flaresolverr. Não publique porta no host: 8191 e
     8192 podem estar ocupadas por outro projeto.
   - `mem_limit: ${TRAWL_MEM:-2560m}`. Precisa estar no compose versionado: o
     `docker-compose.override.yml` que existe fora do git em
     `/opt/horizonreader` só redefine web, suwayomi e flaresolverr, e serviço
     novo não herda nada dele. Orçamento medido na VPS: 11960 MB totais, 8504 MB
     livres, uso atual real 2,6 GB (web 222M, suwayomi 1.95G, flaresolverr 353M,
     byparr 97M). trawl 2560m + Redis 256m cabem com folga.
   - `depends_on: [redis]`.
   - `healthcheck: ["CMD", "curl", "-sf", "http://127.0.0.1:8191/health"]`,
     `interval: 30s`, `timeout: 10s`, `retries: 3`, `start_period: 90s` (o
     `/health` do trawl é estático: devolve `{status, uptime, pool:{...}}` e não
     dirige navegador, ao contrário do `/health` do Byparr).
   - `environment`: `TZ: America/Sao_Paulo`, `REDIS_URL: redis://redis:6379`,
     `BROWSER_POOL_SIZE: ${TRAWL_POOL_SIZE:-2}`,
     `BROWSER_CONTENT_PROCESSES: "2"`,
     `BROWSER_RECYCLE_AFTER_CONTEXTS: "8"`,
     `SESSION_TTL_SECONDS: ${TRAWL_SESSION_TTL:-3600}`,
     `PROXY_URL: ${PROXY_URL:-}`, `PROXY_LIST_FILE: ${PROXY_LIST_FILE:-}`,
     `RESIDENTIAL_PROXY_URL: ${RESIDENTIAL_PROXY_URL:-}`,
     `RESIDENTIAL_PROXY_LIST_FILE: ${RESIDENTIAL_PROXY_LIST_FILE:-}`,
     `MITM_PROXY_ENABLED: "false"`.
     (Todos esses nomes vêm do `.env.example` e do `docker-compose.yml` do
     próprio trawl; `BROWSER_POOL_SIZE` são navegadores quentes, e é o knob de
     RAM.)

2. Novo serviço `redis` (o cache de sessão do trawl é o que faz repetição no
   mesmo domínio voltar em ~500ms sem bootar navegador):
   - `image: redis:8-alpine`, `container_name: manga-redis`,
     `restart: unless-stopped`, `expose: ["6379"]`, `networks: [manga]`,
     `mem_limit: ${REDIS_MEM:-256m}`.
   - `command: redis-server --save "" --appendonly no --maxmemory 128mb --maxmemory-policy allkeys-lru`
     e **sem volume**: cookie de sessão é descartável, e persistir no disco só
     gera escrita na overlay.

3. Serviço `web`:
   - default de `SOLVERS` passa a ser
     `trawl@http://trawl:8191,byparr@http://byparr:8191,flaresolverr@http://flaresolverr:8191`
     (ordem = qual motor é tentado primeiro quando não há histórico do host).
   - default de `FLARE_CONCURRENCY` de `2` para `3`: agora são três motores e o
     primeiro nível do trawl é um GET barato, não um navegador.
   - `depends_on` ganha `trawl`.
   - Atualize o comentário do bloco `SOLVERS` (em inglês) para descrever os três
     motores em vez de dois.

4. Serviço `suwayomi`: acrescente
   `FLARESOLVERR_RESPONSE_AS_FALLBACK: "${FLARESOLVERR_RESPONSE_AS_FALLBACK:-true}"`.
   Esse é o nome exato da variável no `scripts/startup_script.sh` da imagem
   oficial (`Suwayomi/Suwayomi-Server-docker`), que a traduz para
   `server.flareSolverrAsResponseFallback`. Atenção: **não** é
   `FLARESOLVERR_AS_RESPONSE_FALLBACK`. Ligar agora é inócuo (a fachada nunca
   responde "not detected" hoje) e é pré-requisito do T-005.

**`src/lib/scrapers/flare.ts`** (li inteiro, 323 linhas):

- `type SolverKind = "flaresolverr" | "byparr" | "trawl"`.
- `parseSolvers()` (linha 35): o mapeamento atual é
  `kind === "byparr" ? "byparr" : "flaresolverr"`, o que jogaria `trawl` em
  `flaresolverr`. Passe a reconhecer `trawl` explicitamente e mantenha
  `flaresolverr` como o destino de qualquer `kind` desconhecido. Faça o mesmo no
  ramo legado que lê `SOLVER_KIND`.
- `solverSupportsPost()` (linha 73): hoje é `s.kind === "flaresolverr"`. Passe a
  `s.kind !== "byparr"` — verifiquei o código do trawl
  (`apps/api/src/routes/v1.ts`): ele aceita `request.get` e `request.post` e
  rejeita qualquer outro `cmd` com 400. Byparr continua sendo o único GET-only.
- `solverOrder()` (linha 238): o filtro de `request.post` hoje é
  `s.kind === "flaresolverr"`; passe a `s.kind !== "byparr"`.
- `callSolver()` (linha 184): o `if (solver.kind === "byparr")` continua sendo o
  único ramo com `max_timeout`/`blockMedia`; o `else if (postData !== undefined)`
  já cobre o trawl (que espera `maxTimeout` em camelCase e `postData`), então
  nada muda ali. Confirme, não reescreva.
- Atualize o comentário de cabeçalho do arquivo (em inglês, curto) para falar de
  três motores.
- O trawl **não** implementa `sessions.*`, e isso não é problema: a fachada em
  `src/app/api/solver/[token]/v1/route.ts` responde os comandos de sessão sozinha
  e nunca os repassa pro motor.

**`.env.example`**: atualize o bloco `SOLVERS` (hoje lista dois motores em
localhost) para incluir `trawl` primeiro e documente as variáveis novas com uma
linha cada: `TRAWL_MEM`, `TRAWL_POOL_SIZE`, `TRAWL_SESSION_TTL`, `REDIS_MEM`,
`PROXY_URL`, `PROXY_LIST_FILE`, `RESIDENTIAL_PROXY_URL`,
`RESIDENTIAL_PROXY_LIST_FILE`, `FLARESOLVERR_RESPONSE_AS_FALLBACK`. Deixe claro
que `PROXY_URL` é proxy de datacenter (nível 3) e `RESIDENTIAL_PROXY_URL` é
residencial (nível 4), ambos vazios por padrão, e que o nível 4 é o único jeito
de sair por outro IP nos hosts que respondem "IP banned".

**`DEPLOY.md`**: o bullet de solvers (seção "1. App em Docker", linhas 33–39)
descreve dois motores; reescreva para três, dizendo qual é a ordem e por quê.
Acrescente, na seção "Atualizar depois de mexer no código", que este deploy
precisa de `docker compose up -d --build` (sem `web` no fim), porque há serviço
novo, e um aviso: **se o `.env` da VPS já define `SOLVERS`, ele vence o default
do compose e precisa ganhar o `trawl` na frente, senão o motor novo sobe e nunca
é chamado.**

## Fora do escopo

- Mudar a ordem aprendida por host, ou persistir esse aprendizado — é o T-002.
- Mexer na divisão de orçamento entre tentativas — é o T-003.
- Mostrar estatística por motor no painel — é o T-006.
- Ligar o proxy MITM do trawl (`MITM_PROXY_ENABLED`, porta 8192, CA em
  `/proxy-ca.crt`): fica desligado, e instalar CA em cada cliente não faz parte.
- Configurar `STT_URL` (transcrição de áudio para reCAPTCHA): o trawl funciona
  sem isso.
- Remover FlareSolverr ou Byparr do stack. Os três ficam.
- Assinar/contratar proxy residencial. Aqui só entra a variável.

## Pronto quando

- [ ] `docker-compose.yml` tem os serviços `trawl` e `redis`, com `shm_size: 1gb`
      e `mem_limit` no trawl, nenhum `ports:` em nenhum dos dois, e ambos na rede
      `manga`.
- [ ] O default de `SOLVERS` no serviço `web` começa por `trawl@http://trawl:8191`
      e lista os três motores.
- [ ] O serviço `suwayomi` define `FLARESOLVERR_RESPONSE_AS_FALLBACK` (grafia
      exata) com default `true`.
- [ ] Em `flare.ts`, `SolverKind` inclui `"trawl"`, `parseSolvers()` devolve kind
      `trawl` para a entrada `trawl@http://trawl:8191`, e `solverSupportsPost()`
      devolve `true` num pool que só tem trawl.
- [ ] `solverOrder(host, "request.post")` não descarta o trawl e continua
      descartando o byparr.
- [ ] `.env.example` documenta `PROXY_URL` e `RESIDENTIAL_PROXY_URL`.
- [ ] `DEPLOY.md` avisa que `SOLVERS` no `.env` da VPS precisa ganhar o trawl.
- [ ] `npm run build` passa.

## Como testar (humano)

1. No servidor, entre na pasta do projeto (`/opt/horizonreader`), puxe o código
   novo e suba tudo: `git pull` e depois
   `docker compose up -d --build`. Na primeira vez o download da imagem do motor
   novo é grande (navegador embutido), pode levar alguns minutos.
2. Se o arquivo `.env` do servidor tiver uma linha começando com `SOLVERS=`,
   troque o conteúdo dela por
   `SOLVERS=trawl@http://trawl:8191,byparr@http://byparr:8191,flaresolverr@http://flaresolverr:8191`
   e rode `docker compose up -d web` de novo. Se não tiver essa linha, não faça
   nada.
3. Abra https://reader.horizonfps.space/info. Na lista de containers devem
   aparecer dois novos, `trawl` e `manga-redis`, os dois em estado de rodando.
4. Na caixa de serviços, deve aparecer uma linha `trawl` marcada como online.
5. Busque um título em cada uma destas fontes: dragontea, toonlivre, mangastop,
   risentoons. Cada busca tem que voltar com resultado (pode demorar até uns 20
   segundos na primeira vez de cada site, e ser quase instantânea na segunda).
6. Volte no `/info`, seção de erros dos logs. A quantidade de erros dizendo que o
   IP está banido tem que parar de crescer.
