---
id: T-015
title: Abrir a página do capítulo em tela cheia com zoom e fechar clicando fora
status: ready
blockedBy: []
files: [src/components/Reader.tsx]
---

## O que fazer

No leitor, dar dois cliques (ou dois toques) em uma página abre essa página numa camada escura em cima de tudo, ocupando a tela inteira. Nessa camada dá para ampliar e reduzir a imagem (botões `+` e `−`, roda do mouse, pinça de dois dedos e duplo clique) e arrastar a imagem quando ela está ampliada. Clicar na área escura em volta da imagem fecha a camada e devolve a leitura de onde estava; a tecla `Esc` também fecha.

Além do duplo clique, quando as barras do leitor estão visíveis aparece um botão `Ampliar` na barra de cima que abre a mesma camada com a página atual — é o caminho descoberto por quem não adivinha o duplo clique.

## Onde mexer

Tudo acontece em `src/components/Reader.tsx`, o componente cliente que já desenha os dois modos de leitura.

### Estado novo

Acrescente ao componente `Reader`: `zoomIndex: number | null` (índice da página aberta na camada), `scale: number` (começa em 1), e `offset: { x: number; y: number }` (começa em 0/0). Uma função `openZoom(i: number)` seta `zoomIndex = i`, zera `scale`/`offset` e chama `setShowUI(false)`; `closeZoom()` volta `zoomIndex` para `null`.

### Como abrir

- Modo vertical: o `<div key={i} data-idx={i} ref={…}>` que envolve cada `PageImage` ganha `onDoubleClick={() => openZoom(i)}`.
- Modo paginado: o `<div className="h-full w-full" onClick={onTapZones}>` ganha `onDoubleClick={() => openZoom(page)}`.
- Barra superior (bloco `showUI`): um botão `Ampliar` ao lado do botão `Ajustes`, chamando `openZoom(page)`.

O clique simples continua fazendo o que já faz (alternar as barras e, no modo paginado, virar página). Como um duplo clique dispara o clique simples antes, `openZoom` esconder as barras é o que evita a camada abrir com a barra por cima.

### A camada

Renderize o overlay como irmão dos outros blocos dentro do `<div className="relative h-[100dvh] …">`, só quando `zoomIndex !== null`, com `className="absolute inset-0 z-50 flex items-center justify-center overflow-hidden bg-black/95"` e `onClick={closeZoom}` (clique no fundo fecha).

Dentro dele, um wrapper com `onClick={(e) => e.stopPropagation()}` (clique na imagem não fecha) contendo um `<img>` com `src={pageUrls[zoomIndex]}`, `draggable={false}`, `className="max-h-[100dvh] max-w-full select-none object-contain"` e `style={{ transform: \`translate(${offset.x}px, ${offset.y}px) scale(${scale})\`, transformOrigin: "center", transition: "none" }}`.

Controles fixos no canto superior direito da camada (`absolute right-3 top-3 z-10 flex gap-2`), cada um com `stopPropagation` no clique: `−` (divide a escala por 1.25), o valor atual em porcentagem funcionando como botão de reset (volta para escala 1 e offset 0/0), `+` (multiplica por 1.25) e `✕` (fecha). Limite a escala entre 1 e 5.

### Gestos

- Roda do mouse: registre o listener num `useEffect` com `addEventListener("wheel", handler, { passive: false })` no elemento da camada (via `ref`) e chame `preventDefault()` — o `onWheel` do React é passivo e não bloqueia a rolagem do capítulo atrás. `deltaY < 0` amplia, `deltaY > 0` reduz, sempre respeitando o limite 1–5.
- Duplo clique sobre a imagem: alterna entre escala 1 e escala 2.5 (sem fechar a camada).
- Arraste com o mouse (`onPointerDown`/`onPointerMove`/`onPointerUp` com `setPointerCapture`): só move o `offset` quando `scale > 1`.
- Pinça: `onTouchStart`/`onTouchMove` na camada; com dois dedos, a escala acompanha a razão entre a distância atual e a distância inicial dos dedos; com um dedo e `scale > 1`, arrasta a imagem. Use `touch-action: none` no wrapper da imagem para o navegador não roubar o gesto.
- `Esc` fecha: `useEffect` com listener de `keydown` enquanto `zoomIndex !== null`.

### Não atrapalhar o que já existe

O `useEffect` do modo paginado que escuta `ArrowRight`/`ArrowLeft` precisa sair cedo (`if (zoomIndex !== null) return`) para as setas não virarem página por trás da camada. Os botões flutuantes de voltar e de ajustes e o painel de ajustes continuam como estão; a camada de zoom fica acima deles (`z-50` contra `z-30`/`z-40`).

## Fora do escopo

- Trocar de página dentro da camada (setas de próxima/anterior no zoom).
- Salvar o nível de zoom entre capítulos ou no `reader:settings`.
- Zoom no modo paginado por padrão (a imagem continua entrando inteira na tela; o zoom é só dentro da camada).
- Mexer na barra inferior, no salvamento de progresso, no pré-carregamento de páginas ou nos botões de download.

## Pronto quando

- [ ] Dois cliques em uma página no modo vertical abrem uma camada escura em tela cheia com aquela mesma página.
- [ ] Com a camada aberta, o botão `+` aumenta a imagem e o `−` reduz, nunca passando de 5x nem ficando abaixo de 1x.
- [ ] O botão do meio mostra a escala atual em porcentagem e, clicado, volta a imagem para 100% e centralizada.
- [ ] Clicar na área escura fora da imagem fecha a camada; clicar sobre a imagem não fecha.
- [ ] Pressionar `Esc` com a camada aberta fecha a camada.
- [ ] Girar a roda do mouse sobre a camada muda a escala e não rola o capítulo por trás.
- [ ] Com a imagem ampliada, arrastar com o botão do mouse (ou com um dedo) move a imagem.
- [ ] Abrir a camada esconde as barras superior e inferior do leitor.
- [ ] Com as barras visíveis existe um botão `Ampliar` que abre a camada na página atual.
- [ ] Com a camada aberta, as setas do teclado não viram página no modo paginado.
- [ ] Fechar a camada mantém o leitor na mesma posição de leitura em que estava.
- [ ] `npm run build` passa.

## Como testar (humano)

1. Rode `npm run dev -- -p 3100`, abra `http://localhost:3100` e entre com sua conta.
2. Abra qualquer obra e clique em um capítulo para entrar no leitor.
3. Dê dois cliques em cima de uma página. A tela deve escurecer e mostrar só aquela página, com os botões `−`, a porcentagem, `+` e `✕` no canto superior direito.
4. Clique em `+` duas vezes: a imagem deve ficar visivelmente maior e a porcentagem deve subir.
5. Segure o botão do mouse sobre a imagem e arraste: a imagem deve se mover junto.
6. Clique na porcentagem no topo: a imagem volta ao tamanho de tela, centralizada.
7. Clique na área escura, longe da imagem: a camada deve fechar e o capítulo continuar na mesma página em que estava.
8. Dê dois cliques numa página de novo e aperte `Esc`: a camada deve fechar.
9. Clique uma vez no meio da tela para aparecerem as barras de cima e de baixo, clique em `Ampliar` na barra de cima: a camada abre com a página atual e as barras somem.
