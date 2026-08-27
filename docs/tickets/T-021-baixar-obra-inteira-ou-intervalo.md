---
id: T-021
title: Baixar a obra inteira ou um intervalo de capítulos de uma vez
status: ready
blockedBy: []
files: [src/app/(app)/work/[slug]/page.tsx, src/components/BulkDownloadBar.tsx]
---

## O que fazer

Hoje, na página da obra, só dá para baixar um capítulo por vez (botão em cada
linha) ou os cinco próximos (botão `Baixar 5 próximos`). Uma obra de 200
capítulos exige 200 cliques.

Passa a existir, logo abaixo do título `Capítulos`, uma barra com dois botões:

- **Baixar tudo (200)** — pede confirmação (`Baixar 200 capítulos?` com
  `Confirmar` e `Cancelar`) e, confirmado, coloca todos na fila.
- **Escolher intervalo** — abre duas caixas de seleção, `de` e `até`, com os
  capítulos da fonte aberta, e um botão `Baixar N capítulos` que coloca só esse
  trecho na fila.

Enquanto envia, a barra mostra `Enviando 100/200…`; no fim mostra
`200 na fila` (contando só o que ainda não estava baixado ou na fila).

## Onde mexer

A API não muda: `POST /api/download` em `src/app/api/download/route.ts` já
aceita `{ workId, mangaId, chapters: [{ chapterId, name, number }] }` e responde
`{ ok: true, queued: <n> }`, ignorando o que já está em `QUEUED`, `RUNNING` ou
`DONE`. Este ticket só monta a tela que usa esse contrato.

### `src/components/BulkDownloadBar.tsx` (novo)

`"use client"`. Props:

```ts
{
  chapters: { chapterId: number; name: string; number: number }[]; // ordem crescente de número
  mangaId: number;
  workId: number;
}
```

Comportamento:

- Não renderiza nada quando `chapters.length === 0`.
- Botão `Baixar tudo (N)`: primeiro clique troca a barra por uma linha de
  confirmação `Baixar N capítulos?` com `Confirmar` e `Cancelar`.
- Botão `Escolher intervalo`: abre um painel com dois `<select>` (`de` e `até`),
  cada `option` com `value` igual ao `chapterId` e rótulo igual a `name` quando
  houver, ou `Cap. <number>` quando o nome vier vazio. Padrão: `de` no primeiro
  e `até` no último. Se o usuário escolher um `até` anterior ao `de`, use o
  trecho entre os dois de qualquer jeito (ordene os dois índices). Abaixo, o
  botão `Baixar N capítulos`, com N recalculado a cada troca.
- Envio: quebre a lista em blocos de 100 e faça um `POST /api/download` por
  bloco, em série, com `{ workId, mangaId, chapters: bloco }`. Enquanto envia,
  o texto do botão vira `Enviando <enviados>/<total>…` e os controles ficam
  desabilitados. Some os `queued` de cada resposta e mostre
  `<soma> na fila` no fim. Se algum bloco falhar (resposta não-ok ou exceção),
  pare e mostre `Falhou ao enviar` mantendo o total já enviado.
- Se alguma resposta vier com `blocked === "quota"` (campo que o T-022 pode
  introduzir; hoje ele simplesmente não existe e a comparação dá falso), pare o
  envio e mostre `Cota cheia — libere espaço em Downloads`.
- Terminado o envio, chame `router.refresh()` (`useRouter` de
  `next/navigation`) para a lista de capítulos re-renderizar com os status novos.
- Visual no padrão da página: botões `rounded-lg border border-border px-3 py-2
  text-xs text-muted`, painel em `rounded-lg border border-border bg-surface
  p-3`, texto de resultado em `text-[11px] text-muted`.

### `src/app/(app)/work/[slug]/page.tsx`

Dentro de `SourcesAndChapters`, a variável `visible` já é a lista deduplicada e
ordenada do maior número para o menor, e `chaptersAsc` já é essa mesma lista
invertida (crescente). Logo depois do bloco do botão `Continuar/Começar a ler`
(o `div` com `mb-3 flex gap-2`), e antes da lista `<ul>` de capítulos, renderize:

```tsx
{selected && visible.length > 0 ? (
  <BulkDownloadBar
    chapters={chaptersAsc.map((c) => ({ chapterId: c.id, name: c.name, number: c.chapterNumber }))}
    mangaId={selected.sourceMangaId}
    workId={workId}
  />
) : null}
```

com o `import BulkDownloadBar from "@/components/BulkDownloadBar";` junto dos
outros imports de componente. Não mexa no `DownloadButton` de cada linha nem no
botão `Baixar 5 próximos`, que continuam como estão.

## Fora do escopo

- Agendar o download para outro horário, cota de espaço e limpeza automática —
  é o T-022.
- Remover vários capítulos de uma vez (a tela `Downloads` já tem
  `Remover todos` por obra).
- Baixar só os capítulos ainda não lidos, ou baixar de mais de uma fonte ao
  mesmo tempo.
- Mudar a fila do servidor (`src/lib/downloads.ts`) ou a API de download.

## Pronto quando

- [ ] `npm run build` passa.
- [ ] Na página de uma obra com capítulos aparece a barra com
      `Baixar tudo (<total>)` e `Escolher intervalo`, com `<total>` igual à
      quantidade mostrada no título `Capítulos (<total>)`.
- [ ] Clicar em `Baixar tudo` mostra a confirmação `Baixar <total> capítulos?`
      com `Confirmar` e `Cancelar`, e `Cancelar` volta a barra ao estado inicial
      sem enviar nada.
- [ ] `Escolher intervalo` abre duas listas de seleção com os capítulos da fonte
      aberta, e o botão mostra a contagem certa do trecho escolhido
      (`Baixar 3 capítulos` para um intervalo de três).
- [ ] Confirmado o envio, a barra mostra `<n> na fila`, e a tela `/downloads`
      passa a listar exatamente esses capítulos.
- [ ] Enviar de novo o mesmo intervalo mostra `0 na fila` e não duplica nada em
      `/downloads`.
- [ ] Uma obra sem capítulos na fonte aberta não mostra a barra.

## Como testar (humano)

1. No terminal rode `npm run dev -- -p 3100`, abra `http://localhost:3100` e
   entre com sua conta. (Se precisar de uma conta:
   `npm run user -- add qaburro burro12345`; se disser que já existe, use
   `npm run user -- passwd qaburro burro12345`.)
2. Abra `http://localhost:3100/work/solo-leveling-3w0wvo` e espere a lista de
   capítulos aparecer.
3. Logo abaixo do botão azul de continuar leitura devem existir dois botões:
   `Baixar tudo (…)` com a mesma quantidade que aparece no título `Capítulos
   (…)`, e `Escolher intervalo`.
4. Clique em `Baixar tudo`: deve aparecer a pergunta `Baixar … capítulos?` com
   `Confirmar` e `Cancelar`. Clique em `Cancelar` — a barra volta ao normal e
   nada é enviado.
5. Clique em `Escolher intervalo`. Nas duas caixas que aparecem, escolha em `de`
   o primeiro capítulo da lista e em `até` o terceiro. O botão embaixo deve
   dizer `Baixar 3 capítulos`.
6. Clique nele. A barra deve mostrar o envio e terminar com `3 na fila`.
7. Abra `http://localhost:3100/downloads`: os três capítulos escolhidos têm que
   aparecer na lista (como `Na fila`, `Baixando`, `Concluído` ou `Erro`).
8. Volte para a obra, repita o mesmo intervalo de três capítulos e confirme:
   agora a barra tem que dizer `0 na fila`, e a tela `Downloads` continua com os
   mesmos três capítulos, sem repetição.
