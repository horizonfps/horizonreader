---
id: T-019
title: Ler capítulo baixado direto do servidor, sem consultar a fonte
status: ready
blockedBy: [T-016]
files: [src/app/reader/[chapterId]/page.tsx, src/app/api/image/route.ts, src/components/Reader.tsx]
---

## O que fazer

Abrir um capítulo já baixado passa a ser uma conversa só com o servidor: nem a lista de páginas nem as imagens saem para o site da fonte, que é onde aparecem os bloqueios e captchas. O leitor mostra uma etiqueta `Baixado` na barra de cima quando está lendo desse jeito.

## Onde mexer

O T-016 já grava, para cada capítulo baixado, uma linha `ChapterDownload` com `status`, `mangaId` e `pages` (JSON com a lista de URLs de página no formato `/api/image?...`), e guarda os arquivos no tier de disco `download`.

### `src/app/api/image/route.ts`

Hoje a ordem é: memória → disco do tier (`page` ou `cover`) → origem. Para páginas (`isPage`), consulte o tier `download` antes do tier `page`; achando lá, responde com o mesmo cabeçalho imutável e alimenta o cache de memória, exatamente como o caminho do disco já faz. Se o arquivo não estiver no tier `download`, siga o fluxo atual (nada pode quebrar quando a linha existe mas o arquivo sumiu).

Acrescente em toda resposta 200 o cabeçalho `x-hr-cache`, com um destes valores: `download`, `memory`, `disk` ou `upstream`. É por ele que dá para provar que a imagem não foi buscada na fonte.

### `src/app/reader/[chapterId]/page.tsx`

Antes de escolher entre `loadNative` e `loadSuwayomi`, busque `prisma.chapterDownload.findUnique({ where: { chapterId } })`. Considere o capítulo baixado quando `status === "DONE"` e `pages` faz `JSON.parse` em um array não vazio de strings.

- Capítulo nativo (`isNativeChapterId`): passe as URLs guardadas para `loadNative`, que deixa de chamar `scraper.pages(row.chapterKey)` e usa a lista recebida. O resto (linha do `ScrapedChapter`, irmãos para anterior/próximo, título) já vem do banco local e continua igual.
- Capítulo do Suwayomi: passe as URLs e o `mangaId` da linha para `loadSuwayomi`, que deixa de chamar `fetchChapterPages` — é essa chamada que dispara a busca na fonte. `getChapters(mangaId)` continua sendo usado para título e anterior/próximo, porque lê o banco do próprio motor. Quando a linha não tiver `mangaId` maior que zero, ignore o atalho e siga o caminho normal.

Passe `downloaded` (booleano) para `<Reader>`.

### `src/components/Reader.tsx`

Some `downloaded?: boolean` ao tipo `Props` e ao destructuring. Na barra superior do overlay (bloco `showUI`, onde já ficam o `‹`, o título e o botão `Ajustes`), renderize, quando `downloaded` for verdadeiro, uma etiqueta curta `Baixado` depois do título: `<span className="shrink-0 rounded bg-white/15 px-1.5 py-0.5 text-[10px]">Baixado</span>`. Nada mais do leitor muda.

## Fora do escopo

- Leitura offline no navegador (sem rede entre o aparelho e o servidor) — o service worker continua como está.
- Enfileirar, remover ou listar downloads (T-016, T-017 e T-018).
- Mudar o cache de capas ou a limpeza por tamanho do cache de páginas.
- Trocar a fonte automaticamente quando só uma delas tem o capítulo baixado.

## Pronto quando

- [ ] Abrir um capítulo com download concluído mostra as páginas normalmente e a etiqueta `Baixado` aparece na barra de cima do leitor.
- [ ] Nesse capítulo, as respostas de imagem (`/api/image?...`) trazem o cabeçalho `x-hr-cache: download`.
- [ ] Abrir um capítulo que não foi baixado continua funcionando igual, e as respostas de imagem trazem `x-hr-cache` com `memory`, `disk` ou `upstream`.
- [ ] Num capítulo baixado do Suwayomi, a página do leitor não chama a busca de páginas do motor (`fetchChapterPages`), e ainda assim mostra título e os links de capítulo anterior/próximo.
- [ ] Num capítulo nativo baixado, a raspagem de páginas não é chamada.
- [ ] Se a linha diz baixado mas um arquivo de página não existe mais no disco, a imagem ainda carrega pelo caminho normal, sem página quebrada.
- [ ] Capítulo não baixado não mostra a etiqueta `Baixado`.
- [ ] `npm run build` passa.

## Como testar (humano)

1. Rode `npm run dev -- -p 3100`, abra `http://localhost:3100` e entre com sua conta.
2. Abra uma obra, clique em um capítulo e copie o número do fim do endereço (`/reader/<número>`).
3. Abra o console do navegador (F12, aba `Console`), cole a linha abaixo trocando `SEU_NUMERO` e aperte Enter:
   `fetch('/api/download',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chapters:[{chapterId:SEU_NUMERO}]})}).then(r=>r.json()).then(console.log)`
4. Espere o download terminar: abra `http://localhost:3100/api/download` e recarregue até o capítulo aparecer com `"status":"DONE"`.
5. Volte para `http://localhost:3100/reader/SEU_NUMERO` e clique uma vez no meio da tela para aparecerem as barras. Ao lado do nome do capítulo deve aparecer a etiqueta `Baixado`.
6. Ainda no leitor, abra o console (F12), vá na aba `Network`/`Rede`, recarregue a página e clique em uma das linhas `image?path=...` ou `image?url=...`. Nos cabeçalhos da resposta deve constar `x-hr-cache: download`.
7. Abra outro capítulo da mesma obra que você não baixou: ele deve carregar normalmente e não mostrar a etiqueta `Baixado`.
