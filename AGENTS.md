# AGENTS.md

Este repositório é o framework `@agentic-ddd` (em `src/`) e o app de exemplo `examples/orders`.

## Desenvolvimento do framework

- Runtime, testes e build: Bun (`bun test`, `bun run typecheck`, `bun run lint`, `bun run build`).
- Design: `docs/superpowers/specs/2026-10-06-agentic-ddd-v0-design.md`; decisões: `docs/adr/ADR-0001.md`; planos: `docs/superpowers/plans/`.
- `examples/**` importa o framework só via `@agentic-ddd/*`; `src/core` só importa `zod`.
- Testes com `bun:test`; snapshots em `__snapshots__/` são revisados como código.

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
- Testes declaram o que cobrem com `covers([...ids], título)` de `@agentic-ddd/testing`.
- Gerados (não edite): `.agents/skills`, `.agentic/runtime`, os espelhos de skills e este bloco. Altere o código decorado e rode `bun run agentic compile`; o CI roda `bun run agentic compile --check`.
<!-- agentic-ddd:end -->
