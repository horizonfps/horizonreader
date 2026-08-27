---
id: T-023
title: Mostrar os downloads do app no painel /info
status: ready
blockedBy: []
files: [src/lib/metrics/services.ts, src/components/info/ServicesPanel.tsx]
---

## O que fazer

O painel de infra (`/info`, só para administrador) hoje mostra o banco SQLite, o
cache de imagens e a pasta de downloads do Suwayomi — mas não sabe nada dos
capítulos que o próprio app baixa desde o T-016, que é justamente o que enche o
disco agora.

Passa a existir no painel um cartão **Downloads do app** com: quantos capítulos
estão prontos, quantos estão na fila, quantos estão baixando e quantos deram
erro; quanto espaço a pasta ocupa e quantos arquivos tem; quanto ainda há livre
no disco onde ela está, com uma barra de uso; e o caminho da pasta. O cartão de
armazenamento que já existe deixa de chamar a pasta do Suwayomi só de
`Downloads`, para não confundir as duas coisas.

## Onde mexer

### `src/lib/metrics/services.ts`

O arquivo já tem `dirStats(dir)` (varre a pasta e devolve `exists`, `files`,
`bytes`, `truncated`), o memo `cached(key, ttlMs, load)` e a função
`storageStats()`, que hoje devolve `database`, `imageCache` e `downloads` (essa
última é a pasta do Suwayomi, vinda de `DOWNLOADS_DIR`, e continua como está).

Acrescente um bloco novo em `storageStats()`, chamado `appDownloads`:

- A pasta vem de `tierDir("download")`, importado de `@/lib/diskCache` (o tier
  `download` já existe lá e respeita `CHAPTER_DOWNLOAD_DIR`). Não edite
  `src/lib/diskCache.ts`.
- Tamanho e contagem de arquivos: `cached("appdownloads", 60_000, () => dirStats(dir))`.
- Espaço do disco: `statfs(dir)` de `node:fs/promises` (já importado neste
  arquivo? não — importe junto de `readdir`/`stat`), com
  `diskTotal = blocks * bsize`, `diskFree = bavail * bsize`. Se o `statfs`
  falhar, os dois viram `0`.
- Contagens do banco, com `prisma` (já importado):
  `prisma.chapterDownload.count({ where: { status: "DONE" } })` e o mesmo para
  `QUEUED`, `RUNNING` e `ERROR`, mais
  `prisma.chapterDownload.aggregate({ _sum: { bytes: true } })` para o total
  gravado. Qualquer falha de consulta cai em zero (`.catch(() => …)`), no mesmo
  espírito defensivo do resto do arquivo.

Formato do bloco:

```ts
appDownloads: {
  dir: string; exists: boolean; files: number; bytes: number;
  done: number; queued: number; running: number; failed: number;
  storedBytes: number; diskTotal: number; diskFree: number;
}
```

O tipo `ServicesSnapshot` é inferido de `readServices()`, então o campo novo
aparece sozinho no cliente.

### `src/components/info/ServicesPanel.tsx`

- No cartão `Armazenamento`, troque o rótulo do `Stat` da pasta do Suwayomi de
  `Downloads` para `Pasta do Suwayomi` (o valor e o `sub` continuam iguais).
- Acrescente um cartão novo `Downloads do app`, no mesmo padrão dos outros
  (`<Card title="Downloads do app">`, `Stat`, `Bar`, `bytes`, `count`,
  `toneFor`, tudo já importado de `./ui`):
  - Linha de `Stat`: `Prontos` (`done`), `Na fila` (`queued`), `Baixando`
    (`running`), `Com erro` (`failed`, com `tone="bad"` quando maior que zero).
  - `Stat` `Espaço ocupado` com `bytes(appDownloads.bytes)` e `sub`
    `<count(files)> arquivos`.
  - `Stat` `Livre no disco` com `bytes(diskFree)`.
  - Uma `Bar` com a porcentagem `(diskTotal - diskFree) / diskTotal * 100`
    (0 quando `diskTotal` for 0), com `toneFor(percent, 75, 90)`.
  - Uma linha final `text-[11px] text-muted` com o caminho (`appDownloads.dir`)
    e, quando `exists` for falso, o texto `pasta ainda não criada`.

## Fora do escopo

- Botão para apagar downloads a partir do `/info`: a tela `Downloads` continua
  sendo o lugar de remover.
- Mostrar as regras de cota/horário do T-022 no `/info`.
- Mexer nos cartões de CPU, memória, containers, solvers ou logs.
- Mudar a pasta do Suwayomi (`DOWNLOADS_DIR`) ou o cache de imagens.

## Pronto quando

- [ ] `npm run build` passa.
- [ ] `/info`, aberto por um administrador, mostra um cartão
      `Downloads do app` com os quatro números (prontos, na fila, baixando, com
      erro), o espaço ocupado, o espaço livre e o caminho da pasta.
- [ ] Com a tabela de downloads vazia, o cartão aparece com zeros em vez de
      sumir ou quebrar a página.
- [ ] Depois de pedir o download de um capítulo, o número de `Na fila`,
      `Baixando` ou `Prontos` do cartão muda ao atualizar o painel.
- [ ] No cartão `Armazenamento`, o quadro da pasta do Suwayomi agora se chama
      `Pasta do Suwayomi`.
- [ ] `GET /api/info/services` responde um JSON contendo `storage.appDownloads`
      com os campos `dir`, `files`, `bytes`, `done`, `queued`, `running`,
      `failed`, `diskTotal` e `diskFree`.

## Como testar (humano)

1. No terminal rode `npm run dev -- -p 3100`. O painel só abre para
   administrador, então crie uma conta assim:
   `npm run user -- add qaadmin burro12345 --admin` (se disser que já existe,
   rode `npm run user -- passwd qaadmin burro12345`).
2. Abra `http://localhost:3100`, entre com o usuário `qaadmin` e a senha
   `burro12345`.
3. Abra `http://localhost:3100/info` e role a página até a área de
   armazenamento.
4. Deve existir um cartão chamado `Downloads do app` mostrando quantos capítulos
   estão prontos, na fila, baixando e com erro, quanto espaço ocupam, quanto
   está livre no disco e o caminho da pasta.
5. No mesmo painel, o quadro que mostra a pasta do Suwayomi deve estar escrito
   `Pasta do Suwayomi`.
6. Abra `http://localhost:3100/work/solo-leveling-3w0wvo`, clique no botão
   `Baixar` de um capítulo e volte para `http://localhost:3100/info`. Clique em
   `atualizar` no topo do painel: o cartão `Downloads do app` tem que refletir o
   capítulo novo (o número de `Na fila`, `Baixando` ou `Prontos` sobe).
