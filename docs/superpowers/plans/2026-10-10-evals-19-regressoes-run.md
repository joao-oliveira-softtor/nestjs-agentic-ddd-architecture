# #19 — Execução

Spec: [contrato](../specs/2026-10-10-evals-19-regressoes-run.md).

## Passos

Criar test/evals-run.test.ts; testar relatórios persistidos, bloqueio de dependentes/continuidade independente, protocolo/infra/budget/final indisponível; reproduzir lacunas do oráculo e corrigi-las; validar suíte offline.

## Verificação

Testes direcionados, bun test, bun run typecheck, bun run lint, bun run build, bun run agentic compile --check, bun run skills:install --check. Commits separados por entrega; evidências em ../validation/2026-10-10-evals-cycle.md.
