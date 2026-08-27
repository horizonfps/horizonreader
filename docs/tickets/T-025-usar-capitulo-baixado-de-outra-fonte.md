---
id: T-025
title: Abrir o capítulo baixado em outra fonte quando a fonte aberta não tem
status: ready
blockedBy: []
files: [src/app/(app)/work/[slug]/page.tsx]
---

## O que fazer

Uma obra costuma ter várias fontes, e cada fonte numera os mesmos capítulos com
ids diferentes. Hoje, se você baixou o capítulo 1 pela fonte A e depois abre a
obra na fonte B, o app age como se nada estivesse baixado: a linha aparece sem
marca e clicar nela vai buscar tudo de novo no site — exatamente o caso em que a
fonte pede captcha e a leitura trava.

Passa a valer: **quando a fonte aberta não tem aquele capítulo baixado, mas
outra fonte da mesma obra tem, o app usa o baixado**. Na lista de capítulos, a
linha ganha a etiqueta `Baixado em outra fonte`, o botão de baixar dela mostra
`Baixado` (desabilitado, para não baixar duas vezes) e clicar na linha abre o
capítulo que está no disco. O botão de continuar leitura no topo faz o mesmo.

Além disso, ao abrir a obra sem escolher fonte, e sem nada em andamento na
leitura, o app já abre na fonte que tem mais capítulos baixados.

## Onde mexer

Tudo dentro de `SourcesAndChapters`, em `src/app/(app)/work/[slug]/page.tsx`.

### 1. Carregar os downloads da obra antes de escolher a fonte

Hoje o arquivo consulta `prisma.chapterDownload` só depois de montar `visible`,
filtrando pelos ids visíveis (`downloadRows` / `downloadStatusByChapter`).
Troque essa consulta por uma que traga os downloads da obra inteira, e coloque-a
**antes** da linha que calcula `const selected = …`:

```ts
const workDownloads = await prisma.chapterDownload
  .findMany({
    where: { workId },
    select: { chapterId: true, chapterNumber: true, mangaId: true, status: true },
  })
  .catch(() => []);
```

A partir dela monte:

- `downloadStatusByChapter: Map<number, DownloadStatus>` — `chapterId` → `status`
  (é o mesmo mapa que o `DownloadButton` de cada linha já usa em
  `initialStatus`; só que agora cobre a obra toda, o que é inofensivo).
- `downloadedByNumber: Map<number, number>` — só linhas com `status === "DONE"`
  e `chapterNumber > 0`, mapeando `chapterNumber` → `chapterId`. Quando duas
  fontes tiverem o mesmo número baixado, vence a que casa com
  `selected.sourceMangaId`; como `selected` ainda não existe nesse ponto, monte
  o mapa guardando todas as candidatas por número e resolva a preferência
  depois de `selected` estar definido.
- `doneByMangaId: Map<number, number>` — quantas linhas `DONE` cada `mangaId`
  tem.

### 2. Escolher a fonte

A linha atual é:

```ts
const selected = links.find((l) => l.id === selectedId) ?? selectedFromProgress ?? links[0] ?? null;
```

Entre `selectedFromProgress` e `links[0]`, entre a fonte mais baixada: o link
com maior `doneByMangaId.get(link.sourceMangaId)` (ignorando zero). Empate
resolve pela ordem em que os links já vêm. Nada muda quando existe `?src=` na
URL ou quando a leitura em andamento já escolheu uma fonte.

### 3. Lista de capítulos

Para cada `c` de `visible`, dentro do `map` que já existe:

```ts
const ownStatus = downloadStatusByChapter.get(c.id) ?? null;
const mirroredId = ownStatus === "DONE" ? null : downloadedByNumber.get(c.chapterNumber) ?? null;
const status = ownStatus ?? (mirroredId ? "DONE" : null);
```

- O `<Link>` da linha aponta para `/reader/${mirroredId ?? c.id}`.
- Quando `mirroredId` existir, mostre ao lado da data (o `<p>` de
  `fmtDate(c.uploadDate)`) uma etiqueta
  `<span className="shrink-0 rounded bg-elevated px-1.5 py-0.5 text-[10px] text-muted">Baixado em outra fonte</span>`.
  Se não houver data, a etiqueta aparece sozinha na linha de baixo.
- O `DownloadButton` da linha recebe `initialStatus={status}` (ele já mostra
  `Baixado` e fica desabilitado quando o status é `DONE`).

### 4. Botão de continuar leitura

`startId` hoje é `resume?.chapterId ?? null`. Quando o capítulo de retomada não
estiver baixado nessa fonte mas `downloadedByNumber` tiver o número dele, use o
id baixado no `href` do botão. O rótulo (`startLabel`) não muda.

O `DownloadButton` de `Baixar 5 próximos` continua exatamente como está.

## Fora do escopo

- Trocar de fonte dentro do leitor (o próximo/anterior continua andando dentro
  da fonte do capítulo aberto).
- Casar capítulos por nome ou por data: o casamento é só por número de capítulo,
  e capítulo com número zero/desconhecido nunca casa.
- Baixar automaticamente o capítulo faltante na fonte aberta.
- Mexer na fila de download, na API ou na tela `Downloads`.

## Pronto quando

- [ ] `npm run build` passa.
- [ ] Com um capítulo de número N baixado (`Concluído`) pela fonte A, abrir a
      obra na fonte B mostra na linha do capítulo N a etiqueta
      `Baixado em outra fonte`.
- [ ] Nessa mesma linha, o botão de baixar aparece como `Baixado` e não pode ser
      clicado.
- [ ] Clicar nessa linha abre o leitor mostrando a etiqueta `Baixado` na barra
      de cima (ou seja, abriu o capítulo que está no disco, não o da fonte B).
- [ ] Capítulos sem nada baixado continuam abrindo o capítulo da fonte aberta e
      com o botão `Baixar` normal.
- [ ] Abrir a obra sem `?src` na URL, sem leitura em andamento e com downloads
      de uma fonte só seleciona essa fonte.
- [ ] Com o mesmo capítulo baixado na própria fonte aberta, a etiqueta
      `Baixado em outra fonte` **não** aparece (o botão continua mostrando
      `Baixado`).

## Como testar (humano)

1. No terminal rode `npm run dev -- -p 3100`, abra `http://localhost:3100` e
   entre com sua conta. (Se precisar de uma conta:
   `npm run user -- add qaburro burro12345`; se disser que já existe, use
   `npm run user -- passwd qaburro burro12345`.)
2. Abra `http://localhost:3100/work/solo-leveling-3w0wvo`. Em cima da lista de
   capítulos há uma fileira de fontes; anote qual está destacada.
3. Clique em outra fonte da fileira que também mostre uma quantidade grande de
   capítulos e espere a lista recarregar.
4. Role a lista até o fim e ache o capítulo de número 1. Clique no botão
   `Baixar` da linha dele.
5. Abra `http://localhost:3100/downloads` e espere esse capítulo ficar
   `Concluído` (recarregue de vez em quando).
6. Volte para `http://localhost:3100/work/solo-leveling-3w0wvo` e clique na
   **primeira** fonte (a que estava destacada no passo 2).
7. Role até o capítulo de número 1 dessa fonte. Ele tem que mostrar a etiqueta
   `Baixado em outra fonte`, e o botão do lado tem que estar escrito `Baixado` e
   desabilitado.
8. Clique nesse capítulo. No leitor, clique uma vez no meio da tela: na barra de
   cima tem que aparecer a etiqueta `Baixado`.
9. Volte para a obra e abra um capítulo qualquer que você não baixou: ele não
   pode ter a etiqueta `Baixado em outra fonte`, e o botão do lado dele continua
   escrito `Baixar`.
