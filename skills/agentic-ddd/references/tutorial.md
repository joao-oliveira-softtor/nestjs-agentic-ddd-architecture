# Tutorial tasks

Pré-requisitos: Bun e checkout permanente do framework. A instalação usa aliases e dependências desse checkout; não é smoke de distribuição npm.

```bash
# No checkout do framework:
bun install --frozen-lockfile
bun run skills:example --root /tmp/agentic-tasks
cd /tmp/agentic-tasks
bun run typecheck
bun run agentic compile
bun run agentic status --json
bun run agentic next --change 0001 --json
bun run agentic packet entity:Task > /tmp/task-packet.md
```

Escolha destino inexistente: o gerador recusa pastas existentes, inclusive vazias. Ele escreve proposta antes das declarações e prepara imports/infra/config, corpos com `notImplemented()` e nenhum teste. Compile aplica e arquiva a proposta em `changes/archive/0001-tasks/proposal.md` antes de implementar os corpos: consulte os critérios ali. Não edite o arquivo arquivado.

Sem testes, status/next/packet funcionam e não certificam done. A ordem inicial é `entity:Task` → `method:Task.complete`/`usecase:create_task` → `usecase:complete_task` → `operator:task-operator`. O gerente entrega um packet por vez com hash original, configuração, limites e critérios. O executor preenche somente o corpo correspondente e testes `app/test/*.test.ts`; todos os imports necessários já foram preparados. Use as linhas vazias reservadas nos corpos e preserve sua contagem: source nos gerados depende da posição dos decorators seguintes. Se faltar espaço, devolva ao gerente para preparar/recompilar o esqueleto; não reformate o arquivo inteiro. Factory inclui regra de título e TaskCreated; conclusão inclui transição/erro de repetição e TaskCompleted; use-cases persistem e publicam; operator recebe somente teste de execução das tools, por exemplo com OperatorRuntime e FakeLlm.

```bash
# Copie o hash real do packet; mantenha-o na retomada:
bun run agentic verify --item entity:Task --spec-hash <hash-original> --config agentic.config.ts --json
bun run agentic next --change 0001 --json
# Repita packet → corpo/testes → verify para o próximo item da primeira onda.
bun run agentic compile --check
bun run agentic verify 0001
```

Use `test(covers([...ids-do-packet], 'comportamento observado'), ...)` de `@agentic-ddd/testing`, incluindo os critérios automáticos entregues pelo gerente como `criterion:0001/<id>`. Após arquivar a proposta, o packet atual pode omitir esses critérios; o gerente deve entregá-los consultando archive. Cada item exige dependências done, corpo implementado, hash original, obrigações passando e typecheck real. Ao completar os cinco itens, verify 0001 deve retornar done. Corpo/testes preservam hash, lock e skills quando as coordenadas das declarações são mantidas; mudança de regra/decorator reprova o hash antigo e exige retorno ao gerente.

Falhas e retomada: corpo pendente falha I2; testes ausentes/falhos falham I4; dependência pendente falha I1; contrato alterado falha I3; typecheck falha I5. Erro de importação/coleta JUnit pode encerrar o comando sem relatório de gates: registre stderr e devolva o finding. Preserve packet/hash originais. Após duas correções sem progresso, devolva ao gerente. Static nunca certifica done. O gerente revisa diff, repete verify individual e recalcula next; needs-human é somente aceite manual da change.

Para smoke real, crie uma cópia nova para cada ambiente, inicialize Git e capture baseline após compile. Entregue packet integral e instruções do executor na sessão principal ou no adaptador nativo. Guarde versão, modelo efetivo (metadados da sessão), hash original, diff e relatório independente de verify. Se faltar autenticação/ferramenta, registre pendência; não substitua o smoke por respostas simuladas. Claude nesta entrega é validado estaticamente.
