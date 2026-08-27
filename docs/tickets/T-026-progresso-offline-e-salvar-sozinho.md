---
id: T-026
title: Guardar o progresso lido sem rede e salvar sozinho no aparelho o que termina de baixar
status: ready
blockedBy: []
files: [public/sw.js, src/lib/offlineProgress.ts, src/components/OfflineSync.tsx, src/components/OfflineAutoSaveToggle.tsx, src/components/SaveOfflineButton.tsx, src/components/Reader.tsx, src/app/api/download/pages/route.ts, src/app/(app)/layout.tsx, src/app/(app)/downloads/page.tsx]
---

## O que fazer

Duas faltas da rodada passada, as duas na prateleira offline.

**1. Ler sem rede não conta como leitura.** Hoje, quando o celular está sem
internet (ou o servidor está fora do ar), o capítulo abre pela prateleira
`Salvos no aparelho`, mas nada disso volta para o servidor: ao reconectar, o
capítulo continua aparecendo como não lido e o "Continuar" volta para trás.
Passa a valer: tudo que foi lido sem rede fica guardado no próprio aparelho e é
enviado para o servidor assim que a conexão volta, sem o usuário fazer nada. Vale
tanto para o leitor normal do app (rede caiu no meio da leitura) quanto para o
leitor simples da prateleira offline.

**2. Salvar sozinho no aparelho.** Hoje, guardar um capítulo no celular é sempre
um toque manual. Passa a existir na tela `Downloads` uma chave
**Salvar no celular automaticamente**, desligada por padrão. Ligada, todo
capítulo que termina de baixar no servidor é copiado para o aparelho sozinho,
enquanto o app estiver aberto, e passa a aparecer em `Salvos no aparelho` sem
nenhum toque. Desligada, nada muda em relação a hoje.

## Onde mexer

O armazenamento offline já existe e é um Cache Storage chamado `hr-offline-v1`,
com um índice em `/__offline/index.json` (uma lista JSON de itens). Quem escreve
nele hoje é `src/components/SaveOfflineButton.tsx` e o HTML embutido no
`public/sw.js`. Nada disso muda de nome.

### `src/lib/offlineProgress.ts` (novo)

Módulo de browser (sem `"use client"`, é só um módulo importado por componentes
client). Exporta as constantes e as funções abaixo:

```ts
export const OFFLINE_CACHE = "hr-offline-v1";
export const OFFLINE_INDEX_URL = "/__offline/index.json";
export const PROGRESS_QUEUE_URL = "/__offline/progress.json";

export type PendingProgress = {
  chapterId: number;
  mangaId: number;
  workId: number | null;
  chapterNumber: number | null;
  lastPageRead: number;
  read: boolean;
  at: number;
};

export async function queueProgress(entry: PendingProgress): Promise<void>;
export async function flushProgress(): Promise<number>;
```

- `queueProgress`: se `typeof caches === "undefined"` sai calado. Abre o cache,
  lê a fila de `PROGRESS_QUEUE_URL` (array vazio quando não existir ou não for
  array), mantém **um item por `chapterId`**: o novo substitui o antigo quando
  `entry.read` for verdadeiro ou quando `entry.lastPageRead >= antigo.lastPageRead`;
  caso contrário o antigo fica. Regrava com
  `cache.put(PROGRESS_QUEUE_URL, new Response(JSON.stringify(list), { headers: { "content-type": "application/json" } }))`.
  Nunca lança.
- `flushProgress`: devolve quantos itens o servidor aceitou. Sai devolvendo `0`
  quando `typeof caches === "undefined"` ou `navigator.onLine === false`. Lê a
  fila e, para cada item, faz
  `POST /api/progress` com `{ mangaId, chapterId, workId, chapterNumber, lastPageRead, read }`
  e `credentials: "same-origin"`. Item com resposta `ok` sai da fila; resposta
  `401` também sai da fila (sessão expirada, insistir só empilha lixo);
  qualquer erro de rede **para o laço** e mantém o resto da fila. No fim regrava
  a fila com o que sobrou. Nunca lança.

`POST /api/progress` já existe em `src/app/api/progress/route.ts` e aceita
exatamente esse corpo (`mangaId` e `chapterId` inteiros obrigatórios, `workId` e
`chapterNumber` opcionais, `read` booleano). Não mexa nessa rota.

### `src/components/Reader.tsx`

- Importe `queueProgress`, `flushProgress` e o tipo do módulo novo.
- Em `saveProgress` (o `useCallback` que hoje monta `payload` e chama
  `navigator.sendBeacon` ou `fetch("/api/progress")`): antes de qualquer envio,
  se `typeof navigator !== "undefined" && navigator.onLine === false`, chame
  `void queueProgress({ chapterId, mangaId, workId: workId ?? null, chapterNumber: chapterNumber ?? null, lastPageRead: p, read, at: Date.now() })`
  e **retorne** sem tocar na rede. No caminho normal, troque o
  `.catch(() => {})` do `fetch` por um `.catch(() => { void queueProgress({...}) })`
  com o mesmo objeto. O caminho do `sendBeacon` continua como está quando está
  online.
- Acrescente um `useEffect` de montagem que chama `void flushProgress()`, para
  o caso de a rede ter voltado enquanto o leitor estava aberto.

### `src/components/SaveOfflineButton.tsx`

O item gravado no índice hoje é
`{ chapterId, chapterName, workTitle, workSlug, urls, savedAt }`. Sem o id do
mangá não dá para mandar progresso depois, então o item passa a carregar três
campos a mais:

- Acrescente ao tipo `Props` e ao tipo `OfflineItem`:
  `mangaId: number`, `workId?: number | null`, `chapterNumber?: number | null`.
- Grave-os no objeto que vai para o índice.
- Em `src/components/Reader.tsx`, passe
  `mangaId={mangaId} workId={workId} chapterNumber={chapterNumber}` para
  `<SaveOfflineButton>` (o componente já recebe `chapterId`, `chapterName`,
  `workTitle`, `workSlug` e `urls`; o `Reader` já tem todas essas props).

Itens salvos antes desta mudança não têm esses campos: quem lê o índice trata
`mangaId` ausente ou não numérico como "não dá para mandar progresso" e apenas
não enfileira nada.

### `src/app/api/download/pages/route.ts`

A resposta JSON ganha três campos, vindos da própria linha já consultada:
`mangaId: row.mangaId`, `workId: row.workId`, `chapterNumber: row.chapterNumber`.
O resto (`chapterId`, `chapterName`, `workTitle`, `workSlug`, `urls`) fica igual.

### `public/sw.js`

O arquivo é um service worker com um documento HTML inteiro embutido na
constante `OFFLINE_HTML`, que atende `/offline` e qualquer navegação que falhe.
Mudanças:

1. Suba `const VERSION = "v2"` para `"v3"`. **Continue nunca apagando** caches
   que começam com `hr-offline-` no `activate` — só os `hr-img-` antigos.
2. Dentro do script embutido em `OFFLINE_HTML`, acrescente uma constante
   `var QUEUE_URL = "/__offline/progress.json";` e as funções:
   - `readQueue(cache)` / `writeQueue(cache, list)`: mesmo par de
     `match`/`put` já usado para o índice.
   - `recordProgress(item, lastPageRead, read)`: sai calado quando
     `typeof item.mangaId !== "number"`. Monta
     `{ chapterId, mangaId, workId: item.workId ?? null, chapterNumber: item.chapterNumber ?? null, lastPageRead, read, at: Date.now() }`
     e grava na fila com a mesma regra de "um item por `chapterId`, o de maior
     `lastPageRead` (ou com `read`) vence".
   - `flushQueue()`: sai quando `!navigator.onLine`; percorre a fila mandando
     `POST /api/progress` (`credentials: "same-origin"`,
     `headers: {"content-type":"application/json"}`); tira da fila os aceitos e
     os `401`; para no primeiro erro de rede; regrava o que sobrou.
3. Em `openReader(item)` (a função que troca a lista pelo leitor vertical):
   - guarde `var maxSeen = 0;`
   - depois de montar as imagens, registre um listener de `scroll` na janela
     que, a cada quadro (`requestAnimationFrame` com trava de reentrada),
     percorre as `<img>` já anexadas e acha o **último** índice cujo
     `getBoundingClientRect().top <= window.innerHeight / 2`; atualize
     `maxSeen = Math.max(maxSeen, idx)`.
   - quando o usuário toca `‹ voltar`, e também no `pagehide` da janela, chame
     `recordProgress(item, maxSeen, maxSeen >= (item.urls || []).length - 1)` e
     remova o listener de `scroll`.
4. Em `render()`, antes de desenhar a seção `Baixados no servidor`, chame
   `flushQueue()`. Registre também `window.addEventListener("online", flushQueue)`
   uma única vez, para o caso de a rede voltar com a prateleira aberta.
5. Ainda no `OFFLINE_HTML`, abaixo do título, uma linha com um `<input type="checkbox">`
   e o texto `Salvar no celular automaticamente`, ligado à chave
   `localStorage.getItem("offline:autosave") === "1"`. Marcar grava `"1"`,
   desmarcar grava `"0"`. A prateleira só guarda a preferência; quem copia os
   capítulos é o app (item abaixo).

### `src/components/OfflineSync.tsx` (novo)

`"use client"`, renderiza `null`. É o motor que roda em qualquer tela do app:

- Na montagem: `void flushProgress()` e uma passada de auto-salvamento.
- Listener de `window` em `"online"` → as duas coisas de novo.
- Listener de `window` no evento custom `"hr:autosave-changed"` → passada de
  auto-salvamento.
- `setInterval` de 60 s que só age quando `document.visibilityState === "visible"`.
- Passada de auto-salvamento (`autoSave`), com trava de reentrada em `useRef`:
  1. sai quando `typeof caches === "undefined"`, quando `!navigator.onLine` ou
     quando `localStorage.getItem("offline:autosave") !== "1"`;
  2. `GET /api/download` (`credentials: "same-origin"`), lê `items`;
  3. filtra `status === "DONE"` cujo `chapterId` ainda não está no índice
     `/__offline/index.json`;
  4. pega no máximo **3** por passada e, para cada um: `GET /api/download/pages?chapterId=<id>`,
     depois `await cache.add(url)` para cada url (falha de página individual é
     ignorada), e por fim insere no índice o item completo
     `{ chapterId, chapterName, workTitle, workSlug, mangaId, workId, chapterNumber, urls, savedAt: Date.now() }`;
  5. capítulo em que nenhuma página entrou não é gravado no índice.

Use as constantes e os helpers de leitura/escrita do índice de
`src/lib/offlineProgress.ts` (exporte de lá também `readOfflineIndex(cache)` e
`writeOfflineIndex(cache, list)` para não duplicar o par `match`/`put`).

### `src/app/(app)/layout.tsx`

Renderize `<OfflineSync />` dentro do `<div>` do layout, depois de `<BottomNav />`.

### `src/components/OfflineAutoSaveToggle.tsx` (novo)

`"use client"`. Retorna `null` quando `typeof caches === "undefined"`. Mostra:

- um `<label>` com `<input type="checkbox">` e o texto
  `Salvar no celular automaticamente`;
- abaixo, em `text-xs text-muted`, `Vale só neste aparelho. Copia sozinho tudo que terminar de baixar no servidor.`;
- e a contagem `N capítulo(s) salvos neste aparelho`, lida do índice na montagem.

Marcar/desmarcar grava `localStorage.setItem("offline:autosave", "1" | "0")` e
dispara `window.dispatchEvent(new Event("hr:autosave-changed"))`. O estado
inicial vem do mesmo `localStorage` dentro de um `useEffect` (nunca no
`useState` inicial, para não quebrar a hidratação).

### `src/app/(app)/downloads/page.tsx`

Abaixo do link `Salvos no celular` que já existe, renderize
`<OfflineAutoSaveToggle />`.

## Fora do escopo

- Sincronizar favoritos, notas ou qualquer outra coisa feita offline: só
  progresso de leitura.
- Baixar capítulo novo do servidor estando offline (sem rede não há o que
  baixar).
- Apagar sozinho do aparelho o capítulo já lido, ou limite de espaço no
  aparelho.
- Mudar a fila de download do servidor, a cota (`src/lib/downloadPolicy.ts`) ou
  a tela de regras.
- Notificação do sistema quando um capítulo termina de ser salvo.

## Pronto quando

- [ ] `npm run build` passa.
- [ ] Com o servidor parado, abrir o endereço do app mostra a prateleira
      `Salvos no aparelho`; abrir um capítulo salvo, rolar até a última página e
      voltar não dá erro na tela.
- [ ] Subindo o servidor de volta e abrindo a página da obra, o capítulo lido
      offline aparece marcado como lido (o "check" na linha do capítulo).
- [ ] Na tela `Downloads` existe a chave `Salvar no celular automaticamente`,
      desligada por padrão, e o estado dela continua igual depois de recarregar
      a página.
- [ ] Com a chave ligada, baixar um capítulo pelo botão `Baixar` e esperar ele
      ficar `Concluído` faz esse capítulo aparecer em `/offline` na lista de
      salvos em até um minuto, sem nenhum toque em `Salvar no aparelho`.
- [ ] Com a chave desligada, um capítulo recém-baixado **não** entra sozinho na
      lista de salvos.
- [ ] `GET /api/download/pages?chapterId=<id>` de um capítulo baixado responde
      um JSON que contém os campos `mangaId`, `workId` e `chapterNumber`.

## Como testar (humano)

1. No terminal, dentro da pasta do projeto, rode `npm run dev -- -p 3100`. Abra
   `http://localhost:3100` e entre com sua conta. (Se precisar de uma conta:
   `npm run user -- add qaburro burro12345`; se disser que já existe, use
   `npm run user -- passwd qaburro burro12345`.)
2. Abra uma obra qualquer e clique num capítulo para abrir o leitor. Espere as
   primeiras páginas aparecerem.
3. Clique uma vez no meio da tela e toque em `Salvar no celular`. Espere o botão
   virar `Salvo no celular`.
4. Volte para a obra e anote o nome desse capítulo. Ele **não** pode estar com o
   sinal de lido ainda.
5. Abra `http://localhost:3100/downloads` e ligue a chave
   `Salvar no celular automaticamente`.
6. Volte ao terminal e pare o servidor (encerre o `npm run dev`). Espere cinco
   segundos.
7. No navegador, abra `http://localhost:3100/`. Tem que aparecer a prateleira
   `Salvos no aparelho`. Clique em `Ler` no capítulo salvo, role até a última
   página e toque em `‹ voltar`.
8. Suba o servidor de novo (`npm run dev -- -p 3100`) e abra
   `http://localhost:3100/`. Espere uns dez segundos.
9. Abra de novo a página daquela obra: a linha do capítulo que você leu sem
   internet tem que estar marcada como lida.
10. Ainda na página da obra, clique em `Baixar` num capítulo diferente. Abra
    `http://localhost:3100/downloads` e espere ele ficar `Concluído`.
11. Sem clicar em mais nada, espere um minuto e abra `http://localhost:3100/offline`.
    Esse capítulo recém-baixado tem que estar na lista de salvos no aparelho.
12. Volte em `http://localhost:3100/downloads`, desligue a chave, baixe um
    terceiro capítulo e espere ficar `Concluído`: depois de um minuto ele **não**
    pode aparecer sozinho em `/offline`.
