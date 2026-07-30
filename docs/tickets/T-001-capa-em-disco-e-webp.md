---
id: T-001
title: Guardar capa em disco e reencodar para WebP no tamanho do card
status: ready
blockedBy: []
files: [src/lib/diskCache.ts, src/lib/coverImage.ts, src/app/api/cover/route.ts, src/app/api/image/route.ts, next.config.mjs, package.json, package-lock.json, Dockerfile]
---

## O que fazer

Hoje toda capa que o site mostra vive só na memória do processo. Reiniciar o app
joga fora 100% das capas e a home volta a baixar tudo de novo do MangaDex e do
Comick. Além disso a capa do Comick vem no tamanho original (medido: 317 KB por
capa), quando o card na tela tem menos de 200 px de largura.

Depois deste ticket a capa passa a ser gravada em disco, numa pasta própria com
teto próprio (separada da pasta que já guarda página de capítulo, para que uma
não expulse a outra), e é reencodada para WebP no tamanho do card antes de ser
guardada. Efeito visível: reiniciar o app e abrir a home mostra as capas
imediatamente, sem o segundo de cinza; e rolar a home inteira baixa uma fração
dos bytes de hoje.

## Onde mexer

**`package.json`** (li inteiro): acrescente `sharp` em `dependencies`. Instale de
verdade (`npm install sharp`) para o `package-lock.json` ser atualizado junto.
Não mexa em nenhuma outra dependência.

**`Dockerfile`** (li inteiro): a imagem base é `node:22-slim` (Debian bookworm),
onde o binário pré-compilado do sharp funciona sem pacote de sistema extra. O
problema real é outro: o lockfile é gerado no Windows e carrega só o binário
win32, e o npm às vezes não resolve o binário de linux sozinho. Logo depois da
linha `RUN npm install --include=dev --no-audit --no-fund` acrescente:

```
# Windows lockfile carries only the win32 sharp binary; force the linux one.
RUN npm install --no-audit --no-fund --os=linux --libc=glibc --cpu=x64 sharp
```

**`next.config.mjs`** (li inteiro): acrescente `serverExternalPackages: ["sharp"]`
no objeto de configuração (chave estável no Next 15, fora de `experimental`).
Sem isso o bundler tenta empacotar o binário nativo.

**`src/lib/coverImage.ts`** (arquivo novo): exporta
`shrinkCover(body: Uint8Array, contentType: string): Promise<{ body: Uint8Array; contentType: string }>`.

- Carregue o sharp por `await import("sharp")` guardado numa promise de módulo,
  para que uma instalação quebrada nunca derrube a rota no import.
- Só reencoda quando `contentType` começa com `image/` e não é `image/gif`
  (GIF animado perderia a animação). Qualquer outro caso devolve a entrada
  intacta.
- Transformação: `.resize({ width: 360, withoutEnlargement: true }).webp({ quality: 72 })`.
  `withoutEnlargement` é obrigatório: a capa do MangaDex já chega como
  `.256.jpg` e não pode ser esticada.
- Qualquer erro (sharp ausente, imagem corrompida) devolve a entrada intacta.
  Nunca lance.

**`src/lib/diskCache.ts`** (li inteiro, 88 linhas): hoje o arquivo tem uma pasta
só, um teto só, e o estado do sweep (`ready`, `lastSweep`, `sweeping`) em
variáveis de módulo. Passe a ter dois tiers:

- `type Tier = "page" | "cover"`.
- Tier `page`: pasta `IMAGE_CACHE_DIR` e teto `IMAGE_CACHE_DISK_MB` (defaults de
  hoje, 8192 MB), sem prazo de validade — página de capítulo é imutável.
- Tier `cover`: pasta `COVER_CACHE_DIR || (existsSync("/data") ? "/data/covercache" : ".cache/covers")`,
  teto `COVER_CACHE_DISK_MB` com default 1024, e validade de 7 dias na leitura
  (uma fonte pode trocar a capa). Entrada mais velha que isso conta como miss.
- `getDiskImage(key, tier)` e `setDiskImage(key, body, contentType, tier)` passam
  a receber o tier. Todo estado de sweep (`ready`, `lastSweep`, `sweeping`) vira
  por tier — se continuar global, o segundo tier nunca é varrido.
- Mantenha o que já funciona: escrita em nome temporário + `rename`, arquivo
  `.ct` ao lado com o content-type, sweep por idade jogado fora do caminho da
  requisição, e erro engolido (cache é best-effort).

**`src/app/api/cover/route.ts`** (li inteiro, 80 linhas):

- A chave de cache passa a ser `` `cover:v1:${target.toString()}` `` (memória e
  disco). O prefixo com versão evita servir bytes antigos, no formato antigo,
  depois deste ticket.
- Ordem: memória → disco (tier `cover`) → upstream. Um acerto no disco preenche
  a memória antes de responder, como já é feito em `/api/image`.
- Depois de um 200 do upstream, passe o corpo por `shrinkCover` e guarde o
  resultado (corpo e content-type) nos dois tiers. Responda o corpo reencodado.
- `CACHE_CONTROL` e a lista de hosts permitidos ficam como estão.

**`src/app/api/image/route.ts`** (li inteiro, 122 linhas): a variável `isPage`
(`!!ext || path.includes("/chapter/")`) já separa página de capítulo de
thumbnail do Suwayomi. O ramo que sobra (`!isPage`) é a capa e hoje é só
memória.

- Para thumbnail: chave `` `cover:v1:${target}` ``, disco no tier `cover`,
  reencode por `shrinkCover` antes de guardar, e o header continua sendo
  `REVALIDATE` (a fonte pode trocar a capa).
- Para página de capítulo: nada muda. Continua no tier `page`, sem reencode
  (recomprimir página de mangá degrada texto) e com header `IMMUTABLE`.

## Fora do escopo

- Reencodar página de capítulo. Só capa.
- Mostrar a pasta nova no painel `/info` (`src/lib/metrics/services.ts` continua
  medindo só `IMAGE_CACHE_DIR`).
- Declarar `COVER_CACHE_DIR`/`COVER_CACHE_DISK_MB` no `docker-compose.yml` ou no
  `.env.example`. Os defaults no código já apontam para o volume `/data`
  montado; os arquivos de infra são de outro ticket desta mesma rodada.
- Usar o otimizador de imagem do Next. As imagens seguem passando pelas rotas
  próprias, de propósito.
- Cache no navegador / service worker: é da próxima rodada.

## Pronto quando

- [ ] `sharp` está em `dependencies` do `package.json` e o `package-lock.json` foi
      atualizado pelo instalador.
- [ ] `next.config.mjs` tem `serverExternalPackages: ["sharp"]`.
- [ ] `Dockerfile` tem a linha extra que instala o binário linux do sharp.
- [ ] `diskCache.ts` expõe os dois tiers com pasta, teto e estado de sweep
      independentes; o tier `cover` ignora arquivo com mais de 7 dias.
- [ ] `shrinkCover` devolve a imagem original, sem lançar, quando o sharp não
      carrega ou o content-type não é `image/*`.
- [ ] Abrir `/api/cover?u=<capa do Comick>` responde `content-type: image/webp`
      com menos bytes que a imagem original da mesma URL.
- [ ] Depois de uma primeira visita, existem arquivos na pasta de capas
      (`.cache/covers` fora do Docker, `/data/covercache` dentro).
- [ ] `npm run build` passa.

## Como testar (humano)

1. Suba o app do jeito de sempre (`docker compose up -d --build`) e abra o site.
2. Abra a home e role até o fim da lista de baixo, para carregar bastante capa.
3. Abra a pasta `data` dentro da pasta do projeto: tem que ter aparecido uma
   pasta nova de capas, com muitos arquivos dentro.
4. Reinicie o app (`docker compose restart web`), espere subir e abra a home de
   novo. As capas têm que aparecer de imediato, sem o quadrado cinza piscando
   antes.
5. Confira que as capas continuam nítidas e no lugar certo, sem imagem esticada
   ou borrada.
