# AGENTS.md

Este repositório é o framework `@agentic-ddd` (em `src/`) e o app de exemplo `examples/orders`.

## Desenvolvimento do framework

- Runtime, testes e build: Bun (`bun test`, `bun run typecheck`, `bun run lint`, `bun run build`).
- Design: `docs/superpowers/specs/2026-10-06-agentic-ddd-v0-design.md`; decisões: `docs/adr/ADR-0001.md`; planos: `docs/superpowers/plans/`.
- `examples/**` importa o framework só via `@agentic-ddd/*`; `src/core` só importa `zod`.
- Testes com `bun:test`; snapshots em `__snapshots__/` são revisados como código.

## Skill autoral e agentes

- A skill do framework tem fonte autoral em `skills/agentic-ddd/`; ela orienta autoria e papéis gerente/executor. As skills `<módulo>-dev` e de runtime são geradas e descrevem o domínio.
- Instale com `bun run skills:install` (projeto/todos), `--scope user` (global explícito), `--target cursor|codex|claude|all`, `--root <raiz>` e `--check`. Links dependem da permanência deste checkout.
- `.agents/skills/agentic-ddd` e `.claude/skills/agentic-ddd` são links autorais instalados, preservados por compile. Adaptadores em `.cursor/agents`, `.codex/agents` e `.claude/agents` são instalados pelo script; altere a fonte ou o instalador, respeitando conflitos ao reinstalar.
- Tutorial isolado: `bun run skills:example --root <destino-inexistente>`; percurso em `skills/agentic-ddd/references/tutorial.md`. Não evolua orders para validar essa skill.

<!-- agentic-ddd:begin -->
<!-- GERADO por agentic-ddd compile — não edite este bloco; o texto fora dele é seu. -->

## Domínio (agentic-ddd)

| Módulo | Código | Skill de dev |
|---|---|---|
| orders | `examples/orders` | `.agents/skills/orders-dev/SKILL.md` |

| Operator | Skill de runtime |
|---|---|
| order-operator | `.agentic/runtime/order-operator/SKILL.md` |

### Convenções

- Entidades, métodos, eventos, use-cases e operators são declarados com `@AgentEntity`, `@AgentMethod`, `@AgentEvent`, `@AgentUseCase` e `@Operator` de `@agentic-ddd/decorators`; cada regra de negócio é um `@Invariant({ id, text })` com ID estável.
- Onde criar: `<caminho do módulo>/domain` (entidades, eventos, ports), `<caminho do módulo>/application` (use-cases, sempre com `uses`), `<caminho do módulo>/operators` (operators). A skill de dev do módulo tem os caminhos exatos.
- Todo método público de entidade tem `@AgentMethod`; métodos auxiliares usam `#privado`.
- Corpo declarado e ainda não implementado usa `notImplemented()` de `@agentic-ddd/core`.
- Coordenação: consulte `bun run agentic status` ou `next` (ondas); execute cada item a partir de `bun run agentic packet <item>` e valide com `bun run agentic verify --item <item> --spec-hash <hash>`. `status --static` lê declarações de teste sem executá-las e nunca certifica `done`.
- O sinal de esqueleto reconhece só a chamada literal `notImplemented()`; corpo vazio conta como implementado. Estado é calculado sob demanda e não entra nos arquivos gerados.
- Testes declaram o que cobrem com `covers([...ids], título)` de `@agentic-ddd/testing`.
- Mudança de regra de negócio: escreva antes a proposta em `changes/NNNN-<slug>/proposal.md` (delta, critérios de aceite e `## Motivo`), implemente e rode `bun run agentic compile`; para mudança já feita no código, `bun run agentic compile --draft-change <slug>` gera o rascunho.
- Uma tarefa só está concluída quando `bun run agentic verify <NNNN>` retorna `done` ou `needs-human`.
- Gerados (não edite): `.agents/skills`, `.agentic/runtime`, os espelhos de skills e este bloco. Altere o código decorado e rode `bun run agentic compile`; o CI roda `bun run agentic compile --check`.
<!-- agentic-ddd:end -->
