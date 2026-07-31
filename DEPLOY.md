# Deploy — reader.horizonfps.space

App num servidor Ubuntu de casa (`g15-server`, projeto em
`/srv/docker/horizonreader`), publicado por uma Cloudflare Tunnel. Só o app web
fica exposto; Suwayomi e o motor de desafio (trawl) ficam internos.

## Instalação limpa

`scripts/setup-local-server.sh` faz a máquina nova inteira: Docker pelo
repositório oficial, clone, `.env`, importação do banco, subida da stack e as
fontes do Suwayomi. Basta deixar `.env` e, se for migrar dados, um
`reader-data.tgz` com `app.db` e `uploads` ao lado do script:

```
sudo bash setup-local-server.sh
```

Ele também impede o notebook de suspender ao fechar a tampa, que é o que derruba
o site num servidor doméstico.

## Pré-requisitos

- **`horizonfps.space` no DNS da Cloudflare.** A Cloudflare Tunnel só roteia
  hostnames cujo domínio seja uma zona Cloudflare. Se o domínio estiver noutro
  DNS (Vercel etc.), mova primeiro: painel da Cloudflare > Add a site > plano
  free > deixe importar os registros existentes (o site atual continua no ar) >
  troque os nameservers no registrador pelos da Cloudflare.

## 1. App em Docker (porta do host configurável)

`WEB_PORT` define a porta publicada no host (o túnel aponta pra ela). Escolha uma
porta livre e coloque no `.env`:

```
AUTH_SECRET=<string longa aleatória>
WEB_PORT=8081
```

Suba só o app (reaproveita Suwayomi/trawl se já estiverem de pé):

```
docker compose up -d --build web
```

- Teste local: http://localhost:41573
- Admin do Suwayomi (extensões / fontes): http://localhost:4567 (só localhost).
- O motor de desafio é só o trawl (mais Redis para a sessão em cache) — medição
  feita neste repositório a partir de um IP brasileiro: o trawl acertou 20 de
  20 alvos contra 0 de 9 do Byparr, então manter três motores deixou de fazer
  sentido. O trawl escalona HTTP puro → sessão em cache no Redis → navegador
  Camoufox → proxy residencial. `SOLVER_PROXY_TOKEN` no `.env` é obrigatório: é
  o segredo no caminho de `/api/solver/<token>/v1`, a fachada que o Suwayomi
  usa (ele só aceita um `FLARESOLVERR_URL`).

## 1.1 Instalar as fontes do Suwayomi

Um Suwayomi novo não vem com extensão nenhuma, e um conjunto instalado à mão
envelhece (a produção ficou sem nenhuma fonte pt-BR). Depois de subir:

```
docker compose exec web npm run sync-extensions
docker compose exec web npm run sync-extensions -- --dry-run   # só listar
docker compose exec web npm run sync-extensions -- --no-nsfw   # pular as adultas
```

Instala todas as extensões en / pt-BR / all do repo Keiyoushi, incluindo as
marcadas como adultas. Uma obra +18 marca a extensão inteira, e pular essas
custava 77 das 113 fontes pt-BR.

## 2. Cloudflare Tunnel → app

O conector roda como container junto da stack: `CF_TUNNEL_TOKEN` no `.env` e
`docker compose --profile tunnel up -d`. Como ele sobe por token, a configuração
é a remota (painel/API), não um `config.yml` local.

No painel Zero Trust > Networks > Tunnels > (seu túnel) > Public Hostname > Add:

- Subdomain: `reader`
- Domain: `horizonfps.space`
- Path: vazio
- Service: Type `HTTP`, URL `web:3000` — nome do serviço na rede do compose, não
  `localhost`, que dentro do container é o próprio conector.

Salvar. A Cloudflare cria o CNAME `reader.horizonfps.space` sozinha.

Um conector antigo rodando noutra máquina continua atendendo o mesmo túnel e
divide o tráfego com este. Ao mudar de máquina, remova o de lá
(`cloudflared service uninstall`).

## 3. Criar seu usuário (não há cadastro público)

```
docker compose exec web npm run user -- add <usuario> <senha> --admin
docker compose exec web npm run user -- list
```

## Dados e persistência

- Banco SQLite em `./data/app.db`, uploads em `./data/uploads`, ambos no volume
  `./data` (sobrevivem a rebuilds). Backup = a pasta `./data`.
- Levar dados do dev: pare o `npm run dev`, copie `prisma/dev.db` para
  `data/app.db` antes do primeiro `up`.

## Painel de infra — `/info`

Só admin (`isAdmin`) enxerga; qualquer outra sessão é redirecionada. Mostra CPU,
RAM, disco, swap, carga, PSI, rede e I/O do host, estatísticas por container,
saúde do engine e dos solvers, tamanho dos caches e um feed de erros dos logs.

"Entrada pública" procura no host o que publica o app — `cloudflared`, `nginx`,
`caddy` ou `traefik` — e mostra qual achou. Na VPS quem responde é o nginx.

Depende de três coisas no `docker-compose.yml`, todas já configuradas:

- `/proc:/host/proc:ro` no container `web` — de onde saem os contadores da
  máquina. Sem isso o painel sobe, mas a seção do host fica vazia.
- O serviço `dockerproxy` — proxy do socket do Docker que libera só GET
  (`CONTAINERS`, `INFO`, `VERSION`, `PING`), de onde saem stats e logs dos
  containers. Nunca publique essa porta no host.
- `./suwayomi:/suwayomi:ro`, usado só para medir a pasta de downloads.

O painel é somente leitura: nenhuma rota escreve ou reinicia nada.

## Atualizar depois de mexer no código

```
docker compose up -d --build web
```

Quando o `docker-compose.yml` ganha serviço novo (caso do trawl e do Redis
dele), esse `web` no fim não basta — sobe só o app e o serviço novo nunca
nasce. Rode `docker compose up -d --build` sem nomear serviço.

**Atenção:** se o `.env` já define `SOLVERS`, ele vence o default do compose e
precisa valer `trawl@http://trawl:8191`, senão o app nunca chama o motor.

Ao atualizar para a versão que tirou `byparr` e `flaresolverr` do compose, rode
`docker compose up -d --build --remove-orphans`: sem o `--remove-orphans` os
dois containers removidos continuam de pé na máquina.
