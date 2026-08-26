---
id: T-017
title: Criar a seção Downloads com o espaço livre e gasto no disco
status: ready
blockedBy: [T-016]
files: [src/app/(app)/downloads/page.tsx, src/components/DownloadsPanel.tsx, src/components/BottomNav.tsx]
---

## O que fazer

Uma seção nova no menu de baixo, `Downloads`, mostra tudo que está guardado no servidor: quanto espaço os downloads ocupam, quanto ainda existe livre no disco, e a lista dos capítulos baixados, na fila, baixando ou com erro — cada um com o andamento (`12/18 páginas`), o tamanho e um botão para remover. Enquanto houver algo baixando, a lista se atualiza sozinha.

## Onde mexer

A API já existe (T-016) e é a única fonte de dados desta tela.

`GET /api/download` responde:

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

`DELETE /api/download?chapterId=<n>` remove um capítulo e `DELETE /api/download?workId=<n>` remove todos os capítulos de uma obra; ambos respondem `{ "ok": true, "removed": <n> }`.

### `src/app/(app)/downloads/page.tsx` (novo)

Página de servidor dentro do grupo `(app)`, então ela já herda a barra de cima e o menu de baixo do `src/app/(app)/layout.tsx`. Siga o padrão de `src/app/(app)/library/page.tsx`: `export const dynamic = "force-dynamic"`, `getSession()` e `return null` sem sessão. Renderiza um título `Downloads` e o componente cliente abaixo.

### `src/components/DownloadsPanel.tsx` (novo)

Componente `"use client"` usando `useSWR` (o pacote `swr` já é dependência; veja o uso em `src/components/info/InfoDashboard.tsx`) contra `/api/download`. Intervalo de atualização: 3000 ms enquanto existir algum item com status `QUEUED` ou `RUNNING`, 20000 ms caso contrário, sempre com `keepPreviousData: true`.

Para formatar tamanhos, importe `bytes` e `pct` de `@/components/info/ui` (módulo cliente já existente com esses formatadores).

Blocos da tela:

1. **Cartão de espaço**: uma barra horizontal preenchida com a porcentagem `diskUsed / diskTotal`, e três números legíveis: `Downloads ocupam <bytes(downloadsBytes)>` (com `<chapters> capítulo(s)`), `<bytes(diskFree)> livres` e `de <bytes(diskTotal)>`. A cor da barra segue o padrão do projeto (`bg-accent`), sobre `bg-elevated`.
2. **Lista agrupada por obra**: agrupe `items` por `workId` (itens sem obra caem num grupo `Sem obra`), ordenando os grupos pelo `updatedAt` mais recente e os capítulos de cada grupo por `chapterNumber` crescente. Cabeçalho do grupo: título da obra (link para `/work/<workSlug>` quando houver slug), quantidade de capítulos e um botão `Remover todos` que chama o `DELETE` com `workId` e revalida.
3. **Linha de capítulo**: nome do capítulo (ou `Cap. <chapterNumber>` quando o nome vier vazio), uma etiqueta de status em português — `Na fila`, `Baixando`, `Concluído`, `Erro` —, o andamento `pagesDone/pageCount páginas` para quem está baixando, o tamanho em bytes para quem terminou, a mensagem de `error` quando houver, um link `Abrir` para `/reader/<chapterId>` nos concluídos e um botão `Remover` que chama o `DELETE` com `chapterId` e revalida.
4. **Estado vazio**: sem nenhum item, mostre `Nenhum capítulo baixado ainda.` com um link para `/library`.

Enquanto o primeiro carregamento não volta, mostre um bloco `animate-pulse` no lugar da lista, como as outras telas do projeto fazem.

### `src/components/BottomNav.tsx`

Adicione o item `{ href: "/downloads", label: "Downloads", Icon: Download }` (ícone `Download` de `lucide-react`) entre `Library` e `Profile`. A lista vira seis itens; o `flex-1` de cada `li` já divide o espaço.

## Fora do escopo

- Enfileirar downloads a partir desta tela (quem pede download é a página da obra, no T-018).
- Mostrar o cache de imagens, o banco ou a pasta do Suwayomi nesta tela (isso já vive em `/info`).
- Limite de espaço, limpeza automática ou aviso de disco cheio.
- Baixar para o celular/navegador: os arquivos ficam no servidor.

## Pronto quando

- [ ] O menu de baixo tem um item `Downloads` que abre `/downloads`.
- [ ] `/downloads` mostra um cartão com o espaço ocupado pelos downloads, o espaço livre e o total do disco, com valores legíveis (ex.: `12,3 GB`), e uma barra preenchida na proporção do disco usado.
- [ ] Com a fila vazia, a tela mostra `Nenhum capítulo baixado ainda.` e um link para a biblioteca.
- [ ] Cada capítulo listado mostra o nome, a etiqueta de status em português e, quando está baixando, o andamento em páginas.
- [ ] Um capítulo com erro mostra a etiqueta `Erro` e a mensagem devolvida pela API.
- [ ] O botão `Remover` de um capítulo o tira da lista sem recarregar a página, e ele não volta depois de um F5.
- [ ] O botão `Remover todos` de uma obra tira todos os capítulos dela da lista.
- [ ] Capítulos concluídos têm um link `Abrir` que leva ao leitor daquele capítulo.
- [ ] Com algum item em `Na fila` ou `Baixando`, a tela se atualiza sozinha a cada poucos segundos sem o usuário recarregar.
- [ ] `npm run build` passa.

## Como testar (humano)

1. Rode `npm run dev -- -p 3100`, abra `http://localhost:3100` e entre com sua conta.
2. Olhe o menu na parte de baixo da tela: deve existir um item novo chamado `Downloads`. Clique nele.
3. Como ainda não há nada baixado, a tela deve dizer `Nenhum capítulo baixado ainda.` e mostrar o cartão de espaço com o quanto está livre e o total do disco.
4. Abra uma obra, clique em um capítulo e copie o número do fim do endereço (`/reader/<número>`). Abra o console do navegador (F12, aba `Console`), cole a linha abaixo trocando `SEU_NUMERO` e aperte Enter:
   `fetch('/api/download',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chapters:[{chapterId:SEU_NUMERO}]})}).then(r=>r.json()).then(console.log)`
5. Volte para `Downloads`. O capítulo deve aparecer na lista com a etiqueta `Na fila` ou `Baixando`, e a etiqueta deve mudar sozinha depois de alguns segundos, sem você recarregar a página.
6. Quando ele terminar (`Concluído`), confira que o cartão de cima passou a mostrar um tamanho maior em `Downloads ocupam`.
7. Clique em `Abrir` na linha do capítulo: o leitor deve abrir aquele capítulo.
8. Volte para `Downloads` e clique em `Remover` naquele capítulo. Ele deve sumir da lista na hora e continuar fora dela depois de recarregar a página.
