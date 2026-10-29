# Changelog

## [Não lançado]

- **Breaking change (#111, ADR-0007 D13):** CLI, `compile`, `verify`, packet and MCP messages are now English, and every error carries a stable code (for example `config.key-unknown` or `verify.docs-outdated`), so an agent can explain it in the user's language. The codes and their meaning are listed in one place, `ERROR_CODES` in `src/contracts/codes.ts` (exported with `ErrorCode`, `AgenticError` and the `formatCoded` formatter by `@agentic-ddd/compiler`). `CompileError` and verify `Finding` gain a required `code` field, which `--json` reports carry. Thrown errors are an `AgenticError` with `code`. Human output prints `message [code]`; warnings and static-test diagnostics, which never fail a command, stay uncoded. Match on the code, not on the text. Packet headings change too (`## Specification`, `## Test obligations`, `## Executor rules`, `## Verification command`), as do the gate names in verify reports. Domain errors from `@agentic-ddd/core` and the `scripts/` tooling are unchanged.

- **Breaking change (#109, ADR-0007 D13):** the text `compile` generates is now English only, with no language option: the dev skills (`<module>-dev`), the operators' runtime skills, the `history.md` and `state-machine.md` references, the `AGENTS.md` block and the generated-file header. The operator runtime's tool descriptions also switch to `When to use:` / `When not to use:`. The core rules (`core/...`) were translated too, but their keys and `{{…}}` markers did not change, so a team rule that overrides one still applies. The proposal section keeps its name, `## Motivo`, and so does the matching history column. Business text (descriptions, invariant `text`, `instructions` and proposals) stays in the author's language. Running `bun run agentic compile` regenerates everything; until then, `compile --check` reports the old generated files. Packets and CLI messages follow in #111.

- **Windows nativo (#128):** o framework passa a funcionar no Windows sem WSL, e o CI ganha o job `ci-windows`, com o mesmo gate do `ci` em `windows-latest`.
  - O `compile` falhava em qualquer projeto: `parseFrame` só reconhecia caminhos POSIX, e todo decorator ficava com origem `<desconhecido>`. Agora ele aceita letra de unidade, UNC e `file:///C:/`.
  - O `compile --check` acusava o espelho de skill desatualizado, porque o `readlink` devolve `\`.
  - O `skills:install` grava os links dos adaptadores com `/`, então o adaptador é idêntico em qualquer sistema. Quem já instalou no Windows precisa remover os adaptadores `agentic-ddd-*` de `.claude/agents`, `.codex/agents` e `.cursor/agents` e rodar `skills:install` de novo, porque o texto antigo conta como conflito.
  - O tutorial `skills:example` grava os caminhos do framework com `/`.
  - O `test:package` extrai o pacote com caminhos relativos, porque o GNU tar do Git Bash lia `C:` como host remoto.
  - Raiz com nome curto 8.3 (como o da pasta temporária dos runners) ou em outro disco: o `compile` importava o domínio com outra instância do registry, e o snapshot do MCP montava caminhos inválidos. Conforme a versão, o Bun grava os frames com o nome curto ou com o longo. Agora `canonicalPath` (de `@agentic-ddd/decorators`) expande só os nomes 8.3, sem trocar drive `subst` ou mapeado pelo destino, e é aplicado uma vez na origem: no arquivo do `captureSource`, na raiz e no `--out-root` do `resolveConfig`, e nas raízes recebidas de fora (`buildIR`, `declarationsInModules`, `checkSnapshot` e caminho absoluto da tool MCP). A raiz do snapshot é resolvida com `resolve`.
  - **Segurança:** `rules.dir` fora da raiz, a tool MCP `rules_for_path` com `..\`, `./../` ou `x/../../` e o `within` do harness de evals aceitavam caminhos fora da raiz, porque a checagem só via um `../` inicial. Agora o caminho é normalizado antes de ser comparado.

- **Mudança de compatibilidade (#110, ADR-0007 D13):** a skill autoral `skills/agentic-ddd` (SKILL.md e referências), os núcleos de papel (`ROLE_CORES`), o texto dos briefs de executor e revisor e os adaptadores instalados por `skills:install` passam a ser só em inglês. Quem tem adaptadores instalados precisa removê-los e reinstalar (o texto antigo conta como conflito). Os briefs e os núcleos ganham a linha que manda manter identificadores, IDs de regra e texto de negócio sem tradução, e a skill manda responder ao usuário no idioma dele. Os rótulos do packet, as mensagens de erro e os tutoriais de exemplo (`tasks`, `matriculas`) não mudam nesta etapa. O texto medido no cycle-21 e no benchmark de revisão muda; o snapshot `agent-briefs` e o hash da árvore do tutorial foram regenerados.

## [0.5.0] — 2026-10-25

Adiciona o modelo tático do domínio (value objects, relações entre agregados, ports e adapters) com gates de verificação, regras do time e servidor MCP local.

Modelo tático do domínio (ADR-0006, #81–#88):

- Saída inalterada para quem não usa a feature (#81): snapshots de `examples/orders` e da fixture `shop` travam árvore gerada, IR e relatórios do `verify`; chave vazia não entra na IR.
- `@AgentValueObject({ description })` em classe que estende `ValueObject` (#82): vira item de domínio `valueobject:<Nome>`, com as invariantes cobertas por `covers`.
- `contains` e `references` em `@AgentEntity` (#83): o dono declara a composição (o contido entra antes do dono no grafo) e a referência a outro agregado por id, sem aresta. A raiz é derivada: a entidade que nenhum `contains` cita.
- `@Invariant` em `@AgentUseCase` (#84): regras que atravessam agregados, como "aluno ativo", com id `invariant:<usecase>/<id>` e obrigação de teste. O finder `invariant` do MCP também procura em use-cases.
- `@AgentPort({ description, root, methods })` em classe abstrata (#85): interface de repositório, com a raiz do agregado e os métodos na IR. `@AgentUseCase({ ports })` leva o port ao packet. Mudar o port exige proposta.
- `@AgentAdapter({ description, implements })` e camada `infrastructure` (#86): implementação de port (`adapter:<Nome>`), com uma obrigação por método do port. Um adapter por port. Gate de escopo de classe para value objects e adapters: o executor altera corpos e campos `#privados`, não decorators, `extends`/`implements` nem a assinatura pública.
- Gates T1 a T3 no `verify --item` (#87): T1 proíbe referência a outro agregado que não seja por id; T2 proíbe value object que referencie entidade; T3 proíbe campo que use value object ou entidade filha fora do `contains` do dono. Só existem em projeto com elemento tático; `status` e `verify NNNN` não os rodam.
- Braço de controle e tutorial `matriculas` (#88, ADR-0006 D10): sete itens com quatro armadilhas e comparação pareada entre o framework completo (F) e um braço sem framework (C0). Tutorial em `bun run skills:example --root <dir> --tutorial matriculas`. O pré-registro do ciclo 22 está em `evals/campaigns/cycle-22-control/`, sem execução real.

Servidor MCP local (#68):

- `agentic-ddd mcp` (stdio, somente leitura) expõe 4 tools sobre o domínio compilado; recusa responder se código, regras, config ou lock mudaram desde o último `compile` bem-sucedido. Subcaminho `./mcp` e peer opcional `@modelcontextprotocol/server@2.3.1`.
- `compile` grava o snapshot `.agentic/mcp/snapshot.json`, ignorado pelo git.
- `skills:install --mcp` (só com `--scope project`) grava a config do servidor para Claude, Cursor e Codex, sem sobrescrever arquivo existente com outro conteúdo.

Regras do time (#66):

- Arquivos `.ai/rules/*.md` (pasta em `rules.dir`) viram regras do projeto: sem `paths` entram em "Convenções" do bloco do AGENTS.md; com `paths` entram no índice "Regras por caminho" do bloco e na seção "Regras do time" das skills de dev que casam. As convenções fixas do bloco viram regras do núcleo (`core/...`): um arquivo com a mesma chave substitui uma, e `rules.exclude` remove. Sem `.ai/rules`, a saída do `compile` não muda.
- Os briefs de executor e revisor (`agent-briefs` e `orchestrate`) recebem as regras do time aplicáveis ao arquivo do item, até `rules.briefMaxTokens` (padrão 2000); acima disso o brief falha em vez de truncar. O núcleo de cada papel ganha uma linha: regra do time nunca vence um gate.

Convenções de layout (#67, ADR-0005 D6):

- `conventions` em `agentic.config.ts` troca o nome da pasta de cada camada, os sufixos de eventos e de operators e os imports proibidos de `domain` e `application`. Sem o campo, vale o padrão de hoje; a camada de um item continua vindo do decorator.

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
- Piloto cycle-21 da campanha de comparação (#36, resultado em `docs/superpowers/validation/2026-10-22-cycle-21/`): classificação S. Sonnet medium sozinho aceitou tanto quanto o roteamento por camada com custo um pouco menor, então o padrão continua o modelo `inherit` com brief e gates; o roteamento fica como experimento e os perfis de modelo no instalador (#33) não serão feitos.
- Decisões em [ADR-0003](docs/adr/ADR-0003.md); pesquisa, spec e plano em `docs/research/` e `docs/superpowers/`.

Veja [docs/releases/0.5.0.md](docs/releases/0.5.0.md).

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
[0.5.0]: https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/releases/tag/v0.5.0
