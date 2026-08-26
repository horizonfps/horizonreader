---
id: T-014
title: Fazer o Continuar abrir o capítulo seguinte ao ponto mais avançado já lido
status: ready
blockedBy: []
files: [src/lib/continueReading.ts, src/app/continue/[workId]/route.ts, src/app/(app)/page.tsx, src/app/(app)/work/[slug]/page.tsx, src/components/CardRow.tsx]
---

## O que fazer

Hoje o botão `Continuar` da página da obra e a faixa `Continuar` da home levam de volta para um capítulo antigo que a pessoa pulou. Quem está no capítulo 380 e nunca abriu o 315.2 é jogado no 315.2.

Depois deste ticket, `Continuar` sempre aponta para o ponto mais avançado da leitura: se o capítulo mais alto já aberto ficou pela metade, ele reabre esse capítulo; se ele foi terminado, abre o capítulo seguinte a ele na lista; capítulos antigos que a pessoa nunca abriu deixam de puxar a leitura para trás. O botão passa a mostrar qual capítulo vai abrir (`Continuar · Cap. 381`), então dá para conferir antes de clicar.

## Onde mexer

### `src/lib/continueReading.ts` (novo)

Concentra a regra, para a página da obra e a home usarem a mesma:

```ts
export type ResumeKind = "start" | "resume" | "next" | "reread";
export type ResumeTarget = { chapterId: number; chapterNumber: number; kind: ResumeKind };

export function pickResumeChapter(
  ascChapters: { id: number; chapterNumber: number }[],
  progress: { chapterId: number; read: boolean; lastPageRead: number; updatedAt: Date }[],
): ResumeTarget | null;
```

Contrato, nesta ordem:

1. `ascChapters` vazio → `null`.
2. Considere só as linhas de `progress` cujo `chapterId` existe em `ascChapters`. Se não sobrar nenhuma → primeiro item de `ascChapters`, `kind: "start"`.
3. `âncora` = a linha de progresso cujo capítulo tem o maior `chapterNumber` dentro de `ascChapters`; empate resolve pelo `updatedAt` maior.
4. Se `âncora.read === false` → devolve o próprio `âncora.chapterId`, `kind: "resume"`.
5. Se `âncora.read === true` → devolve o capítulo imediatamente posterior à âncora em `ascChapters`, `kind: "next"`. Se a âncora for o último da lista → devolve a própria âncora, `kind: "reread"`.

Exporte também `formatChapterNumber(n: number): string`, que devolve `"381"` para inteiros e `"315.2"` para fracionários (`String(Number(n.toFixed(2)))`).

Nada aqui pode consultar banco: é função pura, chamada com listas já montadas.

### `src/app/(app)/work/[slug]/page.tsx`

Dentro de `SourcesAndChapters`, o bloco que hoje começa em `// Reading entry point: resume the in-progress chapter, else first unread` monta `startId`/`startLabel` com `chaptersAsc.find((c) => !readSet.has(c.id))` — é essa varredura de baixo para cima que pega o capítulo pulado. Troque o bloco inteiro por uma chamada a `pickResumeChapter(chaptersAsc, progressList)`.

`chaptersAsc` e `progressList` já existem logo acima e já estão filtrados pelo grupo de scan visível (`visibleChapterIds`); mantenha esses filtros como estão. `readSet` continua sendo usado para o check de lido em cada linha da lista.

O texto do botão passa a ser `${prefixo} · Cap. ${formatChapterNumber(alvo.chapterNumber)}`, com o prefixo vindo do `kind`:

- `start` → `Começar a ler`
- `resume` e `next` → `Continuar`
- `reread` → `Reler último`

Quando `pickResumeChapter` devolver `null`, o botão não é renderizado (é o comportamento atual quando não há capítulo).

### `src/app/continue/[workId]/route.ts` (novo)

Route handler `GET` que decide o capítulo e redireciona, para a home não precisar carregar lista de capítulos de dezenas de obras ao renderizar. Em Next 15 o `params` do handler é `Promise`, então use `const { workId } = await params`.

Passos:

1. `getSession()` (de `@/lib/session`); sem sessão → `NextResponse.redirect(new URL("/login", req.url))`.
2. `prisma.work.findUnique({ where: { id } })`; sem obra → redireciona para `/`.
3. Linhas de `prisma.progress` do usuário para aquele `workId` (todas, lidas e não lidas). Sem nenhuma → redireciona para `/work/<slug>`.
4. Âncora = linha com maior `chapterNumber`; empate pelo `updatedAt` maior. Use o `mangaId` dela para achar o `sourceLink` (`where: { workId, sourceMangaId }`). Se não achar, caia para `getPrimaryLink(workId)` de `@/lib/backbone/resolve`. Sem link → `/work/<slug>`.
5. Capítulos: `getCachedChapters` e, no miss, `loadChaptersForLink` + `setCachedChapters` (todos de `@/lib/chapterCache`). Lista vazia → `/work/<slug>`.
6. Aplique `groupByScanlator` (de `@/lib/chapters`) e escolha o grupo que contém o `chapterId` da âncora; se nenhum contiver, use o primeiro grupo. Depois `dedupeByNumber` e ordene ascendente por `chapterNumber`, igual a página da obra faz.
7. `pickResumeChapter` com essa lista e as linhas de progresso. `null` → `/work/<slug>`; senão redireciona para `/reader/<chapterId>`.

Declare `export const dynamic = "force-dynamic"` e `export const runtime = "nodejs"`, como nas outras rotas do projeto.

### `src/app/(app)/page.tsx`

`getHistory` hoje só lista progresso inacabado (`read: false, lastPageRead: { gt: 0 }`), então uma obra cujo último capítulo foi terminado some da faixa ou, pior, aparece representada por uma sobra antiga. Passe a buscar as linhas de `Progress` do usuário com `workId` não nulo ordenadas por `updatedAt` desc (`take: 60`), deduplicar por `workId` e cortar em 20 obras. O `href` de cada cartão vira `/continue/<workId>`; título e capa continuam vindo de `r.work`.

A faixa continua escondida quando não há nenhuma obra com progresso.

### `src/components/CardRow.tsx`

Aceite uma prop opcional `prefetch?: boolean` e repasse para o `PrefetchLink` (ele espalha o resto das props no `Link`). A home passa `prefetch={false}` na faixa `Continuar`, para o Next não disparar o cálculo do capítulo em toda capa que entra na tela. As outras faixas não mudam.

## Fora do escopo

- Mudar o leitor, a gravação de progresso ou a rota `/api/progress`.
- Marcar capítulos como lidos automaticamente ao pular.
- Mexer na escolha de fonte da página da obra (o bloco `selectedFromProgress` fica como está).
- Botões de download, seção de downloads e zoom — outros tickets desta rodada.
- Alterar as faixas de favoritos, recomendações ou recém-atualizados.

## Pronto quando

- [ ] Existe `src/lib/continueReading.ts` exportando `pickResumeChapter` e `formatChapterNumber`, sem nenhum acesso a banco.
- [ ] Numa obra em que o capítulo de maior número já lido está terminado, o botão da página da obra aponta para o capítulo imediatamente seguinte a ele, e não para um capítulo anterior não lido.
- [ ] Numa obra em que o capítulo de maior número já aberto ficou pela metade, o botão aponta para esse mesmo capítulo.
- [ ] Numa obra sem nenhum progresso, o botão diz `Começar a ler` e aponta para o capítulo de menor número da lista visível.
- [ ] Quando o capítulo de maior número da lista já foi lido, o botão diz `Reler último` e aponta para ele.
- [ ] O texto do botão termina com `· Cap. <número>`, com o número do capítulo que será aberto (ex.: `Continuar · Cap. 315.2`).
- [ ] Abrir `/continue/<id da obra>` redireciona para `/reader/<capítulo>` escolhido pela mesma regra, e cai em `/work/<slug>` quando não há progresso, fonte ou lista de capítulos.
- [ ] Os cartões da faixa `Continuar` da home apontam para `/continue/<id da obra>` e cada obra aparece no máximo uma vez.
- [ ] `npm run build` passa.

## Como testar (humano)

1. Rode `npm run dev -- -p 3100`, abra `http://localhost:3100` e entre com sua conta.
2. Abra uma obra que tenha pelo menos quatro capítulos na lista.
3. Clique no capítulo mais antigo da lista (o de menor número) e role até o fim, até aparecer o link `Próximo capítulo`. Volte para a obra pela seta no canto superior esquerdo.
4. Agora pule um capítulo: abra o terceiro capítulo mais antigo (deixando o segundo sem abrir), role até o fim de novo e volte para a página da obra.
5. Olhe o botão azul acima da lista de capítulos. Ele deve dizer `Continuar` seguido do número do quarto capítulo — o que vem logo depois do que você acabou de terminar. Ele não pode mostrar o capítulo que você pulou.
6. Clique no botão. O leitor deve abrir exatamente o capítulo que estava escrito no botão.
7. Volte para a home. Na faixa `Continuar`, clique na capa dessa obra: o leitor deve abrir o mesmo capítulo do passo 6.
8. Abra um capítulo qualquer, avance duas ou três páginas e volte para a página da obra sem terminar. O botão deve mostrar esse capítulo interrompido.
