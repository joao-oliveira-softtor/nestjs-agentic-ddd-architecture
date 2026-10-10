# Roadmap público

## v0.1.0 — Base implementada

Primeira release GitHub dos quatro planos do marco interno v0: compilador, changes/verificação, coordenação e runtime/Nest. Veja [release](releases/0.1.0.md), [changelog](../CHANGELOG.md) e [índice dos planos](superpowers/plans/2026-10-06-v0-00-index.md).

A spec histórica chamou as extensões futuras de v0.1. Para evitar confusão com a primeira release pública v0.1.0, os próximos trabalhos passam a ser acompanhados pelas versões e milestones desta página, sem reescrever o histórico de decisões.

## v0.2.0 — Validação com agentes reais

[Milestone](https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/milestone/1). Objetivo: desenvolver e operar um domínio com agentes reais, medindo resultados contra os contratos do framework. As issues são propostas a refinar; cada implementação exige spec/plano sobre o código real. Não há prazo prometido.

| Plano                                                   | Issue                                                                                   | Dependência |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------- |
| Plano 5 — Skill do framework e agentes gerente/executor | [#5](https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/issues/5) | Base v0.1.0 |
| Plano 6 — Runner de avaliações com agentes reais        | [#6](https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/issues/6) | #5          |
| Plano 7 — Primeiro adapter real de LlmPort              | [#7](https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/issues/7) | Base v0.1.0 |
| Plano 8 — Demonstração CLI com LLM real e aprovação     | [#8](https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/issues/8) | #7          |

O Plano 5 tem [spec](superpowers/specs/2026-10-08-v0-05-agent-skills-design.md) e [plano de execução](superpowers/plans/2026-10-08-v0-05-agent-skills.md) versionados. O Plano 6 tem [spec](superpowers/specs/2026-10-08-v0-06-agent-evals-design.md), [plano](superpowers/plans/2026-10-08-v0-06-agent-evals.md) e [referência real com limitações de orçamento e protocolo](superpowers/validation/2026-10-09-plan6.md); sua implementação é integrada pela [PR #16](https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/pull/16). Os Planos 7–8 formam outra frente: primeiro o adapter, depois a experiência de operação por CLI.

## Ciclo de avaliações #17–#20

Sequência: #17 → #18 e #19 → #20; retomar Planos 7–8 após as campanhas. [Registro e critérios](superpowers/validation/2026-10-10-evals-cycle.md).

| Issue | Entrega | Estado |
| --- | --- | --- |
| [#17](https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/issues/17) | Dois manifestos de certificação, SHA fixo, 15 sessões/45 min cada | Certificada: ambos 5/5 packets e verify done; [evidências](superpowers/validation/2026-10-10-evals-17/real/README.md) |
| [#18](https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/issues/18) | Dataset adicional com 20 casos e julgamento offline estrito | Verificada offline; integração pendente |
| [#19](https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/issues/19) | 25 regressões no percurso completo e oráculos com múltiplos valores | Verificada offline; integração pendente |
| [#20](https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/issues/20) | Agregador offline e seis posições de campanha | Agregador verificado; runs reais pendentes |

O ciclo preserva o dataset original e a referência real anterior. Manifestos de campanha usam 25 perguntas e cinco packets por run. O orçamento proposto de 35 sessões/45 min por run (210 sessões/270 min no total) requer autorização separada; nenhuma campanha é iniciada automaticamente.

## Backlog — Extensões e distribuição

[Milestone](https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/milestone/2). Sem versão ou prazo comprometidos.

- [#9 — Gerar testes de contrato das máquinas de estado](https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/issues/9)
- [#10 — Operators reativos a eventos com fila e proteção contra cascata](https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/issues/10)
- [#11 — Canal HTTP genérico para executar operators](https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/issues/11)
- [#12 — Suportar múltiplas propostas abertas sem reconciliar ambiguamente](https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/issues/12)
- [#13 — Distribuição npm e smoke test em projeto consumidor](https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/issues/13)

## Critério para iniciar um plano

- Refinar objetivo, escopo, critérios de aceite e dependências da issue.
- Conferir as interfaces e garantias atuais; preservar fronteiras, hashes e ausência de evidência para done.
- Versionar spec e plano; declarações de negócio novas exigem proposal antes do código.
- Executar com testes e validações apropriadas e registrar decisões/progresso.

O canal HTTP exige revisão explícita do gate que hoje proíbe qualquer @Controller. `reactsTo` exige fila, evitando publicação reentrante. Distribuição npm exige smoke em consumidor sem aliases locais. Essas decisões fazem parte das respectivas issues, não de alterações implícitas nesta release.
