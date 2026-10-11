# Changelog

## [0.4.0] — 2026-10-10

Adiciona distribuição por tarball instalável em aplicações externas, com seis fronteiras públicas e a CLI agentic-ddd.

- Biblioteca ESM modular, declarações TypeScript e source maps; exports de core, decorators, compiler, runtime, nestjs e testing.
- Transformação dos imports e instruções de CLI antes da emissão, preservando mappings e registry/tokens compartilhados.
- CLI instalável, allowlist auditada do tarball e smoke com npm em consumidor isolado, sem aliases do checkout. NodeNext/bundler com skipLibCheck false; geração/check de skills, DI e bundle com hash/localização iguais.
- CI inclui o smoke do pacote. evals:aggregate e o ciclo de avaliações v0.3.0 preservados.

**Mudança de build:** bun run build passa a gerar biblioteca/CLI; a aplicação demonstrativa usa bun run build:app antes de start:prod.

Tarball publicado como asset GitHub; publicação no registro npm permanece bloqueada por private: true e prepublishOnly. O nome do pacote segue provisório.

Veja [instalação e validação](docs/releases/0.4.0.md) e [compatibilidade](docs/distribution.md).

## [0.3.0] — 2026-10-10

Publica os Planos 5–6 e o ciclo de avaliações #17–#20, com evidências de agentes reais e comparação descritiva entre execuções independentes.

- Skill autoral do framework, agentes gerente/executor e tutorial tasks isolado, com instalação para Codex, Cursor e Claude.
- Runner de avaliações com adapters nativos, isolamento de workspaces, orçamento, auditoria de submissões e oráculos independentes; CI e testes padrão offline.
- Certificação #17: Codex e Cursor aceitam cinco packets e obtêm verify 0001 done.
- Dataset adicional de 20 casos, julgamento literal/tool_call estrito com AJV e 25 regressões no percurso completo contra falso done.
- Agregador offline valida hashes, recalcula métricas pelas evidências e preserva proveniência, cobertura e resultados parciais.
- Campanha #20: seis runs/150 perguntas; Codex 72/75 e 3/3 certificações, Cursor 70/75 e 2/3. Consumo de 184 sessões/76,8 minutos; run parcial preservado, sem repetição extra ou reparo manual.
- Framework público, orders, dataset original e evidências históricas preservados.

Distribuição pelo código-fonte GitHub. Adapter real de LlmPort e CLI de runtime continuam nos Planos 7–8; o runtime demonstrativo permanece com FakeLlm. Custos e medições incompletas continuam indisponíveis.

Veja [demonstração e validação](docs/releases/0.3.0.md) e [campanha completa](docs/superpowers/validation/2026-10-10-evals-20/real/README.md).

## [0.1.0] — 2026-10-08

Primeira release de código-fonte do `@agentic-ddd`, publicando os quatro planos do marco de design v0.

### Entregas

- Building blocks DDD e decorators para entidades, métodos, invariantes, eventos, use-cases e operators.
- Compilador determinístico de IR, schemas, skills de dev/runtime e bloco de `AGENTS.md`, com `compile --check`.
- Lock, propostas de mudança, reconciliação, histórico, cobertura por `covers` e verificação G1–G7.
- Coordenação por `status`, `next`, `packet` e `verify --item`, com proteção por `specHash` e consultas antes de existirem testes.
- Runtime sequencial com FakeLlm, aprovação, validação Zod, eventos, IDs, traces e limites; contexto inválido retorna `invalid_context`.
- Composição Nest de operators/use-cases e exemplo orders, preservando o isolamento do domínio e BunAdapter.
- E2E de criação/confirmação de pedido, aprovação negada/concedida, coordenação em quatro ondas e inicialização do bundle.

### Limites desta release

- Runtime demonstrado com FakeLlm; adapter de provider real e CLI interativa estão nos próximos planos.
- Timeout fecha a admissão de tools/publicações, mas não interrompe à força nem desfaz operações já iniciadas.
- Bundle requer o source map para preservar localização e hash das declarações.
- Publicação reentrante no mesmo bus durante um handler é rejeitada; `reactsTo` por fila está no backlog.
- A change de exemplo 0002 mantém um critério manual de copy, demonstrando `needs-human` apenas por G6. Isso não representa falha automática nem cancelamento da release.
- Distribuição nesta versão é pelo código-fonte GitHub; instalação como pacote npm possui issue de preparação própria.

Veja [demonstração e validação](docs/releases/0.1.0.md) e [roadmap](docs/ROADMAP.md).

[0.1.0]: https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/releases/tag/v0.1.0

[0.3.0]: https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/releases/tag/v0.3.0

[0.4.0]: https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/releases/tag/v0.4.0
