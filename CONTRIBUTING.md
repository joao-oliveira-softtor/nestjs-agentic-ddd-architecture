# Contribuindo

## Ambiente

- [Bun](https://bun.sh) 1.4.2: `bun install`.
- Antes de abrir um PR: `bun run typecheck && bun run lint && bun test && bun run build && bun run agentic compile --check`.

## Como trabalhamos

- **TDD:** escreva o teste que falha, implemente o mínimo, refatore. Testes usam `bun:test`.
- **Snapshots** (`__snapshots__/`) são código: revise o diff deles no PR.
- **Testes de domínio** declaram o que cobrem com `covers([...ids], título)` de `@agentic-ddd/testing`.
- **Arquivos gerados** (`.agents/skills/`, `.claude/skills/`, `.agentic/`, bloco do `AGENTS.md`) nunca são editados à mão: altere o código decorado e rode `bun run agentic compile`.
- **Imports:** relativos **sem** extensão (`./entity`; o `tsconfig` usa `moduleResolution: "bundler"`); `examples/**` só importa o framework via `@agentic-ddd/*`; tipos em assinaturas de classes decoradas usam `import type`.
- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/pt-br/) em português (`feat(compiler): …`, `fix(core): …`), pequenos e atômicos.
- **Mudança de regra de negócio:** abra a proposta em `changes/NNNN-<slug>/proposal.md` antes do código (ou gere o rascunho com `bun run agentic compile --draft-change <slug>`), implemente com testes `covers` para as regras e os critérios, rode `bun run agentic compile` e só considere a tarefa pronta quando `bun run agentic verify <NNNN>` retornar `done` ou `needs-human`.

## Design

Mudanças de arquitetura começam pela spec (`docs/superpowers/specs/`) e pelo ADR (`docs/adr/`).
