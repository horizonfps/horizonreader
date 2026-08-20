---
id: T-013
title: Levar o Continuar da home direto ao capítulo salvo
status: ready
blockedBy: []
files: [src/app/(app)/page.tsx]
---

## O que fazer

A faixa `Continuar` da home deve abrir diretamente o capítulo que está sendo lido, já na página salva, em vez de levar primeiro à página da obra. Cada obra deve aparecer uma vez, representada pelo progresso inacabado atualizado mais recentemente.

## Onde mexer

### `src/app/(app)/page.tsx`

A função `getHistory` hoje consulta `ReadingHistory`, que também contém capítulos concluídos, e monta cartões que apontam para `/work/<slug>`. Passe a consultar `Progress` do usuário com `read = false`, `lastPageRead > 0` e `workId` preenchido, ordenando por `updatedAt` decrescente e incluindo a obra relacionada.

Deduplicate pelo `workId`, mantenha no item o `chapterId` da linha escolhida e preserve título e capa. Na montagem da faixa, o `href` de cada cartão deve ser `/reader/<chapterId>`. O leitor já busca a posição salva desse capítulo, então não replique a lógica de páginas na home.

## Fora do escopo

- Alterar o leitor ou a rota de gravação de progresso.
- Mostrar capítulos concluídos na faixa `Continuar`.
- Criar uma nova lista de histórico recente ou mudar as faixas de favoritos e recomendações.
- Escolher fontes ou resolver obras; a seleção da última fonte na página da obra fica no ticket T-012.

## Pronto quando

- [ ] A faixa `Continuar` só contém obras com `read = false` e `lastPageRead > 0`.
- [ ] Cada obra aparece no máximo uma vez, usando o progresso inacabado mais recentemente atualizado.
- [ ] Clicar em um cartão da faixa abre diretamente `/reader/<chapterId>`, sem passar pela página da obra.
- [ ] O leitor abre o mesmo capítulo na página salva e, portanto, mantém a fonte vinculada àquele `chapterId`.
- [ ] Quando não há progresso inacabado, a faixa `Continuar` não aparece e as demais seções da home continuam funcionando.
- [ ] `npm run build` passa.

## Como testar (humano)

1. Rode `npm run dev -- -p 3100`, abra `http://localhost:3100` e entre na sua conta.
2. Abra Kingdom, entre em um capítulo, avance algumas páginas e volte antes de concluir o capítulo.
3. Volte para a home e localize a faixa `Continuar`. Kingdom deve aparecer uma única vez.
4. Toque na capa de Kingdom. O leitor deve abrir diretamente o capítulo interrompido e começar na página em que você parou.
5. Termine o capítulo e volte para a home. Kingdom não deve mais aparecer na faixa `Continuar`; as outras seções da home devem continuar visíveis.
