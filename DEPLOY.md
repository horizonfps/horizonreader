# Deploy — reader.horizonfps.space

Stack no PC de casa via Docker, publicado pela Cloudflare Tunnel. Só o app web
fica exposto; Suwayomi e FlareSolverr ficam internos.

## Pré-requisitos

- Docker Desktop rodando.
- `horizonfps.space` gerenciado pela Cloudflare (nameservers apontando pra ela).
  Se ainda não estiver: adicione o site no painel da Cloudflare (plano free),
  confirme que os registros DNS existentes foram importados (o site FPS continua
  no ar) e troque os nameservers no registrador.

## 1. Criar o túnel na Cloudflare

1. Cloudflare Zero Trust (ative o plano free na primeira vez) → Networks →
   Tunnels → Create a tunnel → Cloudflared → nome `horizonreader`.
2. Na tela de instalação, copie só o token (a string longa depois de `--token`).
   Não precisa rodar o comando deles.
3. Aba Public Hostname → Add a public hostname:
   - Subdomain: `reader`
   - Domain: `horizonfps.space`
   - Path: vazio
   - Service: Type `HTTP`, URL `web:3000`
4. Salvar. A Cloudflare cria o CNAME `reader.horizonfps.space` sozinha.

## 2. Configurar o .env (raiz do projeto)

```
AUTH_SECRET=<string longa aleatória>
CF_TUNNEL_TOKEN=<token copiado no passo 1>
```

`DATABASE_URL` e `SUWAYOMI_URL` do `.env` são ignorados pelo container; o
`docker-compose.yml` sobrescreve os dois.

## 3. Subir o stack

```
docker compose up -d --build
```

- App: https://reader.horizonfps.space (pelo túnel) e http://localhost:3000
  (teste local).
- Admin do Suwayomi (instalar extensões / adicionar fontes): http://localhost:4567
  (só localhost).

## 4. Criar seu usuário (não há cadastro público)

```
docker compose exec web npm run user -- add <usuario> <senha> --admin
docker compose exec web npm run user -- list
```

## Dados e persistência

- Banco SQLite em `./data/app.db`, uploads em `./data/uploads`. Ambos no volume
  `./data`, que sobrevive a rebuilds.
- Levar os dados de teste do dev: pare o `npm run dev`, copie `prisma/dev.db`
  para `data/app.db` antes do primeiro `up`. Os uploads já ficam em
  `./data/uploads`.
- Backup = a pasta `./data` (e `./suwayomi` se quiser guardar downloads/fontes).

## Atualizar depois de mexer no código

```
docker compose up -d --build web
```
