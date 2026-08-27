---
id: T-032
title: Desmarcar de uma vez os capítulos que o app marcou como lidos sozinho
status: ready
blockedBy: []
files: [src/app/api/progress/auto/route.ts, src/components/UndoAutoReadButton.tsx, src/app/(app)/work/[slug]/page.tsx]
---

## O que fazer

Desde o T-024, terminar um capítulo marca como lidos todos os anteriores daquele
grupo de scan — o que é ótimo quando você já tinha lido em outro lugar, e péssimo
quando você só abriu o capítulo 300 por curiosidade e o app deu 299 capítulos por
lidos. Hoje não existe volta: seria preciso reabrir cada capítulo, um por um.

Passa a existir, na página da obra, logo acima da lista de capítulos, o botão
**Desmarcar N lidos automáticos** (só aparece quando existe algum). Tocando nele,
ele pergunta o alcance e oferece duas saídas: **Só nesta obra** e **Em todas as
obras**. Confirmando, os sinais de lido dos capítulos que o app marcou sozinho
somem da lista, e o capítulo que você realmente leu até o fim continua marcado.

## Onde mexer

### Como se reconhece uma marcação automática

`src/lib/skippedChapters.ts` cria as marcações automáticas com
`createMany` gravando sempre `lastPageRead: 0` e `read: true`. O leitor, ao
contrário, só manda `read: true` quando chega na última página, e nesse momento
`lastPageRead` é o índice dessa última página — sempre maior que zero em
capítulo com duas páginas ou mais. Então **"lido automaticamente" é a linha de
progresso com `read: true` e `lastPageRead: 0`**, e é esse o filtro usado nos
dois pontos abaixo. Não altere `src/lib/skippedChapters.ts` nem
`src/app/api/progress/route.ts`.

### `src/app/api/progress/auto/route.ts` (novo)

`export const runtime = "nodejs"`. Sem sessão, `401 { "error": "unauthorized" }`
nos dois métodos (mesmo padrão de `src/app/api/progress/route.ts`, que usa
`getSession()` de `@/lib/session`).

Uma função local monta o filtro nos dois métodos:

```ts
function autoWhere(userId: number, workId: number | null, mangaId: number | null) {
  const scope: object[] = [];
  if (workId !== null) scope.push({ workId });
  if (mangaId !== null) scope.push({ mangaId });
  return {
    userId,
    read: true,
    lastPageRead: 0,
    ...(scope.length ? { OR: scope } : {}),
  };
}
```

O `OR` entre `workId` e `mangaId` existe porque linhas antigas podem ter sido
gravadas sem `workId`; o `mangaId` da fonte aberta as alcança do mesmo jeito.

- `GET ?workId=&mangaId=` (os dois opcionais, inteiros; valor inválido conta
  como ausente) → `{ count }`, de `prisma.progress.count({ where: autoWhere(...) })`.
- `DELETE ?workId=&mangaId=` → `prisma.progress.deleteMany({ where: autoWhere(...) })`,
  respondendo `{ ok: true, removed }`. **Sem nenhum parâmetro**, alcança todas as
  obras do usuário. Falha de banco responde `{ ok: false, removed: 0 }` com
  status 200, como a rota de progresso já faz.

Não mexa em `ReadingHistory`: `markSkippedAsRead` nunca cria linha lá, então não
há nada a limpar.

### `src/components/UndoAutoReadButton.tsx` (novo)

`"use client"`, com `useRouter` de `next/navigation`. Props
`{ workId: number; mangaId: number; count: number }`. Retorna `null` quando
`count <= 0`.

- Estado parado: um botão `Desmarcar {count} lidos automáticos`, no visual dos
  outros botões pequenos da página
  (`rounded-lg border border-border px-3 py-2 text-xs text-muted`).
- Tocando, troca para uma fileira com o texto `Desmarcar onde?` e três botões:
  `Só nesta obra`, `Em todas as obras` e `Cancelar`.
- `Só nesta obra` → `DELETE /api/progress/auto?workId={workId}&mangaId={mangaId}`.
  `Em todas as obras` → `DELETE /api/progress/auto`.
- Enquanto envia, os botões ficam desabilitados e o rótulo vira `Desmarcando…`.
  Terminando, mostra `{removed} desmarcados` e chama `router.refresh()`, para a
  lista de capítulos perder os sinais de lido sem recarregar a página na mão.
- Falha de rede mostra `Não deu para desmarcar` e volta ao estado parado.

### `src/app/(app)/work/[slug]/page.tsx`

Dentro de `SourcesAndChapters`, depois de `selected` estar definido, conte as
linhas automáticas do usuário nesta obra:

```ts
const autoReadCount = uid
  ? await prisma.progress
      .count({
        where: {
          userId: uid,
          read: true,
          lastPageRead: 0,
          OR: [{ workId }, { mangaId: selected?.sourceMangaId ?? -1 }],
        },
      })
      .catch(() => 0)
  : 0;
```

Renderize
`<UndoAutoReadButton workId={workId} mangaId={selected?.sourceMangaId ?? 0} count={autoReadCount} />`
dentro da `<section>` dos capítulos, logo abaixo do bloco do botão de continuar
leitura (o `{startId ? … : null}`) e acima do `<BulkDownloadBar>`, com uma
margem `mb-3`.

## Fora do escopo

- Desmarcar um capítulo específico pela lista (o alvo aqui é a marcação em
  massa).
- Desligar a marcação automática do T-024: ela continua acontecendo ao terminar
  um capítulo.
- Botão de desfazer dentro do leitor, logo depois da marcação.
- Apagar o histórico de leitura do perfil ou a exportação em planilha.
- Guardar uma marca nova no banco dizendo quais linhas são automáticas: o
  reconhecimento é pela forma da linha, sem mudar o esquema. Efeito colateral
  conhecido e aceito: um capítulo de **uma página só**, lido até o fim, tem a
  mesma forma de um automático e entra na conta.

## Pronto quando

- [ ] `npm run build` passa.
- [ ] Depois de ler até o fim um capítulo do meio de uma obra, a página da obra
      mostra os capítulos anteriores com o sinal de lido e o botão
      `Desmarcar N lidos automáticos`, com N maior que zero.
- [ ] O primeiro toque no botão mostra as opções `Só nesta obra`,
      `Em todas as obras` e `Cancelar`, sem apagar nada.
- [ ] `Cancelar` volta ao botão original e nada muda.
- [ ] `Só nesta obra` tira o sinal de lido dos capítulos anteriores sem
      recarregar a página na mão, e o botão some.
- [ ] O capítulo que foi lido até o fim **continua** com o sinal de lido depois
      da limpeza.
- [ ] O botão não aparece numa obra em que nada foi marcado automaticamente.
- [ ] `GET /api/progress/auto` sem sessão responde 401.

## Como testar (humano)

1. No terminal, dentro da pasta do projeto, rode `npm run dev -- -p 3100`. Abra
   `http://localhost:3100` e entre com sua conta. (Se precisar de uma conta:
   `npm run user -- add qaburro burro12345`; se disser que já existe, use
   `npm run user -- passwd qaburro burro12345`.)
2. Abra uma obra com bastante capítulo, por exemplo
   `http://localhost:3100/work/solo-leveling-3w0wvo`.
3. Escolha um capítulo do **meio** da lista (não o primeiro) e abra.
4. Role o capítulo até o fim, até aparecer o botão de próximo capítulo no rodapé.
5. Volte para a página da obra. Todos os capítulos abaixo do que você leu têm que
   estar com o sinal de lido, e acima da lista tem que aparecer o botão
   `Desmarcar N lidos automáticos`.
6. Clique nesse botão: têm que aparecer as opções `Só nesta obra`,
   `Em todas as obras` e `Cancelar`.
7. Clique em `Cancelar`: volta ao botão de antes e nada muda na lista.
8. Clique no botão de novo e escolha `Só nesta obra`.
9. Os sinais de lido dos capítulos anteriores têm que sumir sozinhos, e o botão
   tem que desaparecer. O capítulo que você leu no passo 4 tem que continuar
   marcado como lido.
10. Repita os passos 3 a 5 numa segunda obra, depois volte na primeira, leia
    outro capítulo do meio e use `Em todas as obras`: as duas obras têm que ficar
    sem os capítulos marcados automaticamente.
