# Manga — leitor privado

Site privado de leitura de mangá. O **Suwayomi-Server** roda como engine interno
(faz o scraping das fontes de scan via extensões Mihon/Tachiyomi e baixa os
capítulos); um app **Next.js** na frente entrega o leitor mobile-first, com login
próprio e biblioteca/progresso por usuário.

- Sem cadastro e sem "esqueci a senha". Contas são criadas manualmente por CLI.
- Biblioteca e progresso de leitura são **por usuário** (você e seus amigos não
  veem o progresso um do outro).
- O engine Suwayomi **não fica exposto** — só o app web publica porta.

## Arquitetura

```
navegador ──► app Next.js (login, leitor, proxy) ──► Suwayomi (interno) ──► fontes de scan
                     │                                     │
                 SQLite (usuários,                    FlareSolverr
                 follows, progresso)                  (Cloudflare)
```

O navegador nunca fala direto com o Suwayomi: páginas e capas passam pelo app,
que exige sessão válida.

## Rodar (Docker)

Pré-requisitos: Docker.

```bash
cp .env.example .env
# gere um segredo e coloque em AUTH_SECRET dentro do .env:
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

docker compose up -d --build
```

O app sobe em `http://localhost:3000`. O Suwayomi sobe interno, com sua WebUI de
administração acessível só em `http://localhost:4567` (para instalar extensões e
adicionar fontes na primeira vez).

### Primeiro uso

1. Abra `http://localhost:4567` (WebUI do Suwayomi) e, em **Browse → Extensions**,
   instale as extensões das fontes que você quer (o repo Keiyoushi já vem
   configurado). Adicione ao menos uma fonte.
2. Crie sua conta:
   ```bash
   docker compose exec web npm run user -- add SEU_USUARIO SUA_SENHA --admin
   ```
3. Acesse `http://localhost:3000`, faça login e comece a usar.

## Gerenciar contas

```bash
docker compose exec web npm run user -- add   <usuario> <senha> [--admin]
docker compose exec web npm run user -- passwd <usuario> <novaSenha>
docker compose exec web npm run user -- remove <usuario>
docker compose exec web npm run user -- list
```

(No dev, sem Docker, é só `npm run user -- ...`.)

## Desenvolvimento (para mexer na UI depois)

Suba só o engine no Docker e rode o app no host:

```bash
docker compose up -d suwayomi flaresolverr   # engine em localhost:4567
npm install
npm run db:push        # cria prisma/dev.db
npm run user -- add eu 123456 --admin
npm run dev            # http://localhost:3000
```

O `.env` de dev já aponta `SUWAYOMI_URL=http://localhost:4567`.

## Onde mexer

- **UI/UX**: `src/app/(app)/**` (páginas) e `src/components/**`. Tema/cores em
  `src/app/globals.css` (variáveis CSS) e `tailwind.config.ts`.
- **Leitor**: `src/app/reader/[chapterId]/**`.
- **Integração com o Suwayomi** (queries GraphQL): `src/lib/suwayomi.ts`.
- **Auth**: `src/lib/jwt.ts`, `src/middleware.ts`, `src/app/login/**`.
- **Banco** (usuários, follows, progresso): `prisma/schema.prisma`.

## Segurança / privacidade

- Deixe fora da internet aberta. O jeito recomendado é acessar via **Tailscale/
  WireGuard** e não fazer port-forward. Se expuser atrás de um reverse proxy com
  HTTPS, ligue `COOKIE_SECURE=true`.
- `robots` está como `noindex`; ainda assim, não divulgue a URL.
- Conteúdo é de uso pessoal. Não redistribua.

## Notas

- `EXTENSION_STORES`/`EXTENSION_REPOS` no `docker-compose.yml` já apontam para o
  repo Keiyoushi. Fontes quebram de tempos em tempos (mudança de site/Cloudflare);
  atualizar a extensão na WebUI do Suwayomi resolve a maioria.
- Downloads ficam em `./suwayomi/downloads` como `.cbz` (um por capítulo), prontos
  para servir num Komga/Kavita no futuro, se quiser.
