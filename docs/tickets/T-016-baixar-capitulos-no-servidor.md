---
id: T-016
title: Baixar capítulos inteiros para o disco do servidor com fila e API
status: ready
blockedBy: []
files: [prisma/schema.prisma, src/lib/diskCache.ts, src/lib/downloads.ts, src/app/api/download/route.ts, src/instrumentation.ts]
---

## O que fazer

O servidor passa a guardar capítulos inteiros no próprio disco. Pedido um capítulo, uma fila em segundo plano baixa todas as páginas dele para uma pasta que nunca é limpa automaticamente, guarda quantas páginas e quantos bytes ficaram gravados, e continua de onde parou se o servidor for reiniciado no meio.

Este ticket entrega o motor e a API; a tela de downloads (T-017) e os botões na página da obra (T-018) consomem exatamente o contrato descrito aqui.

Hoje `POST /api/download` só repassa os ids para o Suwayomi (`enqueueDownload`), o que não funciona para as fontes raspadas nativamente e não guarda nada no app. Esse repasse sai.

## Onde mexer

### `prisma/schema.prisma`

Novo modelo, no mesmo estilo dos existentes (SQLite, sem migrations — o projeto usa `db:push`):

```prisma
// Chapters pinned to the server's own disk, so reading them never touches the
// scan source again.
model ChapterDownload {
  id            Int      @id @default(autoincrement())
  workId        Int?
  mangaId       Int      @default(0)
  chapterId     Int      @unique
  chapterName   String   @default("")
  chapterNumber Float    @default(0)
  status        String   @default("QUEUED") // QUEUED | RUNNING | DONE | ERROR
  pageCount     Int      @default(0)
  pagesDone     Int      @default(0)
  bytes         Int      @default(0)
  pages         String   @default("[]") // JSON array of proxied page urls
  error         String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  work          Work?    @relation(fields: [workId], references: [id], onDelete: SetNull)

  @@index([workId])
  @@index([status])
}
```

E, no modelo `Work`, a lista inversa `downloads ChapterDownload[]` junto das outras relações.

Depois de editar, rode `npm run db:push` (o `DATABASE_URL` local é `file:./dev.db`, ou seja `prisma/dev.db`) para a tabela existir no banco de desenvolvimento. `npm run build` já roda `prisma generate`.

### `src/lib/diskCache.ts`

O arquivo já tem dois tiers (`page` e `cover`) com varredura por tamanho. Acrescente um terceiro:

```ts
download: {
  dir: process.env.CHAPTER_DOWNLOAD_DIR || (existsSync("/data") ? "/data/downloads" : ".cache/downloads"),
  maxBytes: Infinity,
  maxAgeMs: null,
}
```

`CHAPTER_DOWNLOAD_DIR` é um nome novo de propósito: `DOWNLOADS_DIR` já é usado por `src/lib/metrics/services.ts` para a pasta do Suwayomi.

Ajuste `sweep` para retornar imediatamente quando `maxBytes === Infinity` — capítulo baixado não pode ser despejado por LRU. E exporte duas funções novas:

- `deleteDiskImage(key: string, tier: Tier): Promise<void>` — apaga o `.bin` e o `.ct` daquela chave, engolindo erro.
- `tierDir(tier: Tier): string` — devolve o diretório do tier, para quem precisa medir espaço.

### `src/lib/downloads.ts` (novo)

Módulo só de servidor com a fila. Ele reaproveita a resolução de páginas que já existe: `chapterPageUrls(chapterId, limit)` de `@/lib/readerPages` (chame com `Number.MAX_SAFE_INTEGER` para pegar o capítulo inteiro) devolve as URLs já no formato `/api/image?...` usado pelo leitor.

Para gravar no disco é preciso converter a URL proxiada de volta na URL de origem, que é a chave usada pelo cache de página. Copie a lógica que `src/lib/pageWarm.ts` já usa em `warmProxiedPage`: parâmetro `url` (só `https:` e host aprovado por `isAllowedImageHost` de `@/lib/scrapers`) vira o próprio alvo com `Referer` do host; parâmetro `path` casando com `^/api/v1/manga/\d+/(thumbnail|chapter/\d+/page/\d+)(\?.*)?$` vira `SUWAYOMI_URL + path`. Qualquer outra coisa é descartada. Exporte essa função como `originTargetFor(proxiedUrl: string): { target: string; referer?: string } | null`, porque a rota de imagem (T-019) e a remoção precisam da mesma conta.

Exportações:

- `queueChapterDownloads(items: { chapterId: number; mangaId?: number; workId?: number; name?: string; number?: number }[]): Promise<number>` — para cada item, cria a linha em `QUEUED` se não existir; se já existir com `ERROR`, volta para `QUEUED` zerando `pagesDone`, `bytes` e `error`; se já existir em `QUEUED`, `RUNNING` ou `DONE`, não faz nada. Devolve quantas linhas ficaram em `QUEUED`. No fim dispara `void runQueue()`.
- `runQueue(): Promise<void>` — protegida por um `let running = false` no módulo (uma execução por processo). Enquanto houver linha `QUEUED` (a mais antiga primeiro): marca `RUNNING`; resolve as URLs; grava `pages` (JSON) e `pageCount`; baixa página por página com no máximo 4 downloads simultâneos, cada um com até 3 tentativas (espera 250ms, 500ms) e `AbortSignal.timeout(20_000)`; guarda o corpo com `setDiskImage(target, body, contentType, "download")` e soma `bytes`; atualiza `pagesDone` no banco a cada 5 páginas e no fim. Página que já esteja no tier `page` (`getDiskImage(target, "page")`) é copiada para o tier `download` sem ir à rede. Termina em `DONE` quando todas as páginas foram gravadas; em `ERROR` com mensagem curta quando a lista vem vazia (`"sem páginas"`), quando alguma página falha depois das tentativas, ou quando o capítulo passa de 10 minutos (`"tempo esgotado"`). Antes de cada capítulo, releia a linha: se ela sumiu (removida pelo usuário), pule.
- `removeDownload(chapterId: number): Promise<boolean>` e `removeWorkDownloads(workId: number): Promise<number>` — apagam os arquivos de cada URL de `pages` via `originTargetFor` + `deleteDiskImage(target, "download")` e depois a linha.
- `downloadsSnapshot(): Promise<{ items: […]; storage: […] }>` — o payload do `GET` descrito abaixo. O espaço em disco vem de `statfs` (`node:fs/promises`, já usado em `src/lib/metrics/host.ts`) sobre o diretório do tier `download`, criando o diretório antes com `mkdir(dir, { recursive: true })` para o `statfs` não falhar em instalação nova: `diskTotal = blocks * bsize`, `diskFree = bavail * bsize`, `diskUsed = (blocks - bavail) * bsize`. `downloadsBytes` é a soma de `bytes` das linhas e `chapters` a contagem de linhas `DONE`.
- `startDownloadWorker(): void` — no boot, volta linhas `RUNNING` para `QUEUED` e chama `runQueue()`. Protegido por flag em `globalThis`, no mesmo padrão de `startPageWarm` em `src/lib/pageWarm.ts`.

Nada nesse módulo pode lançar para fora: falha vira `ERROR` na linha, não exceção no processo.

### `src/app/api/download/route.ts`

Reescreva a rota (mantendo `runtime = "nodejs"` e a checagem de sessão em todos os métodos).

`POST` aceita:

```json
{ "workId": 12, "mangaId": 345, "chapters": [{ "chapterId": 6789, "name": "Chapter 381", "number": 381 }] }
```

e também as formas antigas `{ "chapterId": 6789 }` e `{ "chapterIds": [1, 2] }` (sem metadados). Ids não inteiros são descartados; lista vazia responde `400 { "error": "no_ids" }`. Sucesso: `{ "ok": true, "queued": <n> }`. A chamada a `enqueueDownload` some daqui (a função pode continuar existindo em `src/lib/suwayomi.ts`).

`GET` responde:

```json
{
  "items": [
    {
      "chapterId": 6789, "workId": 12, "workTitle": "Kingdom", "workSlug": "kingdom",
      "chapterName": "Chapter 381", "chapterNumber": 381, "status": "DONE",
      "pageCount": 18, "pagesDone": 18, "bytes": 5242880, "error": null,
      "updatedAt": "2026-08-26T12:00:00.000Z"
    }
  ],
  "storage": {
    "path": "/data/downloads", "downloadsBytes": 5242880, "chapters": 1,
    "diskTotal": 500107862016, "diskFree": 213000000000, "diskUsed": 287107862016
  }
}
```

Ordem: `updatedAt` desc, no máximo 500 linhas. `workTitle`/`workSlug` vêm da relação `work` (nulos quando não houver).

`DELETE` aceita `?chapterId=<n>` ou `?workId=<n>` e responde `{ "ok": true, "removed": <n> }`; sem parâmetro válido, `400 { "error": "no_ids" }`.

### `src/instrumentation.ts`

Junto de `startFavoritesRefresh()` e `startPageWarm()`, importe e chame `startDownloadWorker()`.

## Fora do escopo

- Qualquer tela: os botões da página da obra são o T-018 e a seção de downloads é o T-017.
- Servir a leitura a partir do que foi baixado (rota de imagem e leitor) — é o T-019.
- Limite de espaço, cota por usuário ou limpeza automática de downloads antigos.
- Baixar obra inteira de uma vez ou agendar downloads.
- Mexer no cache de imagens existente (tiers `page` e `cover` continuam com o mesmo comportamento).

## Pronto quando

- [ ] `npm run db:push` cria a tabela `ChapterDownload` sem erro e `npm run build` passa.
- [ ] `POST /api/download` com `{ "chapters": [{ "chapterId": <id> }] }` responde `{ "ok": true, "queued": 1 }` e cria a linha correspondente.
- [ ] Pedir de novo o mesmo capítulo enquanto ele está `QUEUED`, `RUNNING` ou `DONE` responde `queued: 0` e não duplica a linha.
- [ ] `GET /api/download` devolve `items` e `storage`, com `diskTotal`, `diskFree` e `diskUsed` maiores que zero e `path` apontando para a pasta de downloads.
- [ ] Depois de um capítulo terminar, a linha fica `DONE` com `pagesDone === pageCount`, `bytes > 0` e a pasta de downloads contém os arquivos.
- [ ] Um capítulo que não consegue baixar termina em `ERROR` com mensagem, e nunca fica preso em `RUNNING` para sempre.
- [ ] `DELETE /api/download?chapterId=<id>` remove a linha e apaga os arquivos daquele capítulo; `?workId=<id>` faz o mesmo para todos os capítulos da obra.
- [ ] Reiniciar o servidor com uma linha em `RUNNING` volta ela para `QUEUED` e a fila recomeça sozinha.
- [ ] Capítulos baixados não são apagados pela limpeza por tamanho do cache de imagens.
- [ ] `POST /api/download`, `GET` e `DELETE` sem sessão respondem 401.

## Como testar (humano)

1. Rode `npm run db:push` e depois `npm run dev -- -p 3100`. Abra `http://localhost:3100` e entre com sua conta.
2. Abra `http://localhost:3100/api/download` na barra de endereço. Deve aparecer um texto JSON com `"items": []` e um bloco `"storage"` com números de espaço total, livre e usado do disco.
3. Abra uma obra, clique em um capítulo e copie o número que aparece no fim do endereço (`/reader/<número>`).
4. Ainda no navegador, abra o console do desenvolvedor (tecla F12, aba `Console`), cole a linha abaixo trocando `SEU_NUMERO` pelo número copiado e aperte Enter:
   `fetch('/api/download',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chapters:[{chapterId:SEU_NUMERO}]})}).then(r=>r.json()).then(console.log)`
   A resposta impressa deve ser `{ok: true, queued: 1}`.
5. Volte para `http://localhost:3100/api/download` e recarregue algumas vezes. O capítulo deve aparecer em `items`, com `status` passando por `QUEUED`/`RUNNING` e terminando em `DONE` (ou `ERROR` com uma mensagem, se a fonte estiver fora do ar). Enquanto baixa, `pagesDone` cresce.
6. Com o capítulo em `DONE`, no console cole `fetch('/api/download?chapterId=SEU_NUMERO',{method:'DELETE'}).then(r=>r.json()).then(console.log)` e recarregue `/api/download`: o capítulo deve sumir de `items` e `downloadsBytes` deve diminuir.
