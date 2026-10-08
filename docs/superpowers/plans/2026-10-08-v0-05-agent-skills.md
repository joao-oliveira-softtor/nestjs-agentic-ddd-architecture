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
- Revisão: edição multiline pode deslocar source nos gerados sem mudar specHash. Dentro das APIs atuais, preparar espaço nos esqueletos, ensinar preservação das linhas e exercitar multiline nos slots; sem espaço, devolver ao gerente. Teste RED: helper multiline exige 6 linhas, esqueleto inicial tinha 0. Propostas arquivadas podem ter critérios omitidos no packet atual; gerente os entrega separadamente.
- Etapas 1–3 concluídas: spec/plano versionados primeiro; instalador/skill/adaptadores e tutorial implementados. Testes focados: instalação 10/10, tutorial 2/2. Typecheck, lint, build, instalação --check, compile --check e quick_validate.py aprovados.
- Revisão independente (gpt-6-astra): um finding importante, estabilidade de source em implementação multiline. Corrigido com slots, contrato explícito e teste RED→GREEN; nenhum outro finding substantivo.
- Etapas 4–5 concluídas: smokes reais Cursor/Codex com hash original, diff revisado, verify independente done e compile --check 0. Cursor retomado com uma correção de espaços; Claude validado estaticamente, smoke adiado por escopo. Suíte final 366 pass/0 fail, 14 snapshots; todos os checks aprovados. [Relatório e evidências](../validation/2026-10-08-plan5.md).
