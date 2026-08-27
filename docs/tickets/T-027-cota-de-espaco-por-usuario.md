---
id: T-027
title: Dar cota de espaço de download para cada usuário, não só para o servidor inteiro
status: ready
blockedBy: []
files: [prisma/schema.prisma, src/lib/downloadPolicy.ts, src/lib/downloads.ts, src/app/api/download/route.ts, src/app/api/download/settings/route.ts, src/app/api/download/quota/route.ts, src/components/DownloadRules.tsx, src/components/DownloadsPanel.tsx, src/components/DownloadButton.tsx, src/components/BulkDownloadBar.tsx]
---

## O que fazer

Hoje existe uma única cota de espaço, valendo para o servidor inteiro: quem
baixar primeiro ocupa tudo e os outros ficam sem. E ninguém sabe quem gastou o
quê, porque o download não guarda de quem ele é.

Passa a valer: **todo capítulo baixado fica registrado no nome de quem pediu**,
e cada conta tem a sua própria cota. Na tela `Downloads` aparece um bloco
**Espaço por usuário** com uma linha por conta: quanto ela ocupa, qual o limite
dela e uma barrinha de uso. O administrador edita o limite de qualquer conta ali
mesmo. Em `Regras de download` entra o campo **Cota por usuário (MB)**, que é o
limite padrão de quem não tem um limite próprio.

Quando a conta estoura a cota, o botão `Baixar` responde `Sua cota acabou` e
nada entra na fila — o download dos outros continua normal.

## Onde mexer

### `prisma/schema.prisma`

Três mudanças (depois rode `npm run db:push`; em produção o container já roda
`prisma db push` sozinho no boot):

- `model User`: acrescente `downloadQuotaMb Int @default(0)` (0 = usa o padrão da
  política) e a relação `downloads ChapterDownload[]`.
- `model ChapterDownload`: acrescente `userId Int?`,
  `user User? @relation(fields: [userId], references: [id], onDelete: SetNull)` e
  `@@index([userId])`. Linhas antigas ficam com `userId` nulo e não contam para
  ninguém.
- `model DownloadPolicy`: acrescente `perUserQuotaMb Int @default(0)`.

### `src/lib/downloadPolicy.ts`

O tipo `Policy`, o `DEFAULT_POLICY`, o `getPolicy()` e o `savePolicy()` ganham
`perUserQuotaMb`, no mesmo padrão de `quotaMb` (número inteiro ≥ 0, usando o
helper `intOr` que já existe). `queueGate` **não** muda: cota de usuário não
fecha a fila inteira, ela só barra quem estourou.

### `src/lib/downloads.ts`

- `queueChapterDownloads(items, userId)`: a função ganha um segundo parâmetro
  `userId: number | null`. O bloco de cota global que já existe fica igual.
  Depois dele, quando `userId` não for nulo:
  - `const quotaMb = user.downloadQuotaMb > 0 ? user.downloadQuotaMb : policy.perUserQuotaMb`
    (busque o usuário com `prisma.user.findUnique({ where: { id: userId }, select: { downloadQuotaMb: true } })`);
  - se `quotaMb > 0` e o total já gasto pelo usuário for `>= quotaMb * 1024 * 1024`,
    devolva `{ queued: 0, blocked: "user_quota" }` **sem** enfileirar nada;
  - o total gasto vem de uma função nova exportada
    `userDownloadBytes(userId: number): Promise<number>`, feita com
    `prisma.chapterDownload.aggregate({ _sum: { bytes: true }, where: { userId } })`,
    devolvendo 0 em qualquer falha.
  - as linhas criadas (e as linhas em `ERROR` que voltam para `QUEUED`) passam a
    gravar `userId`.
  - o tipo de retorno vira `{ queued: number; blocked: "quota" | "user_quota" | null }`.
- `enforceStorage()`: depois da limpeza por idade e da limpeza por cota global
  que já existem, acrescente uma passada por usuário — para cada `userId` não
  nulo que tenha linhas, calcule a cota efetiva dele (mesma regra acima) e, se
  passou, apague as linhas `DONE` mais antigas **daquele usuário**
  (`orderBy: { updatedAt: "asc" }`, filtrando por `userId`) com `removeDownload`
  até cair para 90% da cota. Some no `removed`/`bytesFreed` já devolvidos. Como
  todo o resto da função, engole erro e nunca quebra quem chamou.
- `downloadsSnapshot()`: passa a aceitar
  `options?: { viewerId?: number | null; canEditQuotas?: boolean }` (sem
  argumento continua funcionando, que é como `src/app/api/download/settings/route.ts`
  a chama). O objeto devolvido ganha três campos:
  - `viewerId: number | null` e `canEditQuotas: boolean`, ecoando o que veio;
  - `users: { userId: number; username: string; bytes: number; chapters: number; quotaMb: number; quotaBytes: number }[]`,
    montado de `prisma.user.findMany({ select: { id: true, username: true, downloadQuotaMb: true } })`
    cruzado com
    `prisma.chapterDownload.groupBy({ by: ["userId"], _sum: { bytes: true }, _count: { _all: true } })`.
    `quotaMb` é a cota efetiva (a própria, ou a padrão da política quando a
    própria for 0) e `quotaBytes` é ela em bytes (0 = sem limite). Conta sem
    download nenhum entra com zeros. Ordene por `bytes` decrescente.
  - `DownloadItem` ganha `owner: string | null`, vindo de
    `include: { user: { select: { username: true } } }` na consulta que já existe
    em `rows`.

### `src/app/api/download/route.ts`

- `POST`: chame `queueChapterDownloads(items, session.uid)`.
- `GET`: chame `downloadsSnapshot({ viewerId: session.uid, canEditQuotas: session.isAdmin })`.
  `session` já vem de `getSession()` e o payload tem `uid` e `isAdmin`.

### `src/app/api/download/quota/route.ts` (novo)

`export const runtime = "nodejs"`. Só `PUT`. Sem sessão → `401`. Sem
`session.isAdmin` → `403 { "error": "forbidden" }`. Corpo
`{ userId: number, quotaMb: number }`; `userId` inválido → `400 { "error": "bad_ids" }`.
Grava `prisma.user.update({ where: { id: userId }, data: { downloadQuotaMb } })`
com `downloadQuotaMb` inteiro ≥ 0 (`Math.max(0, Math.floor(Number(...)))`, `0`
quando não for finito). Responde `{ ok: true, userId, quotaMb }`. Depois de
gravar, chame `void enforceStorage()` para a cota nova valer na hora.

### `src/app/api/download/settings/route.ts`

Em `parsePolicy`, acrescente
`if (b.perUserQuotaMb !== undefined) out.perUserQuotaMb = Number(b.perUserQuotaMb);`.
Nada mais muda.

### `src/components/DownloadRules.tsx`

O tipo `Policy` exportado daqui ganha `perUserQuotaMb`. Acrescente na grade de
campos um `Cota por usuário (MB)`, igual aos outros `input type="number"`, com o
texto de apoio `0 = sem limite por usuário` e mande o valor no `PUT`.

### `src/components/DownloadsPanel.tsx`

- Os tipos locais `Snapshot`/`DownloadItem` acompanham os campos novos
  (`users`, `viewerId`, `canEditQuotas`, `owner`).
- Uma seção nova **Espaço por usuário**, logo abaixo do cartão de espaço que já
  existe e acima de `<DownloadRules>`, com o mesmo visual
  (`rounded-xl border border-border bg-surface p-4`). Uma linha por item de
  `users`:
  - nome da conta, com ` (você)` quando `userId === viewerId`;
  - `{bytes(user.bytes)} de {user.quotaBytes ? bytes(user.quotaBytes) : "sem limite"}`
    em `text-[11px] tabular-nums text-muted`, mais `{user.chapters} capítulo(s)`;
  - uma barra de uso igual à do cartão de cima (`h-2 rounded-full bg-elevated`
    com um filho `bg-accent`), em vermelho (`bg-red-400`) quando o uso chega em
    100%; sem cota, a barra fica vazia;
  - quando `canEditQuotas` for verdadeiro, um `input type="number"` com o
    `quotaMb` atual e um botão `Salvar` que faz
    `PUT /api/download/quota` com `{ userId, quotaMb }` e depois `mutate()`.
- Na lista de capítulos, mostre `item.owner` como mais um item da linha de
  metadados (`text-[11px] text-muted`), com `—` quando for nulo.

### `src/components/DownloadButton.tsx` e `src/components/BulkDownloadBar.tsx`

Os dois já tratam `data.blocked === "quota"`. Acrescente o caso
`"user_quota"`: no botão, o texto vira `Sua cota acabou` (mesmo comportamento do
`quotaFull` de hoje); na barra em massa, o `result` vira
`Sua cota de espaço acabou`.

## Fora do escopo

- Limitar velocidade de download ou quantos downloads rodam ao mesmo tempo — é
  outro ticket.
- Cota do que é salvo dentro do celular (Cache Storage do navegador): esta cota é
  do disco do servidor.
- Deixar cada usuário aumentar a própria cota: só administrador edita.
- Cobrar cota de capítulos baixados antes desta mudança: linha sem dono não
  entra na conta de ninguém.
- Apagar downloads pelo painel `/info`.

## Pronto quando

- [ ] `npm run build` passa e `npm run db:push` aplica o esquema sem erro.
- [ ] Na tela `Downloads` existe o bloco `Espaço por usuário`, com uma linha por
      conta cadastrada, mostrando quanto ela ocupa e qual o limite dela.
- [ ] Logado como administrador, mudar o número da cota de uma conta e clicar em
      `Salvar` mantém o valor novo depois de recarregar a página.
- [ ] Em `Regras de download` existe o campo `Cota por usuário (MB)`, e o valor
      salvo nele continua lá depois de recarregar.
- [ ] Com a cota da própria conta em 1 MB e já tendo mais de 1 MB baixado nessa
      conta, clicar em `Baixar` num capítulo novo mostra `Sua cota acabou` e
      nenhuma linha nova aparece na lista de downloads.
- [ ] Voltando a cota dessa conta para 0, o mesmo botão `Baixar` volta a
      enfileirar o capítulo normalmente.
- [ ] Um capítulo baixado depois desta mudança mostra o nome da conta que pediu
      na linha dele, na tela `Downloads`.
- [ ] `PUT /api/download/quota` com uma conta que não é administradora responde
      403.

## Como testar (humano)

1. No terminal, dentro da pasta do projeto, rode `npm run db:push` e depois
   `npm run dev -- -p 3100`.
2. Garanta duas contas: `npm run user -- add chefe burro12345 --admin` e
   `npm run user -- add colega burro12345`. Se disser que já existem, use
   `npm run user -- passwd chefe burro12345` e
   `npm run user -- passwd colega burro12345`.
3. Abra `http://localhost:3100` e entre como `chefe`.
4. Abra uma obra qualquer e clique em `Baixar` em dois capítulos.
5. Abra `http://localhost:3100/downloads` e espere os dois ficarem `Concluído`.
   Cada linha tem que mostrar o nome `chefe`.
6. Na mesma tela, ache o bloco `Espaço por usuário`. Tem que aparecer uma linha
   para `chefe` e outra para `colega`, com o espaço ocupado por cada um.
7. Na linha do `chefe`, escreva `1` no campo de limite e clique em `Salvar`.
   Recarregue a página: o `1` tem que continuar lá.
8. Volte para a página da obra e clique em `Baixar` num capítulo ainda não
   baixado. O botão tem que virar `Sua cota acabou`, e nenhum capítulo novo pode
   aparecer na tela `Downloads`.
9. Volte em `http://localhost:3100/downloads`, troque o limite do `chefe` para
   `0` e clique em `Salvar`.
10. Repita o passo 8: agora o capítulo tem que entrar na fila normalmente.
11. Saia da conta e entre como `colega`. Abra `http://localhost:3100/downloads`:
    o bloco `Espaço por usuário` continua aparecendo, mas sem campo de edição
    nem botão `Salvar`.
