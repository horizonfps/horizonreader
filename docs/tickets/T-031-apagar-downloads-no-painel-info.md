---
id: T-031
title: Apagar downloads direto pelo painel /info
status: ready
blockedBy: []
files: [src/app/api/download/bulk/route.ts, src/components/info/AppDownloadsPanel.tsx, src/components/info/InfoDashboard.tsx]
---

## O que fazer

O painel de infra (`/info`, só para administrador) já mostra quanto os downloads
do app ocupam, quantos estão prontos e quantos deram erro — mas é só leitura.
Para liberar espaço, o administrador precisa sair de lá, ir na tela `Downloads` e
apagar capítulo por capítulo.

Passa a existir em `/info` um cartão **Limpeza de downloads** com três botões de
ação em massa — `Apagar com erro`, `Apagar concluídos` e `Apagar tudo`, cada um
com uma confirmação de um toque — mais uma lista de obras com quanto cada uma
ocupa e um botão `Apagar todos` por obra, e a lista dos capítulos que deram erro
com um `Apagar` em cada. Depois de cada ação aparece o resultado
(`Apagados 12 capítulo(s) · 340 MB liberados`) e os números do painel se
atualizam sozinhos.

## Onde mexer

### `src/app/api/download/bulk/route.ts` (novo)

`export const runtime = "nodejs"`. Só `POST`. Sem sessão → `401 { "error": "unauthorized" }`;
com sessão sem `isAdmin` → `403 { "error": "forbidden" }` (`getSession()` de
`@/lib/session` devolve `uid` e `isAdmin`).

Corpo `{ scope: "error" | "done" | "all" }`. Qualquer outro valor →
`400 { "error": "bad_scope" }`. O `scope` vira um filtro de status:
`error` → `{ status: "ERROR" }`, `done` → `{ status: "DONE" }`, `all` → sem
filtro. Busque as linhas com
`prisma.chapterDownload.findMany({ where, select: { chapterId: true, bytes: true } })`
e apague uma a uma com `removeDownload(chapterId)`, importado de
`@/lib/downloads` (a função já existe, apaga os arquivos do disco e a linha do
banco; **não** mexa nesse arquivo). Some `bytes` só das que devolverem `true`.

Resposta: `{ ok: true, removed, bytesFreed }`.

Apagar por capítulo e por obra continua sendo o `DELETE /api/download?chapterId=`
e `DELETE /api/download?workId=` que já existem em
`src/app/api/download/route.ts` — o painel novo chama essas duas, não precisa de
rota nova para isso.

### `src/components/info/AppDownloadsPanel.tsx` (novo)

`"use client"`. Segue o visual do resto do painel: `Card`, `Stat`, `bytes`,
`count` de `./ui`, e `useSWR` como em `src/components/info/InfoDashboard.tsx`.

- `useSWR<Snapshot>("/api/download", fetcher, { refreshInterval: 15000, keepPreviousData: true })`.
  O formato devolvido por `GET /api/download` é
  `{ items: [{ chapterId, workId, workTitle, workSlug, chapterName, chapterNumber, status, pageCount, pagesDone, bytes, error, updatedAt }], storage, policy, gate }`
  — declare no arquivo só os campos que usar.
- `<Card title="Limpeza de downloads">` com, nesta ordem:
  1. Uma fileira de três botões, cada um mostrando a contagem do próprio grupo:
     `Apagar com erro (N)`, `Apagar concluídos (N)`, `Apagar tudo (N)`. Cada
     botão tem confirmação de dois toques: o primeiro toque troca o rótulo para
     `Confirmar?` (e destrava só esse botão), o segundo dispara
     `POST /api/download/bulk` com o `scope` correspondente. Um clique fora, ou
     tocar em outro botão, cancela a confirmação pendente. Botão com contagem
     zero fica desabilitado.
  2. Uma lista de obras, agrupando `items` por `workId` (item sem obra entra num
     grupo `Sem obra`): nome da obra, `N capítulo(s)`, total de bytes do grupo e
     um botão `Apagar todos` que chama
     `DELETE /api/download?workId=<id>` — para o grupo sem obra, faz um
     `DELETE /api/download?chapterId=<id>` por capítulo, em série. Ordene por
     bytes decrescente e mostre no máximo 10 grupos, com uma linha
     `+N obras` embaixo quando houver mais.
  3. Quando existir alguma linha com `status === "ERROR"`, uma lista dos até 20
     primeiros erros: nome do capítulo, a mensagem em `text-red-300` e um botão
     `Apagar` que chama `DELETE /api/download?chapterId=<id>`.
  4. Uma linha de resultado em `text-[11px] text-muted` com
     `Apagados {n} capítulo(s) · {bytes(freed)} liberados` depois de cada ação em
     massa, e `Nada para apagar` quando a resposta vier com zero.
- Toda ação termina com `await mutate()` para os números voltarem certos, e
  trava o próprio botão enquanto está rodando (`disabled` + rótulo `Apagando…`).
- Falha de rede não pode quebrar a tela: mostre `Não deu para apagar` na linha
  de resultado.

### `src/components/info/InfoDashboard.tsx`

Importe e renderize `<AppDownloadsPanel />` entre `{services.data ? <ServicesPanel … /> : null}`
e `<LogsPanel paused={paused} />`.

## Fora do escopo

- Mudar o cartão `Downloads do app` que já existe em
  `src/components/info/ServicesPanel.tsx` (ele continua só mostrando números).
- Mexer na tela `Downloads` do app (`src/components/DownloadsPanel.tsx`).
- Apagar o que está salvo dentro do celular (Cache Storage do navegador).
- Cancelar download em andamento sem apagar o que já baixou.
- Mudar as regras de cota, limpeza automática ou janela de horário.

## Pronto quando

- [ ] `npm run build` passa.
- [ ] Entrando em `/info` com uma conta administradora existe o cartão
      `Limpeza de downloads`, com os botões `Apagar com erro`, `Apagar concluídos`
      e `Apagar tudo`, cada um com a contagem entre parênteses.
- [ ] O primeiro toque num desses botões troca o rótulo para `Confirmar?` e não
      apaga nada.
- [ ] O segundo toque apaga e mostra a linha
      `Apagados N capítulo(s) · X liberados`, e a contagem dos botões cai.
- [ ] Na lista de obras, `Apagar todos` remove os capítulos daquela obra e ela
      some da lista.
- [ ] Depois de apagar, abrir a tela `Downloads` do app mostra a lista sem esses
      capítulos.
- [ ] `POST /api/download/bulk` com uma conta que não é administradora responde
      403 e não apaga nada.

## Como testar (humano)

1. No terminal, dentro da pasta do projeto, rode `npm run dev -- -p 3100`.
2. Garanta uma conta de administrador: `npm run user -- add chefe burro12345 --admin`
   (se disser que já existe, use `npm run user -- passwd chefe burro12345`).
3. Abra `http://localhost:3100` e entre como `chefe`.
4. Abra uma obra qualquer e clique em `Baixar` em três capítulos.
5. Abra `http://localhost:3100/downloads` e espere os três ficarem `Concluído`.
6. Abra `http://localhost:3100/info` e desça a página até o cartão
   `Limpeza de downloads`. (Os cartões de CPU e memória podem aparecer vazios num
   PC comum; isso é normal e não faz parte deste teste.)
7. A lista de obras tem que mostrar a obra que você baixou, com `3 capítulo(s)`.
8. Clique em `Apagar concluídos`. O botão tem que virar `Confirmar?` e nada pode
   sumir ainda.
9. Clique de novo: tem que aparecer a linha dizendo quantos capítulos foram
   apagados e quanto espaço foi liberado, e a obra tem que sumir da lista.
10. Abra `http://localhost:3100/downloads`: os três capítulos não podem mais
    estar lá.
11. Baixe mais um capítulo, volte em `http://localhost:3100/info` e use o
    `Apagar todos` na linha da obra: o capítulo tem que sumir dos dois lugares.
