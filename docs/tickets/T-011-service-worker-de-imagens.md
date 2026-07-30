---
id: T-011
title: Guardar capas e páginas no próprio navegador com um service worker cache-first
status: ready
blockedBy: []
files: [public/sw.js, src/components/ServiceWorkerRegister.tsx, src/app/layout.tsx, src/middleware.ts]
---

> Rodada de otimização de navegação, segunda leva. Os IDs T-001..T-006 em
> `docs/tickets/` são de rodadas ANTERIORES. Ignore-os: este ticket é o T-011.

## O que fazer

Capas e páginas de capítulo já saem do servidor com cabeçalho de cache longo
(li as duas rotas: `/api/cover` manda `public, max-age=604800, immutable` e
`/api/image` manda `private, max-age=31536000, immutable` para página de
capítulo), mas o navegador do celular descarta esse cache com facilidade.

Depois deste ticket o app instala um service worker que guarda essas duas rotas
de imagem num armazenamento próprio, com estratégia "primeiro o cache", teto de
entradas e limpeza das mais antigas. A segunda visita passa a nem tocar o
servidor para essas imagens.

**Regra dura:** só `/api/cover` e `/api/image` podem ser guardados. Nada de HTML
e nenhuma outra rota de API, porque essas dependem de sessão e guardá-las
serviria conteúdo de um usuário para outro ou quebraria o login.

## Onde mexer

### `public/sw.js` (arquivo novo)

JavaScript puro (não passa pelo TypeScript nem pelo bundler; o Next serve
`public/` como estático, então o arquivo fica em `/sw.js` com escopo `/`).
Comentários em inglês, curtos. Constantes no topo:

```js
const VERSION = "v1";
const CACHE = `hr-img-${VERSION}`;
const MAX_ENTRIES = 900;
```

Comportamento:

- `install`: `self.skipWaiting()`.
- `activate`: apaga todo cache cujo nome começa com `hr-img-` e é diferente de
  `CACHE`, depois `self.clients.claim()`. Tudo dentro de `event.waitUntil`.
  É esse par (`skipWaiting` + `clients.claim` + nome versionado) que evita o
  worker ficar preso numa versão velha: subir uma versão nova do app é bumpar
  `VERSION`. Deixe um comentário de uma linha dizendo isso.
- `fetch`: **só intercepta** quando TODAS estas condições valem, e caso
  contrário sai da função sem chamar `event.respondWith` (deixando o navegador
  fazer o pedido normal):
  - `event.request.method === "GET"`;
  - a URL é da mesma origem (`new URL(event.request.url).origin === self.location.origin`);
  - o `pathname` é exatamente `/api/cover` ou exatamente `/api/image`.
- Estratégia, quando intercepta:
  1. `caches.open(CACHE)`, `cache.match(event.request)`; se achou, devolve.
  2. Senão, `fetch(event.request)`.
  3. Guarda a resposta **só** quando `res.status === 200 && res.type === "basic" && !res.redirected`.
     Isso é o que impede guardar um 401 de sessão expirada ou o redirecionamento
     para a tela de login. Use `res.clone()` para guardar e devolva a original.
  4. Depois de guardar, poda: `cache.keys()` devolve na ordem de inserção;
     se passar de `MAX_ENTRIES`, apague as primeiras
     `keys.length - MAX_ENTRIES`. A gravação e a poda vão dentro de
     `event.waitUntil`, nunca segurando a resposta.
  5. Se o `fetch` falhar (offline), devolve o que estiver no cache; se não
     houver nada, deixe o erro seguir.

### `src/components/ServiceWorkerRegister.tsx` (arquivo novo)

Componente client (`"use client"`), sem marcação: registra o worker e devolve
`null`.

- `useEffect` no mount: sai se `!("serviceWorker" in navigator)`.
- `navigator.serviceWorker.register("/sw.js")`, com `.catch(() => {})`: falha de
  registro (por exemplo em HTTP sem ser localhost) não pode quebrar a página.
- Caminho de atualização: guarde o registro e chame `registration.update()`
  quando a aba volta a ficar visível (listener de `visibilitychange` filtrando
  `document.visibilityState === "visible"`), removendo o listener no cleanup do
  efeito. Sem isso, uma aba aberta há dias nunca busca um worker novo.

### `src/app/layout.tsx` (li inteiro, 26 linhas)

Importe o componente e renderize `<ServiceWorkerRegister />` dentro do `<body>`,
depois de `{children}`. Não mexa em `metadata` nem em `viewport`.

### `src/middleware.ts` (li inteiro, 41 linhas)

O `matcher` da linha 39 hoje exclui `_next/static`, `favicon.ico`,
`manifest.webmanifest`, `icon.svg`, `icon.png`, `apple-icon.png`, `robots.txt` e
`auth-logos`. `/sw.js` não está lá, então o middleware o redireciona para
`/login` quando não há sessão, e o navegador recusa registrar um worker que
respondeu com HTML de redirecionamento. Acrescente `sw.js` à mesma lista de
exclusão. O arquivo não tem segredo nenhum, então servi-lo sem sessão é seguro.

## Fora do escopo

- Manifest de PWA, ícone de instalação, tela de "app instalável", notificação
  push. Aqui é só cache de imagem.
- Página offline, cache de HTML, cache de `/_next/static`, pré-cache na
  instalação.
- Guardar qualquer rota de API que não seja `/api/cover` e `/api/image`.
- Botão de "limpar cache" na interface.
- Mexer em `src/lib/imageCache.ts`, `src/lib/diskCache.ts`,
  `src/lib/coverImage.ts` e nas rotas `/api/cover` e `/api/image`: são a leva
  anterior, já pronta, e os cabeçalhos que elas mandam já servem.
- Trocar as tags `<img>` por `next/image`.

## Pronto quando

- [ ] `public/sw.js` existe, com nome de cache versionado, `skipWaiting` no
      `install` e limpeza de caches antigos + `clients.claim` no `activate`.
- [ ] O handler de `fetch` só chama `respondWith` para GET de mesma origem cujo
      `pathname` seja exatamente `/api/cover` ou `/api/image`; qualquer outra
      requisição passa direto.
- [ ] Resposta só entra no cache quando é 200, de mesma origem e não
      redirecionada.
- [ ] O cache nunca passa de `MAX_ENTRIES`; ao passar, as entradas mais antigas
      são apagadas.
- [ ] `src/components/ServiceWorkerRegister.tsx` registra `/sw.js`, engole erro
      de registro e chama `update()` quando a aba volta a ficar visível.
- [ ] O componente é renderizado no `<body>` de `src/app/layout.tsx`.
- [ ] O `matcher` de `src/middleware.ts` exclui `sw.js`, e abrir `/sw.js` sem
      estar logado devolve o JavaScript do worker, não o HTML do login.
- [ ] Depois de recarregar a página logado, as requisições de capa aparecem
      servidas pelo service worker no painel de rede do navegador.
- [ ] Sair da conta e entrar de novo continua funcionando, e o painel `/info`
      continua mostrando dados atualizados a cada carregamento.
- [ ] `npm run build` passa.

## Como testar (humano)

1. Suba o app e abra o site pelo endereço https do túnel (ou por
   `http://localhost:<porta>`; em qualquer outro endereço sem https o navegador
   recusa o recurso e o teste não vale). Faça login e abra a home.
2. Aperte F12, vá na aba "Application" (ou "Aplicativo"), item "Service
   Workers". Tem que aparecer um item apontando para `/sw.js` com o estado
   "activated and is running".
3. Ainda no F12, vá na aba "Network" (ou "Rede") e recarregue a página. Nas
   linhas das capas, a coluna de tamanho tem que dizer "ServiceWorker" em vez de
   um número de kB.
4. Feche o navegador inteiro, abra de novo e volte para a home: as capas têm que
   aparecer na hora, sem os quadrados cinzas piscando.
5. Abra um capítulo, volte e abra o mesmo capítulo de novo: as páginas já vistas
   aparecem imediatamente.
6. Saia da conta e entre de novo. O login tem que funcionar normalmente e você
   não pode cair numa tela antiga.
7. Abra `/info` duas vezes seguidas: os números (CPU, memória) têm que mudar
   entre uma vez e outra, provando que a página e os dados não foram guardados.
