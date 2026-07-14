# Deploy — reader.horizonfps.space

App no PC de casa via Docker, publicado por uma Cloudflare Tunnel. Só o app web
fica exposto; Suwayomi e FlareSolverr ficam internos.

## Pré-requisitos

- Docker Desktop rodando (com "start on login" pra subir sozinho).
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
WEB_PORT=41573
```

Suba só o app (reaproveita Suwayomi/FlareSolverr se já estiverem de pé):

```
docker compose up -d --build web
```

- Teste local: http://localhost:41573
- Admin do Suwayomi (extensões / fontes): http://localhost:4567 (só localhost).

## 2. Cloudflare Tunnel → app

Duas formas de rodar o conector (escolha uma):

- **Serviço do Windows** (o que está em uso): `cloudflared.exe service install <token>`.
  O conector roda no host, então a rota deve apontar pra `localhost:<WEB_PORT>`.
- **Container** (portável, ex. num VPS): `docker compose --profile tunnel up -d`
  com `CF_TUNNEL_TOKEN` no `.env`. Aí a rota aponta pra `web:3000`.

No painel Zero Trust > Networks > Tunnels > (seu túnel) > Public Hostname > Add:

- Subdomain: `reader`
- Domain: `horizonfps.space`
- Path: vazio
- Service: Type `HTTP`, URL `localhost:41573` (serviço Windows) ou `web:3000` (container)

Salvar. A Cloudflare cria o CNAME `reader.horizonfps.space` sozinha.

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

## Atualizar depois de mexer no código

```
docker compose up -d --build web
```
