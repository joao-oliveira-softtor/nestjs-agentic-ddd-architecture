# Plano 5 — Execução

Spec: [design](../specs/2026-10-08-v0-05-agent-skills-design.md). Issue: [#5](https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/issues/5).

1. Versionar spec/plano antes da implementação. Conferir formatos e interfaces atuais.
2. Escrever testes RED de instalação project/user/all, links, formatos, referências, idempotência/check/conflitos e preservação pelo compilador. Implementar instalador e referências da skill, gerando adaptadores nativos sem configurações/permissões.
3. Escrever testes RED do workspace tasks: recusa de destino, consultas sem testes, quatro camadas de coordenação, testes com covers, hash/gerados estáveis, rejeição de mudança de regra e verify change done. Implementar gerador e tutorial, sem testes aplicados no workspace inicial.
4. Instalar no projeto, ajustar instruções autorais e README. Executar smokes isolados Cursor/Codex, registrar evidências reais ou bloqueios, validar Claude estaticamente.
5. Validar skill com quick_validate.py; typecheck/lint/test/build/compile --check. Revisão final independente e correções verificadas.

## Registro de execução

- Preflight: installer consome fonte da skill; example consome installer e checkout do framework; smokes consomem example e packet. Nenhuma mudança nas APIs do compilador.
- Decisão: trabalhar em branch nova no workspace limpo compartilhado; tutorial/smokes/testes têm isolamento próprio. Não é necessário mover o checkout solicitado.
- Aceite externo depende dos CLIs/autenticação disponíveis; não simular smoke real por teste unitário.
