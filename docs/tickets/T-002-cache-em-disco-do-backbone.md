---
id: T-002
title: Guardar em disco as respostas do MangaDex e do Comick, servindo velho enquanto revalida
status: ready
blockedBy: []
files: [src/lib/backbone/httpCache.ts, src/lib/backbone/mangadex.ts, src/lib/backbone/comick.ts]
---

## O que fazer

Todas as chamadas ao MangaDex e ao Comick hoje são feitas com cache desligado, e
o MangaDex ainda serializa cada chamada com uma pausa de 220 ms entre elas. Ou
seja: rolar a mesma lista duas vezes = duas viagens até o site de origem; e
reiniciar o app apaga o pouco que existia em memória.

Depois deste ticket cada resposta em JSON dessas duas fontes é gravada em disco,
com prazo de validade por tipo de chamada (listagem vale pouco tempo, ficha de
obra vale muito). Quando o prazo vence, o site continua respondendo na hora com
o conteúdo guardado e busca a versão nova por trás. Efeito visível: a segunda
visita a qualquer lista é instantânea, reiniciar o app não zera nada, e o site
continua navegável mesmo com a internet fora do ar ou o MangaDex indisponível.

## Onde mexer

**`src/lib/backbone/httpCache.ts`** (arquivo novo). Siga o padrão de persistência
que o projeto já usa em `src/lib/scrapers/solverMemory.ts` e
`src/lib/diskCache.ts`: pasta em `/data` quando ela existe, senão `.cache`;
escrita em nome temporário seguida de `rename`; todo erro engolido.

Exporte uma função só:

```ts
cachedJson<T>(key: string, ttlMs: number, load: () => Promise<T | null>): Promise<T | null>
```

Comportamento exigido:

- Tier de memória (Map com teto de entradas, 500) na frente do tier de disco.
  O disco fica em `BACKBONE_CACHE_DIR || (existsSync("/data") ? "/data/jsoncache" : ".cache/json")`,
  um arquivo por chave nomeado pelo sha1 da chave, conteúdo
  `{ v: 1, at: <epoch ms>, data: <payload> }`.
- Entrada mais nova que `ttlMs`: devolve na hora, sem chamar `load`.
- Entrada mais velha que `ttlMs`: devolve a entrada mesmo assim e dispara
  `load()` em segundo plano para atualizar (uma revalidação por chave por vez;
  segure as concorrentes num Map de in-flight, igual ao que
  `src/lib/backbone/resolve.ts` faz em `inFlightResolves`).
- Sem entrada: aguarda `load()`.
- `load()` que devolve `null`/`undefined` nunca é gravado. Nesse caso devolve a
  entrada velha, se houver, senão `null`. É isso que mantém o site de pé quando
  a origem cai.
- Entrada com mais de 30 dias é ignorada na leitura.
- Sweep de disco jogado fora do caminho da requisição e limitado por tempo
  (no máximo uma varredura a cada 10 minutos), apagando arquivo com mais de 30
  dias e, se passar de 20 000 arquivos, os mais antigos primeiro.

**`src/lib/backbone/mangadex.ts`** (li inteiro, 311 linhas): a função privada
`getJson(path, timeoutMs)` é o funil por onde toda chamada passa (inclusive
`mdxJson`, usado fora do arquivo).

- Envolva o corpo atual de `getJson` num `load` e passe por `cachedJson` com
  chave `` `mdx:${path}` ``.
- **Armadilha:** o `await schedule()` (o gate de 220 ms, `MIN_GAP`) tem que ficar
  DENTRO do `load`. Se ficar fora, acerto de cache continua pagando a fila e o
  ticket não entrega nada.
- Prazo por rota, numa função `ttlFor(path)` no próprio arquivo:
  - `/manga/tag` → 7 dias
  - `/statistics/manga…` → 1 hora
  - `/manga/<uuid>/aggregate…` → 6 horas
  - `/manga/<uuid>` (ficha de obra, sem ser listagem) → 12 horas
  - qualquer outra coisa (listagem e busca, que é `/manga?…`) → 30 minutos
- O contrato de `getJson` não muda: continua devolvendo `null` quando não dá.

**`src/lib/backbone/comick.ts`** (li inteiro, 293 linhas): passe cada chamada de
rede pelo `cachedJson`, sempre guardando o JSON cru e fazendo o mapeamento
(`toItems`, `toBackboneWork`, `comickGenres`…) depois do cache, nunca antes.

- `getComickTop`: chave `comick:top`, 1 hora. **Apague** o `topCache` e o
  `TOP_TTL` que existem hoje no topo do arquivo — `cachedJson` já faz esse
  papel, inclusive a parte de devolver o valor velho quando a API falha.
- `getComickTrending`: chave `` `comick:trending:${reqDay}:${opts.comic_types ?? "all"}` ``,
  1 hora. Guarde o `data` cru; a escolha do bucket por `day` continua fora do
  cache.
- `getComickGenres`: chave `comick:genres`, 7 dias.
- `getComickContentInfo`: chave `` `comick:info:${id}` ``, 12 horas. Só grave
  quando a resposta tem `comic`.
- `searchComick`: chave `` `comick:search:${limit}:${query.toLowerCase()}` ``,
  30 minutos. Só grave quando a resposta é um array.
- O caminho de fallback por solver (`searchViaFlareSolverr`) continua igual; ele
  roda dentro do `load`, então o resultado dele também é aproveitado pelo cache.

Comentários novos em inglês, curtos.

## Fora do escopo

- Mexer no cache de 1 hora em memória de `src/lib/backbone/sections.ts`. Ele
  continua como está; passa a ser reconstruído barato porque as chamadas por
  baixo agora vêm do disco.
- Persistir resultado de busca do Suwayomi ou dos scrapers nativos.
- Persistir lista de capítulos (é o T-004).
- Gravar `Work` no banco a partir das listas (é o T-003).
- Mostrar o tamanho desse cache no painel `/info`.

## Pronto quando

- [ ] `cachedJson` existe em `src/lib/backbone/httpCache.ts` com tier de memória
      + disco, revalidação em segundo plano deduplicada por chave, e nunca grava
      resultado nulo.
- [ ] Em `mangadex.ts`, `await schedule()` só é executado dentro do `load` do
      cache (acerto de cache não passa pelo gate de 220 ms).
- [ ] `ttlFor` cobre as cinco famílias de rota listadas acima.
- [ ] `comick.ts` não tem mais as variáveis `topCache`/`TOP_TTL`; todas as cinco
      funções de rede passam por `cachedJson`.
- [ ] Depois de abrir a home uma vez, existem arquivos na pasta do cache
      (`.cache/json` fora do Docker, `/data/jsoncache` dentro).
- [ ] Com a internet do computador desligada, a home aberta antes continua
      mostrando as listas (podem estar desatualizadas) em vez de ficar vazia.
- [ ] `npm run build` passa.

## Como testar (humano)

1. Suba o app e abra a home. Espere todas as fileiras de capas aparecerem.
2. Abra a pasta `data` dentro da pasta do projeto: tem que ter surgido uma pasta
   nova com arquivos de dados (nomes compridos de letras e números).
3. Reinicie o app (`docker compose restart web`) e abra a home de novo. As
   fileiras têm que aparecer bem mais rápido do que na primeira vez.
4. Desligue a internet do computador (tire o wi-fi/cabo) e recarregue a home. As
   fileiras de "Populares", "Best New Comics" e "Recém-completos" ainda têm que
   aparecer. Religue a internet depois.
5. Abra a busca e procure um título que você já tinha buscado antes: o resultado
   tem que voltar quase instantâneo.
