# Changelog

## [Não lançado]

Runtime dos operators:

- **Mudança de compatibilidade (#63):** o runtime dos operators recusa evento publicado por `ctx.publish` que não esteja em `emits` do use-case (pelo nome da classe, como na IR: subclasse não vale). O use-case termina em `failed/use_case_error`, nada do lote recusado chega ao bus e as publicações seguintes da mesma chamada também são recusadas, mesmo que o use-case engula o erro. `emits` omitido vale `[]`, então use-case sem `emits` que publique algo passa a falhar. O `compile` passa a exigir que o `emits` do use-case cubra tudo o que os métodos em `uses` emitem, para o erro aparecer no build e não depois de o use-case gravar dados. `createTestContext` continua aceitando qualquer evento.

Orquestração de agentes por camada e modelo (épico #26). Tudo offline: nenhuma inferência real foi executada, e as rotas `--real` exigem orçamento autorizado.

- `agentic-ddd packet <item> --static` gera o packet sem executar a suíte de testes e nunca certifica `done`.
- `scripts/agent-briefs.ts` renderiza, sem LLM, um brief determinístico por item a partir do packet; o executor de domínio recebe só o contrato do item, e o revisor tem relatório JSON validado (`scripts/reviewer-report.ts`).
- `scripts/boundary-gates.ts` confere só-corpo, contagem de linhas e direção de import por camada.
- `scripts/orchestrate.ts`: driver sequencial com roteamento por camada (Haiku no domínio, Sonnet em application e operators), uma retentativa por nível, escalação e `needs-human`, orçamento de invocações e de tokens medidos, revisão Opus opcional e telemetria JSONL. O modo padrão só planeja.
- Harness de avaliação: adapter `claude-cli` (uso somado de `modelUsage`; custo derivado não adotado), `promptMode` `brief` no benchmark de implementação e benchmark de revisão com as 19 regressões plantadas e controles limpos.
- Claude pela assinatura do Claude Code (#36): `authentication: oauth-token` no harness (`CLAUDE_CODE_OAUTH_TOKEN`, gerado por `claude setup-token`), e o driver e o benchmark de revisão usam o token quando ele existe, com `--safe-mode` no lugar de `--bare`, `HOME` temporário e sem variáveis que cobrem pela API. O `apiKeySource` do CLI é registrado e uma origem de chave de API reprova a execução; o token é redigido nos artefatos. Dependência de desenvolvimento nova: `ts-pattern`.
- Roteamento por camada no harness (#36): `routing` na configuração (modelo por camada, escada com esforço por degrau e revisor), escalação com a mesma política do driver (`decideAttempt`), revisão em contexto de leitura com a última invocação do teto reservada para ela, e manifesto sem datasets de skill. Codex e Cursor recusam trocar de modelo por pedido.
- `bun run evals:session-cost <id-da-sessão | caminho .jsonl>` lê o transcript local de uma sessão do Claude Code e dos seus subagentes e imprime tokens por categoria e custo por grupo e por modelo; o custo é derivado de `evals/pricing.json` (equivalente de API, não cobrança) e é limite inferior (`≥`: chamadas auxiliares do CLI não entram no transcript e a saída de subagente é provisória), sem chamar a API.
- Decisões em [ADR-0003](docs/adr/ADR-0003.md); pesquisa, spec e plano em `docs/research/` e `docs/superpowers/`. Os perfis de modelo no instalador (#33) e a campanha de comparação (#36) seguem pendentes.

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
