---
id: T-018
title: Colocar botão de baixar em cada capítulo e um atalho para baixar os próximos
status: ready
blockedBy: [T-016, T-014]
files: [src/app/(app)/work/[slug]/page.tsx, src/components/DownloadButton.tsx]
---

## O que fazer

Na página da obra, cada capítulo da lista ganha um botão de download do lado direito. Clicar nele manda o capítulo para a fila do servidor sem abrir o leitor, e o botão passa a mostrar o estado: `Baixar` → `Na fila` → `Baixado`. Capítulos já guardados no servidor aparecem como `Baixado` assim que a página carrega.

Acima da lista, ao lado do botão de continuar leitura, um segundo botão `Baixar 5 próximos` enfileira de uma vez o capítulo em que a leitura vai retomar e os quatro seguintes — que é como se prepara uma sessão de leitura sem depender da fonte.

## Onde mexer

### API (já entregue no T-016)

`POST /api/download` com este corpo:

```json
{ "workId": 12, "mangaId": 345, "chapters": [{ "chapterId": 6789, "name": "Chapter 381", "number": 381 }] }
```

Resposta: `{ "ok": true, "queued": <n> }`. Pedir um capítulo que já está na fila ou baixado devolve `queued: 0` e não duplica nada.

### `src/components/DownloadButton.tsx`

O componente existe mas não é usado por ninguém hoje, e fala com a versão antiga da rota. Reescreva com esta interface:

```ts
type Props = {
  chapters: { chapterId: number; name: string; number: number }[];
  mangaId: number;
  workId: number;
  initialStatus?: "QUEUED" | "RUNNING" | "DONE" | "ERROR" | null;
  label?: string;   // quando presente, o botão é o atalho de vários capítulos
};
```

Continua `"use client"`. O clique chama `e.preventDefault()` e `e.stopPropagation()` (a linha do capítulo é um link), faz o `POST` com o corpo acima e, com resposta ok, passa para o estado `Na fila`.

Rótulos quando `label` não é passado (um capítulo): `Baixar` no estado inicial, `Na fila` para `QUEUED`, `Baixando` para `RUNNING`, `Baixado` para `DONE`, `Erro` para `ERROR`. Em `DONE` o botão fica desabilitado. Use os ícones `Download` e `Check` de `lucide-react`, no mesmo tamanho `h-4 w-4` usado na lista de capítulos, e mantenha o botão pequeno (`shrink-0 rounded-lg border border-border px-2 py-1 text-[11px] text-muted`).

Com `label` preenchido, o botão mostra esse texto e, depois do clique bem-sucedido, mostra `Na fila` com a quantidade enfileirada devolvida pela resposta (`Na fila (5)`).

### `src/app/(app)/work/[slug]/page.tsx`

Dentro de `SourcesAndChapters`, depois de montar `visible` e `visibleChapterIds`:

- Carregue `prisma.chapterDownload.findMany({ where: { chapterId: { in: [...visibleChapterIds] } }, select: { chapterId: true, status: true } })` (com `.catch(() => [])`, como as outras consultas do arquivo) e monte um `Map<number, string>` de status por capítulo.
- Cada `<li>` da lista hoje é um `<Link>` cobrindo a linha inteira. Reestruture para o botão ficar fora do link, sem link dentro de link: `<li className="flex items-center gap-2">` com o `<Link className="flex min-w-0 flex-1 items-center gap-3 py-2.5">` (nome, data e o check de lido) e, ao lado, `<DownloadButton chapters={[{ chapterId: c.id, name: c.name, number: c.chapterNumber }]} mangaId={selected.sourceMangaId} workId={workId} initialStatus={statusPorCapitulo.get(c.id) ?? null} />`. O botão só aparece quando existe fonte selecionada (`selected`).
- Ao lado do botão de leitura (o bloco que renderiza `startId`, ajustado no T-014 para usar `pickResumeChapter`), acrescente `<DownloadButton label="Baixar 5 próximos" … />` recebendo em `chapters` o capítulo do alvo de retomada mais os quatro seguintes de `chaptersAsc` (a partir do índice do alvo, em ordem crescente; se sobrarem menos que cinco, manda os que houver). Os dois botões ficam lado a lado numa linha (`flex gap-2`), com o botão de leitura ocupando o espaço restante.

`workId` já é parâmetro da função; `selected.sourceMangaId` é o id do mangá na fonte escolhida.

## Fora do escopo

- Baixar a obra inteira ou escolher um intervalo de capítulos.
- Remover download por aqui (a remoção é na tela `/downloads`, T-017).
- Atualizar o estado do botão sozinho enquanto a página fica aberta: o estado inicial vem do servidor a cada carregamento e o clique muda para `Na fila`.
- Mexer na escolha de fonte, nos grupos de scan ou na regra de qual capítulo o botão de leitura abre.
- Baixar arquivos para o aparelho do usuário: o capítulo fica guardado no servidor.

## Pronto quando

- [ ] Toda linha de capítulo da página da obra mostra um botão de download à direita, com a fonte selecionada.
- [ ] Clicar nesse botão não abre o leitor e não navega para outra tela.
- [ ] Depois do clique, o botão daquele capítulo passa a mostrar `Na fila` e fica desabilitado.
- [ ] Recarregando a página, capítulos já concluídos no servidor aparecem como `Baixado` e os que estão na fila aparecem como `Na fila` ou `Baixando`.
- [ ] Um capítulo que falhou aparece como `Erro`.
- [ ] Existe um botão `Baixar 5 próximos` ao lado do botão de leitura, e clicar nele enfileira até cinco capítulos a partir de onde a leitura vai retomar.
- [ ] Os capítulos enfileirados por esses botões aparecem na tela `/downloads`.
- [ ] Clicar duas vezes no mesmo botão não cria dois pedidos do mesmo capítulo.
- [ ] `npm run build` passa.

## Como testar (humano)

1. Rode `npm run dev -- -p 3100`, abra `http://localhost:3100` e entre com sua conta.
2. Abra uma obra qualquer e desça até a lista de capítulos.
3. Em uma das linhas, clique no botão pequeno `Baixar` do lado direito. A tela não pode mudar de página: o botão deve virar `Na fila`.
4. Vá no menu de baixo em `Downloads`. Aquele capítulo deve estar na lista, com etiqueta `Na fila`, `Baixando` ou `Concluído`.
5. Volte para a página da obra e recarregue (F5). O botão daquele capítulo deve mostrar o estado atual dele (`Na fila`, `Baixando` ou `Baixado`), e não voltar para `Baixar`.
6. Acima da lista, clique em `Baixar 5 próximos`. O botão deve mostrar que enfileirou.
7. Abra `Downloads` de novo: devem aparecer os capítulos novos na lista, todos da mesma obra.
