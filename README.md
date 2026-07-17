# HorizonReader

A self-hosted manga reader for people who are tired of scan sites dying, rebranding,
drowning in ads, or losing your reading progress every other month. Host it yourself,
read on your phone, and do your own gatekeeping: there is no public sign-up — you
create accounts by hand for yourself and the friends you actually want around.

Under the hood, [Suwayomi-Server](https://github.com/Suwayomi/Suwayomi-Server) does
the heavy lifting (scraping sources through Mihon/Tachiyomi extensions and downloading
chapters), while a Next.js app in front gives you a fast mobile-first reader with its
own login, per-user library, and reading progress.

## What you get

- **Mobile-first reader** with per-user library, favorites, reading progress, and
  public profiles for your friend group.
- **Multiple sources per title**, ranked by health (chapter count + recency), so when
  one scan site breaks you just tap the next one.
- **English + Brazilian Portuguese** sources out of the box (Keiyoushi extension repo,
  plus a few native pt-BR scrapers), with MangaDex/Comick powering search, covers,
  ratings, and metadata.
- **Content filter built in**: pornographic works (hentai/erotica/smut) and BL/GL
  titles are excluded from every discovery surface.
- **Your own gatekeeping**: no sign-up page, no "forgot password". Accounts are
  created by CLI, period.
- **Privacy by design**: the browser only ever talks to the app. Covers and pages are
  proxied server-side; Suwayomi is never exposed.
- **xlsx export** of your reading list, if you ever want out.

## Architecture

```
browser ──► Next.js app (login, reader, proxy) ──► Suwayomi (internal) ──► scan sources
                  │                                     │
              SQLite (users,                       FlareSolverr
              follows, progress)                   (Cloudflare, opt-in)
```

## Run it (Docker)

Prerequisite: Docker.

```bash
cp .env.example .env
# generate a secret and put it in AUTH_SECRET inside .env:
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

docker compose up -d --build
```

The app comes up at `http://localhost:3000`. Suwayomi runs internally, with its admin
WebUI reachable only at `http://localhost:4567` (for installing extensions and adding
sources the first time).

### First use

1. Open `http://localhost:4567` (Suwayomi WebUI) and, under **Browse → Extensions**,
   install the extensions for the sources you want (the Keiyoushi repo is already
   configured). Add at least one source.
2. Create your account:
   ```bash
   docker compose exec web npm run user -- add YOUR_USER YOUR_PASSWORD --admin
   ```
3. Open `http://localhost:3000`, log in, start reading.

## Managing accounts

```bash
docker compose exec web npm run user -- add    <user> <password> [--admin]
docker compose exec web npm run user -- passwd <user> <newPassword>
docker compose exec web npm run user -- remove <user>
docker compose exec web npm run user -- list
```

(In dev, without Docker, it is just `npm run user -- ...`.)

## Development

Run only the engine in Docker and the app on the host:

```bash
docker compose up -d suwayomi   # engine at localhost:4567
npm install
npm run db:push                 # creates prisma/dev.db
npm run user -- add me 123456 --admin
npm run dev                     # http://localhost:3000
```

Where things live:

- **UI/UX**: `src/app/(app)/**` (pages) and `src/components/**`. Theme in
  `src/app/globals.css` and `tailwind.config.ts`.
- **Reader**: `src/app/reader/[chapterId]/**`.
- **Suwayomi integration** (GraphQL): `src/lib/suwayomi.ts`.
- **Native scrapers**: `src/lib/scrapers/**`. **Metadata backbone**
  (MangaDex/Comick): `src/lib/backbone/**`.
- **Auth**: `src/lib/jwt.ts`, `src/middleware.ts`, `src/app/login/**`.
- **Database** (users, favorites, progress): `prisma/schema.prisma`.

## Security notes

- Best kept off the open internet: access it through Tailscale/WireGuard, or put it
  behind a reverse proxy / Cloudflare Tunnel with HTTPS (`COOKIE_SECURE=true`).
- `robots` is `noindex`; still, do not hand out the URL.
- FlareSolverr (for Cloudflare-protected sources) is opt-in and heavy:
  `FLARESOLVERR_ENABLED=true` + `docker compose --profile flaresolverr up -d`.

## Credits

This project stands on the shoulders of:

- [Suwayomi-Server](https://github.com/Suwayomi/Suwayomi-Server) — the scraping and
  download engine.
- [Keiyoushi extensions](https://github.com/keiyoushi/extensions) — hundreds of
  sources across languages, from the Mihon/Tachiyomi ecosystem.
- [MangaDex](https://api.mangadex.org/docs/) and [Comick](https://comick.io) — metadata,
  search, covers, and ratings.
- [FlareSolverr](https://github.com/FlareSolverr/FlareSolverr) — Cloudflare challenge
  solving for stubborn sources.

## Disclaimer

HorizonReader hosts no content. It aggregates publicly available sources for personal
use, same as any Mihon/Tachiyomi setup. Support official releases when you can, and
don't redistribute what you download.
