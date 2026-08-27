---
id: T-028
title: Limitar a velocidade de download e quantos capítulos baixam ao mesmo tempo
status: ready
blockedBy: [T-027]
files: [prisma/schema.prisma, src/lib/downloadPolicy.ts, src/lib/downloads.ts, src/app/api/download/settings/route.ts, src/components/DownloadRules.tsx, src/components/DownloadsPanel.tsx]
---

## O que fazer

Hoje a fila de download não tem freio: ela baixa um capítulo por vez, mas puxa
quatro páginas ao mesmo tempo na velocidade máxima que a internet der, e não há
como pedir para ir mais devagar (o que derruba a navegação de quem está usando a
mesma rede) nem para ir mais rápido (baixar vários capítulos de uma vez).

Passa a existir, em `Regras de download` na tela `Downloads`, três controles
novos: **Velocidade máxima (KB/s)**, **Capítulos ao mesmo tempo** e
**Páginas ao mesmo tempo**. E, no cartão de espaço lá em cima, uma linha
**Velocidade agora** mostrando quanto a fila está puxando neste instante — é por
ela que dá para ver o freio funcionando.

## Onde mexer

### `prisma/schema.prisma`

`model DownloadPolicy` ganha três campos (depois rode `npm run db:push`):

```prisma
maxKbps          Int @default(0) // 0 = sem limite
parallelChapters Int @default(1)
parallelPages    Int @default(4)
```

### `src/lib/downloadPolicy.ts`

`Policy`, `DEFAULT_POLICY`, `getPolicy()` e `savePolicy()` ganham os três campos.
Em `savePolicy`, além do `intOr` já usado, limite os valores:
`parallelChapters` entre 1 e 4, `parallelPages` entre 1 e 8, `maxKbps` ≥ 0
(0 = sem limite). Um valor fora da faixa é preso na borda, não rejeitado.
`queueGate` não muda.

### `src/lib/downloads.ts`

**Freio de velocidade.** Duas coisas novas no topo do módulo:

```ts
let nextSlotAt = 0;

async function spendBandwidth(bytes: number, limitBps: number): Promise<void> {
  if (limitBps <= 0 || bytes <= 0) return;
  const now = Date.now();
  const start = Math.max(nextSlotAt, now);
  nextSlotAt = start + (bytes / limitBps) * 1000;
  const wait = start - now;
  if (wait > 0) await sleep(Math.min(wait, 30_000));
}
```

`storePage` passa a receber o limite em bytes por segundo
(`policy.maxKbps * 1024`) e, **só quando a página veio da rede** (não quando veio
de `getDiskImage` em `download` ou em `page`), chama
`await spendBandwidth(body.byteLength, limitBps)` depois de gravar em disco. O
`downloadChapter` lê a política uma vez no começo e repassa o limite.

**Medidor de velocidade.** Uma janela deslizante de 10 s no módulo:

```ts
const speedWindow: { at: number; bytes: number }[] = [];
function recordBytes(n: number): void   // empurra { at: Date.now(), bytes: n } e descarta o que passou de 10 s
export function currentSpeedBps(): number // total da janela dividido pelo tempo dela, 0 quando vazia
```

`recordBytes` é chamado no mesmo ponto do `spendBandwidth` (só bytes vindos da
rede). `downloadsSnapshot()` devolve um campo novo `speedBps: currentSpeedBps()`.

**Capítulos ao mesmo tempo.** Hoje `runQueue()` é um laço único protegido pela
variável `running`, com um `Set` de `skipped` para as linhas que sumiram entre a
escolha e a reserva. Troque por N trabalhadores:

```ts
let active = 0;

async function chapterWorker(): Promise<void> {
  try {
    for (;;) {
      const row = await prisma.chapterDownload
        .findFirst({ where: { status: "QUEUED" }, orderBy: { createdAt: "asc" } })
        .catch(() => null);
      if (!row) return;

      await enforceStorage();
      if (!queueGate(await getPolicy(), await freeBytesOnDownloadDisk()).open) {
        scheduleRetry();
        return;
      }

      // Reserva atômica: só um trabalhador consegue virar a linha para RUNNING.
      const claimed = await prisma.chapterDownload
        .updateMany({
          where: { chapterId: row.chapterId, status: "QUEUED" },
          data: { status: "RUNNING", error: null },
        })
        .catch(() => null);
      if (!claimed || claimed.count !== 1) continue;

      try {
        await downloadChapter(row.chapterId);
      } catch (e) {
        await prisma.chapterDownload
          .update({
            where: { chapterId: row.chapterId },
            data: { status: "ERROR", error: String((e as Error)?.message || e).slice(0, 200) },
          })
          .catch(() => null);
      }
    }
  } catch {
    /* a fila nunca derruba o processo */
  }
}

export async function runQueue(): Promise<void> {
  const policy = await getPolicy();
  const want = Math.max(1, Math.min(4, policy.parallelChapters));
  while (active < want) {
    active += 1;
    void chapterWorker().finally(() => {
      active -= 1;
    });
  }
}
```

O `Set` de `skipped` e a variável `running` deixam de existir: a reserva por
`updateMany` já resolve os dois casos (linha apagada e linha tomada por outro
trabalhador), e uma linha que não pôde ser reservada nunca volta a aparecer no
`findFirst` seguinte.

**Páginas ao mesmo tempo.** Em `downloadChapter`, a constante `CONCURRENCY`
deixa de mandar: use `Math.max(1, Math.min(8, policy.parallelPages))` da política
lida no começo da função. `ATTEMPTS`, `PAGE_TIMEOUT_MS` e `CHAPTER_DEADLINE_MS`
ficam como estão.

### `src/app/api/download/settings/route.ts`

Em `parsePolicy`, acrescente `maxKbps`, `parallelChapters` e `parallelPages`
(mesmo padrão `Number(...)` dos outros campos numéricos). O `PUT` já chama
`void runQueue()` no fim, então mudar o número de capítulos simultâneos passa a
valer na hora.

### `src/components/DownloadRules.tsx`

Três campos novos na grade, no mesmo padrão dos que existem:

- `Velocidade máxima (KB/s)`, apoio `0 = sem limite`;
- `Capítulos ao mesmo tempo`, apoio `1 a 4`;
- `Páginas ao mesmo tempo`, apoio `1 a 8`.

O tipo `Policy` exportado daqui ganha os três, e o `PUT` manda os três.

### `src/components/DownloadsPanel.tsx`

O tipo `Snapshot` ganha `speedBps: number`. No cartão de cima (o que mostra
`Downloads ocupam …`), acrescente na linha de números
`Velocidade agora {rate(data?.speedBps)}` — `rate` vem de
`@/components/info/ui`, de onde o arquivo já importa `bytes` e `pct`.

## Fora do escopo

- Cota de espaço (global ou por usuário): é o T-027.
- Limitar a velocidade do leitor, do proxy de imagens ou do aquecimento de
  páginas — o freio é só da fila de download.
- Prioridade de fila (escolher qual capítulo baixa antes).
- Limite de velocidade diferente por usuário ou por horário.

## Pronto quando

- [ ] `npm run build` passa e `npm run db:push` aplica o esquema sem erro.
- [ ] Em `Regras de download` existem os campos `Velocidade máxima (KB/s)`,
      `Capítulos ao mesmo tempo` e `Páginas ao mesmo tempo`, e o valor salvo em
      cada um continua lá depois de recarregar a página.
- [ ] Salvar `Capítulos ao mesmo tempo` como `3` e enfileirar seis capítulos faz
      aparecerem **três** capítulos com o estado `Baixando` ao mesmo tempo na
      lista.
- [ ] Salvar `Capítulos ao mesmo tempo` como `1` e enfileirar seis capítulos faz
      aparecer **um só** com o estado `Baixando` de cada vez.
- [ ] Com `Velocidade máxima` em `200`, a linha `Velocidade agora` do cartão de
      cima fica abaixo de `250 KB/s` enquanto a fila baixa.
- [ ] Com `Velocidade máxima` em `0`, os capítulos terminam de baixar e nenhuma
      linha fica presa em `Baixando` para sempre.
- [ ] Um valor absurdo (`99`) em `Capítulos ao mesmo tempo` é salvo como `4`.

## Como testar (humano)

1. No terminal, dentro da pasta do projeto, rode `npm run db:push` e depois
   `npm run dev -- -p 3100`. Abra `http://localhost:3100` e entre com sua conta.
   (Se precisar de uma conta: `npm run user -- add qaburro burro12345`; se disser
   que já existe, use `npm run user -- passwd qaburro burro12345`.)
2. Abra `http://localhost:3100/downloads` e ache o bloco `Regras de download`.
   Escreva `200` em `Velocidade máxima (KB/s)`, `1` em `Capítulos ao mesmo tempo`
   e clique em `Salvar`.
3. Abra uma obra qualquer, use `Escolher intervalo` e mande baixar seis
   capítulos.
4. Volte para `http://localhost:3100/downloads`. Só **um** capítulo por vez pode
   estar escrito `Baixando`.
5. Olhe a linha `Velocidade agora` no cartão de cima: enquanto estiver baixando,
   o número tem que ficar abaixo de `250 KB/s`.
6. Ainda nessa tela, troque `Capítulos ao mesmo tempo` para `3`, `Velocidade
   máxima` para `0` e clique em `Salvar`.
7. Em poucos segundos, **três** capítulos ao mesmo tempo têm que aparecer
   escritos `Baixando`, e a velocidade mostrada tem que subir bem acima de
   `250 KB/s`.
8. Espere a fila terminar: todos os seis capítulos têm que acabar em `Concluído`
   (ou `Erro`, se a fonte falhar), nenhum pode ficar preso em `Baixando`.
9. Escreva `99` em `Capítulos ao mesmo tempo`, clique em `Salvar` e recarregue a
   página: o campo tem que mostrar `4`.
