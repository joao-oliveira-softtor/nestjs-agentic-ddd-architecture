# Changelog

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
