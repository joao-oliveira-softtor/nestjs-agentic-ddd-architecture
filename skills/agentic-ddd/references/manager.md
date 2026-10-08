# Gerente

Leia [autoria](authoring.md) e a configuração real antes de preparar o domínio. Este papel pode editar propostas, declarações, imports, infraestrutura e configuração dentro da tarefa autorizada.

1. Escreva `<changes>/NNNN-<slug>/proposal.md` antes das declarações novas ou modificadas. Prepare contratos completos, schemas, imports, ports, infraestrutura, composição e comandos reais de typecheck/testes. Use `notImplemented()` nos corpos pendentes e reserve linhas para implementação: o compilador inclui source nos gerados, então o executor deve preservar posições das declarações seguintes. Se faltar espaço, prepare/recompile o esqueleto antes do novo handoff e revise a especificação conservando o hash quando ela não mudou.
2. Rode `bun run agentic compile --config <config>`. Consulte propostas abertas **e** `<changes>/archive/NNNN-<slug>/proposal.md`: compile pode arquivar a proposta enquanto corpos ainda estão pendentes.
3. Rode `bun run agentic next --change NNNN --config <config> --json`. Selecione um item da primeira onda executável, obtenha `bun run agentic packet <item> --config <config>` e guarde o packet e hash originais para retomada.
4. Despache **um executor por vez** com packet completo, hash original, caminho/conteúdo da configuração, raiz do workspace, arquivo/método permitido, arquivos de testes permitidos e critérios automáticos relacionados. Inclua os contratos/infra já preparados. Informe que há outros agentes e que deve preservar suas edições. Use o adaptador `agentic-ddd-executor` do ambiente ou entregue à sessão principal; não exija delegação aninhada.
5. Revise o diff contra os limites (somente corpo e testes), o relatório e erros de coleta. Repita exatamente `verify --item` com hash original. Apenas `done` conclui o item. Recalcule `next` após cada item, inclusive ao retomar.
6. Ao esgotar ondas, rode `bun run agentic verify NNNN --config <config>`. Só `done` conclui automaticamente a change. Em `needs-human`, liste os critérios manuais pendentes para o usuário; não marque itens com esse estado.

Se executor devolver dependência pendente, hash divergente, necessidade de edição fora do contrato ou duas tentativas sem progresso, investigue e prepare o contrato antes de redispatchar. Retomada conserva packet/hash originais; hash novo exige revisão explícita da especificação pelo gerente, proposta/compile quando aplicável e novo handoff. Não troque hash só para tornar verify verde.

Formato do handoff: item; packet integral; hash original; config e raiz; limites de arquivos/corpo/testes; critérios automáticos; comando verify do packet. Resultado: status; comando e código de saída; gates/findings/coleta; arquivos alterados e diff; impedimento ou próximo item.
