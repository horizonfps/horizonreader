---
id: T-012
title: Retomar o capítulo na fonte usada e aquecer a fonte escolhida
status: ready
blockedBy: []
files: [src/app/(app)/work/[slug]/page.tsx, src/app/api/warm/route.ts, src/lib/backbone/resolve.ts]
---

## O que fazer

Ao abrir uma obra sem escolher uma fonte manualmente, o app deve reconhecer em qual fonte você deixou um capítulo pela metade e selecionar essa fonte. O botão de leitura da obra deve apontar para o capítulo exato que estava sendo lido, em vez de recomeçar pela fonte principal.

A troca para uma fonte conhecida também deve ser rápida, inclusive para a Comic Asura. O app deve aquecer a lista de capítulos da fonte específica quando você passar o cursor ou tocar no botão dela, sem iniciar uma nova varredura de todas as fontes. Quando a resolução de uma obra já tiver buscado a lista de capítulos, essa lista deve ficar no cache da própria fonte para a próxima abertura.

## Onde mexer

### `src/app/(app)/work/[slug]/page.tsx`

A página já recebe `src`, mostra os botões de fonte e calcula o capítulo inicial a partir de `Progress`, mas hoje só consulta o progresso depois de escolher a fonte principal. Antes de escolher a fonte automática, carregue os progressos inacabados do usuário para a obra e associe cada linha ao `sourceMangaId` dos links disponíveis.

- Quando `src` vier na URL e corresponder a um link da obra, mantenha esse link escolhido, mesmo que exista progresso mais recente em outra fonte.
- Sem `src`, escolha o link que corresponde ao progresso inacabado mais recentemente atualizado. Se não houver correspondência, preserve a escolha atual de fonte principal/mais saudável.
- Depois de escolher o link, use somente o progresso dele para marcar capítulos lidos e definir o botão. Se houver capítulo inacabado com `lastPageRead > 0`, o botão deve dizer `Continuar` e abrir esse `chapterId`. Sem esse progresso, mantenha o comportamento de primeiro capítulo não lido e os textos atuais de início.
- Troque os botões das fontes pelo `PrefetchLink` já existente, mantendo a URL com `src` e o indicador visual da fonte ativa. O aquecimento deve acontecer no cursor e no toque sem alterar a navegação normal.

### `src/app/api/warm/route.ts`

A rota já recebe o endereço de uma obra para aquecer sua resolução geral. Quando o endereço for `/work/<slug>?src=<id>`, valide o slug e busque o `SourceLink` cujo `id` pertence àquela obra. Inicie `refreshChapters` para esse link sem esperar a conclusão antes de responder. Um endereço sem `src`, um link inexistente ou um erro deve continuar usando o aquecimento geral já existente e nunca deve aquecer um link de outra obra.

### `src/lib/backbone/resolve.ts`

Em `syncMatch`, a busca já obtém a lista de capítulos antes de gravar ou atualizar o `SourceLink`. Depois que o link for salvo, grave essa lista no cache de capítulos por link usando as funções já existentes em `src/lib/chapterCache.ts`. Não faça uma segunda busca para preencher o cache e não deixe uma falha de cache impedir que o link continue sendo salvo.

## Fora do escopo

- Alterar a forma como o leitor salva página, capítulo concluído ou configurações de leitura.
- Criar uma nova tela de seleção de fontes ou mudar a ordem de saúde das fontes.
- Fazer a home ganhar um histórico separado de capítulos concluídos; a navegação da home para um capítulo inacabado fica no ticket T-013.
- Instalar ou configurar a extensão da Comic Asura.
- Guardar as imagens das páginas neste fluxo; o cache de imagens existente continua responsável por isso.

## Pronto quando

- [ ] Ao abrir uma obra sem `src`, se houver progresso inacabado associado a uma fonte disponível, essa fonte fica ativa e o botão principal abre o `chapterId` desse progresso.
- [ ] Ao abrir uma obra com `src` válido, a fonte indicada na URL continua ativa e o botão usa apenas o progresso dessa fonte.
- [ ] Sem progresso inacabado compatível, a obra mantém a escolha atual de fonte e o comportamento de primeiro capítulo não lido/começo.
- [ ] Os botões das fontes aquecem a lista da fonte escolhida no cursor ou toque, e a rota de aquecimento responde sem esperar a busca terminar.
- [ ] O aquecimento de uma URL com `src` só usa um `SourceLink` pertencente ao slug informado e não dispara a varredura geral quando esse link existe.
- [ ] Uma lista de capítulos obtida por `syncMatch` é gravada no cache do respectivo `SourceLink` sem repetir a busca e sem transformar falha de cache em falha de resolução.
- [ ] `npm run build` passa.

## Como testar (humano)

1. Rode `npm run dev -- -p 3100`, abra `http://localhost:3100` e entre na sua conta.
2. Abra Kingdom, escolha uma fonte com capítulos, entre em um capítulo e avance algumas páginas. Volte para a página da obra sem chegar ao fim do capítulo.
3. Feche e abra Kingdom novamente sem escolher uma fonte. A fonte usada no passo anterior deve aparecer selecionada e o botão principal deve dizer `Continuar`.
4. Toque no botão `Continuar`. O mesmo capítulo deve abrir na página em que você parou, usando a mesma fonte.
5. Volte à página da obra, escolha outra fonte pelo botão dela e depois volte a abrir a obra sem `src`. A fonte escolhida no passo 4 deve voltar a ser a fonte do progresso mais recente; ao escolher a outra fonte explicitamente, ela deve permanecer selecionada.
6. Na lista de fontes, passe o cursor ou toque em `Comic Asura`, aguarde um instante e clique nela. A fonte deve abrir mostrando seus capítulos, sem iniciar uma nova busca visível de todas as fontes; ao repetir a abertura, a lista deve aparecer imediatamente.
