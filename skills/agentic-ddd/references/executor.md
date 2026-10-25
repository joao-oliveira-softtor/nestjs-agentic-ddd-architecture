# Executor

Para um item `domain` recebido como brief, siga [executor-domain.md](executor-domain.md): ele dispensa a skill do módulo e mantém o executor sem contexto de outras camadas.

Receba packet completo, hash original, configuração, raiz, limites de arquivos/corpos e critérios automáticos. Leia a skill gerada do módulo e os contratos referenciados no packet. Se faltar informação necessária, devolva o item ao gerente com o dado faltante.

- Altere somente o corpo atribuído e arquivos de testes permitidos. Preserve imports, assinaturas, decorators, schemas, IDs, propostas (abertas ou arquivadas), configuração, infraestrutura (exceto num item `adapter:`, que é a própria infraestrutura) e gerados. Não implemente dependências ou outros itens. Preserve edições de outros agentes no workspace.
- O compilador atual inclui coordenadas de fonte nos gerados. Preserve a contagem de linhas do corpo para não deslocar declarações seguintes; use o espaço preparado no esqueleto e conserve linhas vazias restantes. Não reformate o arquivo inteiro. Se o espaço for insuficiente, devolva ao gerente para preparar/recompilar o esqueleto antes de redispatchar. Body-only pode preservar hash e ainda deslocar source: isso reprova `compile --check` e pode tornar a skill de runtime obsoleta.
- Item de classe (`valueobject:`/`adapter:`): o escopo é a classe do item (corpos e membros `#privados`, mesma quantidade de linhas), sem mudar `extends`/`implements` nem a assinatura pública.
- Um operator declarativo já está implementado; acrescente somente testes que exercitem suas tools e contratos. Não invente um corpo para ele.
- Escreva testes `bun:test` com `covers([...ids], título)` de `@agentic-ddd/testing` para obrigações e critérios automáticos do packet. Teste comportamento positivo, regras e transições inválidas pertinentes. Implemente o corpo preservando a especificação.
- Execute o comando **exato** de `verify --item <item> --spec-hash <hash-original>` do packet (inclusive `--config`). Nunca substitua o hash. Registre stdout/stderr, código de saída, gates/findings e erros de importação/coleta JUnit; ausência de coleta não significa sucesso.
- Dependência pendente, divergência de hash ou necessidade de import/declaração/infra/config fora do contrato devolvem o item ao gerente. Após duas correções consecutivas sem progresso nos findings, encerre esta execução e devolva diagnóstico. Não contorne falhas removendo regras ou cobertura.
- Só resultado `done` conclui o item. `needs-human` pertence à change e é tratado pelo gerente.

Devolva item, hash original, comando e código de saída, status, arquivos alterados/diff e findings (incluindo coleta), com o impedimento quando houver. Retome com o packet/hash originais. Novo hash exige revisão da especificação pelo gerente. Não execute compile para regenerar contratos no papel de executor.

## Elementos táticos (v0.5)

- O port é contrato: o executor de um item `adapter:` o implementa e nunca o altera.
- O gate T roda no `verify --item` de itens `entity:` e `valueobject:` (detalhes em [authoring.md](authoring.md), "Gate T"); não roda em `adapter:`.
- Só num item `valueobject:` o executor troca o tipo de um membro `#privado` que ele criou. O que é declaração (campo, parameter property, `contains`/`references`, props do VO, port) volta ao gerente: proposta e compile quando a IR muda, novo packet quando o specHash muda.
- Executor guiado só por brief aprende o T pelos achados do `verify`: cada um traz o `fix`.
