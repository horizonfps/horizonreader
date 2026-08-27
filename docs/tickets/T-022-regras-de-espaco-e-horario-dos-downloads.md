---
id: T-022
title: Dar cota, faxina automática, aviso de disco cheio e horário aos downloads
status: ready
blockedBy: []
files: [prisma/schema.prisma, src/lib/downloadPolicy.ts, src/lib/downloads.ts, src/app/api/download/route.ts, src/app/api/download/settings/route.ts, src/components/DownloadsPanel.tsx, src/components/DownloadRules.tsx, src/components/DownloadButton.tsx]
---

## O que fazer

Hoje a fila de download baixa sem limite nenhum: enche o disco do servidor, roda
no meio do dia consumindo a internet de casa e nunca apaga nada. A tela
`Downloads` ganha um bloco **Regras de download** com cinco controles, que valem
para todo o app:

- **Cota de espaço (MB)** — quanto os downloads podem ocupar no total. Zero
  significa sem limite. Ao encostar na cota, os capítulos mais antigos são
  apagados sozinhos até caber; se nem assim couber, pedir um capítulo novo
  responde `Cota cheia`.
- **Apagar baixados com mais de (dias)** — faxina por idade. Zero desliga.
- **Avisar quando o espaço livre for menor que (GB)** — abaixo disso, a fila
  para e a tela mostra `Pouco espaço em disco`.
- **Baixar só entre (início e fim)** — janela de horário. Fora dela, o que foi
  pedido fica `Na fila` e só começa quando a janela abre. Campos vazios =
  qualquer horário.
- **Pausar downloads** — para a fila na hora, sem perder nada da fila.

Quando a fila está parada por um desses motivos, a tela `Downloads` mostra o
motivo em destaque (`Fila pausada`, `Fora da janela (23:00–06:00)`,
`Pouco espaço em disco (1,2 GB livres)`). Há também um botão **Liberar espaço
agora**, que aplica a faxina na hora e informa quantos capítulos foram apagados.

## Onde mexer

### `prisma/schema.prisma`

Projeto SQLite sem migrations: depois de editar rode `npm run db:push`
(`DATABASE_URL` local é `file:./dev.db`). Modelo novo, linha única:

```prisma
// Single row of policy for the download queue: how much space it may use, how
// long a download is kept and the hours the queue may run.
model DownloadPolicy {
  id          Int      @id @default(autoincrement())
  quotaMb     Int      @default(0) // 0 = no limit
  keepDays    Int      @default(0) // 0 = never delete by age
  minFreeGb   Int      @default(2)
  windowStart String   @default("") // "HH:MM"; empty = any hour
  windowEnd   String   @default("")
  paused      Boolean  @default(false)
  updatedAt   DateTime @updatedAt
}
```

### `src/lib/downloadPolicy.ts` (novo)

Módulo de servidor, sem nada de UI. Exporta:

```ts
export type Policy = {
  quotaMb: number; keepDays: number; minFreeGb: number;
  windowStart: string; windowEnd: string; paused: boolean;
};
export type Gate = { open: boolean; reason: "paused" | "window" | "disk" | null; detail: string | null };

export const DEFAULT_POLICY: Policy;
export async function getPolicy(): Promise<Policy>;          // linha id=1, ou o padrão
export async function savePolicy(input: Partial<Policy>): Promise<Policy>;
export function windowOpen(policy: Policy, now?: Date): boolean;
export function queueGate(policy: Policy, freeBytes: number): Gate;
```

- `getPolicy` lê `prisma.downloadPolicy.findUnique({ where: { id: 1 } })` e cai
  em `DEFAULT_POLICY` quando não existe ou a consulta falha (nunca lança).
- `savePolicy` grava com
  `prisma.downloadPolicy.upsert({ where: { id: 1 }, create: { id: 1, ...v }, update: v })`,
  depois de limpar os valores: `quotaMb`, `keepDays` e `minFreeGb` viram
  inteiros `>= 0` (valor inválido cai no atual); `windowStart`/`windowEnd` só
  aceitam `/^([01]\d|2[0-3]):[0-5]\d$/`, qualquer outra coisa vira `""`.
- `windowOpen`: `true` quando qualquer um dos dois campos está vazio. Senão
  compara os minutos do dia do `now` local com os da janela, aceitando janela
  que cruza a meia-noite (`start > end` → aberto quando `agora >= start` **ou**
  `agora < end`). `start === end` conta como sempre aberto.
- `queueGate`, nesta ordem: `paused` → `{ open: false, reason: "paused", detail: "Fila pausada" }`;
  janela fechada → `{ open: false, reason: "window", detail: "Fora da janela (<start>–<end>)" }`;
  `minFreeGb > 0 && freeBytes < minFreeGb * 1024³` →
  `{ open: false, reason: "disk", detail: "Pouco espaço em disco" }`; senão
  `{ open: true, reason: null, detail: null }`.

### `src/lib/downloads.ts`

O módulo já tem a fila (`runQueue`), `removeDownload`, `downloadsSnapshot` e
`tierDir("download")` para achar a pasta. Acrescente:

- `async function freeBytesOnDownloadDisk(): Promise<number>` — reaproveita o
  que `downloadsSnapshot` já faz: `mkdir(dir, { recursive: true })` e `statfs`,
  devolvendo `bavail * bsize` (ou `Infinity` se o `statfs` falhar, para nunca
  travar a fila por causa de um erro de leitura).
- `export async function enforceStorage(): Promise<{ removed: number; bytesFreed: number }>`:
  1. Se `keepDays > 0`, apaga (via `removeDownload`) toda linha `DONE` com
     `updatedAt` anterior a `agora - keepDays` dias.
  2. Se `quotaMb > 0`, soma os `bytes` de todas as linhas; enquanto a soma
     passar da cota, apaga a linha `DONE` de `updatedAt` mais antigo e desconta
     os bytes dela, parando quando a soma ficar em até 90% da cota ou quando não
     houver mais linha `DONE`.
  Nunca lança; devolve os totais do que foi apagado.
- Na `runQueue`, antes de pegar cada linha `QUEUED`: rode `enforceStorage()` e
  depois `queueGate(await getPolicy(), await freeBytesOnDownloadDisk())`. Com o
  portão fechado, **não** mude o status da linha (ela continua `QUEUED`),
  agende uma nova tentativa e retorne. O agendamento é um `setTimeout` de 60s
  guardado por uma variável de módulo (só um pendente por vez), chamando
  `runQueue()` de novo; use `timer.unref?.()` para não segurar o processo.
- `queueChapterDownloads` passa a devolver
  `{ queued: number; blocked: "quota" | null }`. Antes de criar qualquer linha,
  se `quotaMb > 0` e a soma de `bytes` das linhas já alcança a cota, chame
  `enforceStorage()` e recalcule; se ainda alcançar, devolva
  `{ queued: 0, blocked: "quota" }` sem criar nada. O resto da lógica (ignorar
  o que já está `QUEUED`/`RUNNING`/`DONE`, ressuscitar `ERROR`) continua igual.
- `downloadsSnapshot` passa a devolver também `policy` (o objeto de
  `getPolicy()`) e `gate` (o de `queueGate`), e acrescenta em `storage` o campo
  `quotaBytes` (`quotaMb * 1024 * 1024`, ou `0` quando sem limite).
- Depois que um capítulo termina em `DONE`, chame `enforceStorage()` uma vez.

### `src/app/api/download/route.ts`

`POST` passa a responder `{ ok: true, queued, blocked }` com os dois campos
vindos de `queueChapterDownloads`. Nada mais muda: `GET` já devolve o
`downloadsSnapshot()` inteiro (agora com `policy` e `gate`) e `DELETE` fica como
está.

### `src/app/api/download/settings/route.ts` (novo)

`runtime = "nodejs"`, sessão obrigatória em todos os métodos (401 sem sessão).

- `GET` → `{ policy, gate, storage }`, reaproveitando `downloadsSnapshot()`.
- `PUT` com corpo `{ quotaMb?, keepDays?, minFreeGb?, windowStart?, windowEnd?, paused? }`
  → chama `savePolicy`, dispara `void runQueue()` (para a fila voltar na hora
  quando o usuário despausa) e responde `{ ok: true, policy }`.
- `POST` com corpo `{ "action": "cleanup" }` → chama `enforceStorage()` e
  responde `{ ok: true, removed, bytesFreed }`. Qualquer outro `action` responde
  `400 { "error": "bad_action" }`.

### `src/components/DownloadRules.tsx` (novo)

`"use client"`. Props: `{ policy: Policy; onChanged: () => void }`.

Formulário dentro de um `<section className="rounded-xl border border-border
bg-surface p-4">` com o título `Regras de download`, seguindo o visual do
cartão de espaço que já existe em `DownloadsPanel`:

- `Cota de espaço (MB)` — `input type="number" min="0"`, legenda `0 = sem limite`.
- `Apagar baixados com mais de (dias)` — `input type="number" min="0"`, legenda
  `0 = nunca apagar`.
- `Avisar quando o espaço livre for menor que (GB)` — `input type="number" min="0"`.
- `Baixar só entre` — dois `input type="time"` (`windowStart` e `windowEnd`),
  legenda `vazio = qualquer horário`.
- `Pausar downloads` — `input type="checkbox"`.
- Botão `Salvar` → `PUT /api/download/settings` com os valores; enquanto envia
  fica desabilitado; ao voltar mostra `Salvo` por alguns segundos e chama
  `onChanged()`.
- Botão `Liberar espaço agora` → `POST /api/download/settings` com
  `{ action: "cleanup" }`; ao voltar mostra
  `Apagados <removed> capítulo(s) · <bytes(bytesFreed)> liberados` (use `bytes`
  de `@/components/info/ui`) e chama `onChanged()`.

Cada campo é controlado por estado local, iniciado com o `policy` recebido.

### `src/components/DownloadsPanel.tsx`

O painel já consulta `/api/download` com `useSWR` e desenha o cartão de espaço e
a lista agrupada por obra. Acrescente:

- Os tipos `policy`/`gate`/`storage.quotaBytes` no `Snapshot`.
- Logo abaixo do cartão de espaço, `<DownloadRules policy={data.policy} onChanged={() => mutate()} />`
  (só quando `data?.policy` existir).
- No cartão de espaço, quando `storage.quotaBytes > 0`, uma linha a mais:
  `Cota: <bytes(downloadsBytes)> de <bytes(quotaBytes)>`; se
  `downloadsBytes >= quotaBytes`, o texto vira `Cota cheia: …` em
  `text-red-300`.
- Acima da lista, quando `gate.open` for falso, uma faixa
  `rounded-xl border border-amber-400/30 bg-amber-400/5 p-3 text-xs text-amber-200`
  com `gate.detail`. Quando o motivo for `disk`, complemente com o espaço livre
  real: `<detail> (<bytes(diskFree)> livres)`.

### `src/components/DownloadButton.tsx`

Depois do `POST`, se a resposta trouxer `blocked === "quota"`, não marque como
`QUEUED`: mostre o texto `Cota cheia` no botão e deixe-o habilitado para nova
tentativa.

## Fora do escopo

- Cota por usuário: a regra é do servidor inteiro, uma linha só.
- Apagar automaticamente o que já foi lido (a faxina olha idade e cota, não
  progresso de leitura).
- Limitar velocidade de download ou número de downloads simultâneos.
- Mexer nos caches de imagem (`page` e `cover` continuam com a poda por tamanho
  que já têm).
- Mostrar essas regras no painel `/info` — é o T-023.

## Pronto quando

- [ ] `npm run db:push` cria a tabela `DownloadPolicy` sem erro e
      `npm run build` passa.
- [ ] `GET /api/download` responde, além de `items` e `storage`, os blocos
      `policy` (com os seis campos) e `gate` (com `open`, `reason` e `detail`).
- [ ] A tela `/downloads` mostra o bloco `Regras de download` com os cinco
      controles e os botões `Salvar` e `Liberar espaço agora`.
- [ ] Marcar `Pausar downloads` e salvar faz aparecer a faixa `Fila pausada`, e
      um capítulo pedido nesse estado fica em `Na fila` sem nunca virar
      `Baixando` enquanto a pausa durar.
- [ ] Desmarcar a pausa e salvar tira a faixa, e o capítulo que estava parado
      sai de `Na fila` (vira `Baixando`, `Concluído` ou `Erro`) em até um minuto.
- [ ] Definir uma janela que não inclui o horário atual faz aparecer a faixa
      `Fora da janela (<início>–<fim>)`; apagar os dois campos tira a faixa.
- [ ] Definir `Avisar quando o espaço livre for menor que` num valor maior que o
      disco da máquina faz aparecer a faixa `Pouco espaço em disco` com o espaço
      livre; voltar para 2 tira a faixa.
- [ ] Com pelo menos um capítulo `Concluído` e a cota definida em 1 MB, o cartão
      de espaço mostra `Cota cheia`, `Liberar espaço agora` informa quantos
      capítulos apagou, e a lista perde esses capítulos.
- [ ] Com a cota estourada, pedir um capítulo novo responde
      `{ ok: true, queued: 0, blocked: "quota" }` e não cria linha nova.
- [ ] Os valores salvos continuam valendo depois de recarregar a página e depois
      de reiniciar o servidor.
- [ ] Todos os métodos de `/api/download/settings` respondem 401 sem sessão.

## Como testar (humano)

1. No terminal rode `npm run db:push` e depois `npm run dev -- -p 3100`. Abra
   `http://localhost:3100` e entre com sua conta. (Se precisar de uma conta:
   `npm run user -- add qaburro burro12345`; se disser que já existe, use
   `npm run user -- passwd qaburro burro12345`.)
2. Abra `http://localhost:3100/downloads`. Deve existir um bloco
   `Regras de download` com: cota em MB, dias para apagar, aviso de espaço
   livre, horário de início e fim, e a opção de pausar.
3. Marque `Pausar downloads` e clique em `Salvar`. Deve aparecer uma faixa
   amarela escrito `Fila pausada`.
4. Abra `http://localhost:3100/work/solo-leveling-3w0wvo`, clique no botão
   `Baixar` de um capítulo qualquer da lista e volte para
   `http://localhost:3100/downloads`. O capítulo deve aparecer como `Na fila` e
   continuar assim depois de meio minuto (recarregue a página para conferir).
5. Desmarque `Pausar downloads`, clique em `Salvar` e espere até um minuto. O
   capítulo tem que sair de `Na fila` — pode virar `Baixando`, `Concluído` ou
   `Erro`, qualquer um deles serve.
6. No campo de horário, coloque um intervalo que não inclui a hora de agora (por
   exemplo, se agora são 15h, coloque início `03:00` e fim `04:00`) e clique em
   `Salvar`. Deve aparecer a faixa `Fora da janela (03:00–04:00)`. Apague os dois
   horários e salve de novo: a faixa some.
7. No campo `Avisar quando o espaço livre for menor que`, coloque `99999` e
   salve. Deve aparecer a faixa `Pouco espaço em disco` com quanto ainda há
   livre. Volte para `2` e salve: a faixa some.
8. Se houver algum capítulo `Concluído` na lista, coloque a cota em `1` MB e
   salve: o cartão de cima deve mostrar `Cota cheia`. Clique em
   `Liberar espaço agora`: aparece uma mensagem dizendo quantos capítulos foram
   apagados, e eles somem da lista. Depois volte a cota para `0` e salve.
9. Recarregue a página: todos os valores que você salvou continuam lá.
