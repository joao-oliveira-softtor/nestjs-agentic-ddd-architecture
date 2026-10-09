# Autoria do domínio

Leia a configuração em uso: `modules[].path` define raiz do módulo; `out.devSkills`, `out.runtimeSkills`, `mirrors`, `changes` e `verify` podem substituir padrões. Consulte `AGENTS.md` e a skill gerada `<módulo>-dev/SKILL.md` nesses caminhos. Não suponha `examples/orders` em consumidores.

Crie entidades, eventos e ports em `<módulo>/domain`, use-cases em `<módulo>/application`, operators em `<módulo>/operators`; infraestrutura/composição segue o projeto. Importe building blocks de `@agentic-ddd/core`, decorators de `@agentic-ddd/decorators`, testes de `@agentic-ddd/testing` e schemas de `zod`.

- `@AgentEntity({ description, states })` declara entidade e estados. Cada regra é `@Invariant({ id, text })`, na classe ou método; preserve IDs kebab-case, gerando obrigações `invariant:Entidade/id`.
- Todo método público de negócio tem `@AgentMethod({ description, emits, transition })`; auxiliares usam `#privado`. Fábrica estática `create` estabelece construção (`entity:Entidade`); métodos são `method:Entidade.nome`. Getters de estado e métodos herdados dos building blocks seguem as convenções existentes.
- `@AgentEvent({ description, payload: z.object(...) })` em classes que estendem `DomainEvent<Payload>` declara eventos; agregados usam `record`/`pullEvents`. Mantenha `emits` coerente nos métodos e use-cases.
- `@AgentUseCase({ name, description, whenToUse, whenNotToUse, input, output, uses, emits })` usa schemas Zod explícitos e tipos `z.infer`. `uses` lista IDs reais como `method:Task.create` e `method:Task.complete`; define dependências. Implemente `UseCase<In, Out>` e `execute(input, ctx)`, injete port de repositório e publique eventos via `ctx.publish`.
- `@Operator({ name, description, instructions, useCases, requiresApproval })` referencia classes de use-case; é declarativo, sem corpo execute obrigatório. Prepare a infraestrutura de execução/teste antes de despachar.
- Corpo ainda pendente: `return notImplemented();` importado de core. Só a chamada literal é reconhecida; corpo vazio conta como implementado. Não substitua por throw genérico ou wrapper.

Antes de mudar regra, escreva proposta no diretório configurado:

```yaml
---
id: "0001"
title: Criar tarefas
status: proposed
origin: proposal-first
delta:
  added: ["entity:Task", "method:Task.create", "invariant:Task/titulo-obrigatorio"]
  modified: []
  removed: []
acceptance:
  - id: titulo-invalido
    covers: ["invariant:Task/titulo-obrigatorio"]
    given: título vazio
    when: criar uma tarefa
    then: rejeita com TASK_TITLE_REQUIRED
---

## Motivo

O usuário precisa de tarefas identificadas com um título válido.
```

Preencha delta completo (eventos/use-cases/operators inclusive) e critérios Given/When/Then automáticos ou `manual: true`. Depois declare e rode `bun run agentic compile --config <config>`. Se código já mudou, `compile --draft-change <slug>` apenas gera rascunho; preencha Motivo/critérios antes de compilar. Compare lock/skills gerados e não os edite.

Testes: `test(covers(['method:Task.create', 'invariant:Task/titulo-obrigatorio', 'criterion:0001/titulo-invalido'], 'rejeita título vazio'), () => { ... });`. IDs do packet determinam obrigações; não use cobertura sem asserções reais.
