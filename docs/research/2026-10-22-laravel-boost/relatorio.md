# Laravel Boost aplicado ao agentic-ddd

Pesquisa da issue [#65](https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/issues/65), épico [#70](https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/issues/70). Decisões em [ADR-0005](../../adr/ADR-0005.md). Fontes lidas em 2026-10-22.

**Resumo.** O Boost separa três camadas de contexto: **guidelines** do ecossistema, sempre carregadas e substituíveis pelo projeto; **skills** sob demanda; e **rules** do time, versionadas, filtradas por glob de caminho e indexadas. Ele também expõe um **servidor MCP local** (stdio) com ferramentas de consulta da aplicação. O agentic-ddd já tem o equivalente às guidelines (bloco gerado do `AGENTS.md`) e às skills (skills de dev e de runtime geradas da IR), mas com convenções fixas no código e sem regras do time nem API de consulta. As peças que valem copiar são as rules por caminho com índice, o override por caminho ou nome e o MCP somente leitura. O Search Docs (serviço hospedado) e as ferramentas que tocam banco e logs não se aplicam.

## Limitação desta pesquisa

O GitHub ficou inacessível desta máquina durante a pesquisa (timeout em `github.com`, `api.github.com` e `raw.githubusercontent.com`). Só a documentação oficial do Boost foi lida; o código de `laravel/boost` não. Tudo que depende do código está em [Não confirmado](#não-confirmado).

## Laravel Boost, camada a camada

Fonte de toda esta seção: <https://laravel.com/docs/boost> (Laravel 13.x).

| Camada | Como funciona | Status |
|---|---|---|
| Guidelines | Arquivos em `.ai/guidelines/*` (`.md` ou `.blade.php`). Arquivo do projeto com o mesmo caminho relativo de um embutido o substitui (exemplo da doc: `.ai/guidelines/inertia-react/2/forms.blade.php`). Há guidelines por pacote e versão (core, 10.x, 11.x) e condicionais (ex.: "Enforce Tests"). Pacotes de terceiros publicam `resources/boost/guidelines/core.blade.php`. | Confirmado |
| Escrita no `AGENTS.md`/`CLAUDE.md` | Se o arquivo já existe, o Boost troca só o conteúdo do bloco `<laravel-boost-guidelines>` e preserva o texto fora dele. | Confirmado |
| Skills | `.ai/skills/{nome}/SKILL.md` com `name` e `description`, carregadas sob demanda. Skill do projeto com o mesmo nome substitui a do Boost. Pacotes publicam `resources/boost/skills/{nome}/SKILL.md`. Contratos por agente: `SupportsGuidelines`, `SupportsMcp`, `SupportsSkills`. | Confirmado; diretórios por agente não confirmados |
| Rules do projeto | `.ai/rules/*.md` com frontmatter `paths:` (globs) e um `.ai/rules/index.md` (tabela glob → arquivo). Os agentes são instruídos a consultar o índice antes de planejar ou editar. A tool MCP `record-rule` (`glob`, `title`, `note`) grava a regra e regenera o índice; regra escrita à mão só é descoberta depois de regenerar o índice. `BOOST_RULES_ENABLED=false` desliga tudo. A skill `infer-conventions` propõe regras a partir do código. | Confirmado |
| Contexto | Guidelines ficam sempre presentes (amplas e fundamentais); skills só quando relevantes, "reducing context bloat"; rules só quando o glob bate. A doc pede guidelines de pacote concisas, sem limite numérico. | Confirmado (sem números) |
| MCP | Stdio local, `php artisan boost:mcp`. 10 tools: Application Info, Browser Logs, Database Connections, Database Query, Database Schema, Get Absolute URL, Last Error, Read Log Entries, Record Rule, Search Docs. Não há transporte HTTP na doc. | Confirmado; a #65 citava Tinker desligado por padrão, mas ele não aparece na doc atual |
| Search Docs | Consulta um serviço de documentação hospedado pela Laravel (mais de 17 mil itens, busca semântica) a partir dos pacotes instalados. | Confirmado; o que sai da máquina não está documentado |
| Atualização | `php artisan boost:update` (pode ir no `post-update-cmd` do Composer) atualiza guidelines e skills pelos pacotes instalados; `--no-discover` desliga a descoberta de pacotes novos. | Confirmado |
| Git | A doc sugere ignorar `.mcp.json`, `CLAUDE.md`, `AGENTS.md` e `boost.json` (regenerados), e versionar `.ai/rules`. Guidelines e skills do Boost descrevem o ecossistema; rules descrevem a aplicação do time. | Confirmado |

## Hoje no agentic-ddd

Conferido em `origin/main` `4de7c53`.

- **Bloco gerado do `AGENTS.md`:** `renderAgentsBlock` (`src/compiler/render/agents-md.ts:13-55`) escreve só entre os marcadores e preserva o texto do usuário, como o Boost. As convenções estão fixas no código (`agents-md.ts:40-49`), sem forma de o time trocar ou excluir uma.
- **Caminhos por camada fixos:** a tabela "Como estender" da skill de dev (`src/compiler/render/dev-skill.ts:186-214`) monta `<módulo>/domain`, `<módulo>/application`, `<módulo>/operators/<nome>.operator.ts` e `<agregado>.events.ts`.
- **Imports por camada fixos:** `OUTER_LAYERS` em `scripts/boundary-gates.ts:142-146`.
- **Briefs:** núcleos de papel lidos de `skills/agentic-ddd/references/*.md` (`scripts/agent-briefs.ts:44-80`); nenhum conteúdo do time entra no brief.
- **Configuração:** `AgenticConfig` (`src/compiler/config.ts:17-24`) tem só `root`, `modules`, `out`, `mirrors`, `changes` e `verify`.
- **Instalação por agente:** `scripts/install-skills.ts` instala a skill autoral e os papéis em `.claude`, `.agents`, `.cursor` e `.codex`, sempre com `model: inherit`.
- **Consulta da IR:** existe `agentic ir` (`src/cli/commands/ir.ts`), que imprime a IR inteira; não há consulta por pergunta.

## MCP: SDK, transporte e clientes

| Fato | Fonte |
|---|---|
| SDK v1: `@modelcontextprotocol/sdk` 1.32.1 (`latest`), 17 dependências de runtime (express, hono, jose, ajv, cors...), node>=18, 4,49 MB | <https://registry.npmjs.org/@modelcontextprotocol/sdk/latest> |
| SDK v2: `@modelcontextprotocol/server` 2.3.1, só `zod` ^4.2.0 e `@modelcontextprotocol/core` como dependências, node>=20, 6,49 MB; "stable release line implementing the 2026-07-28 spec", roda em Node, Bun e Deno | <https://registry.npmjs.org/@modelcontextprotocol/server/latest>, <https://ts.sdk.modelcontextprotocol.io/v2/> |
| Servidor stdio no v2: `serveStdio(() => new McpServer(...))` com `registerTool(nome, { description, inputSchema }, handler)` | <https://ts.sdk.modelcontextprotocol.io/v2/> |
| Transportes padrão: stdio e Streamable HTTP (um endpoint POST; resposta JSON ou SSE); servidor valida `Origin` e, local, escuta só em 127.0.0.1; a revisão 2026-07-28 removeu o GET stream e as sessões | <https://modelcontextprotocol.io/specification/latest/basic/transports/streamable-http> |
| Autorização é opcional; em stdio a spec diz para não usar OAuth e ler credenciais do ambiente; em HTTP com auth: Protected Resource Metadata (RFC 9728), 401 com `WWW-Authenticate`, OAuth 2.1 com PKCE, `resource` (RFC 8707) e validação de audiência | <https://modelcontextprotocol.io/specification/latest/basic/authorization> |
| Claude (custom connectors): OAuth não é obrigatório ("No sign in" existe); o servidor precisa ser público porque quem conecta é a nuvem da Anthropic | <https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp> |
| ChatGPT (developer mode): streaming HTTP ou SSE, com OAuth, sem auth ou misto | <https://developers.openai.com/api/docs/guides/developer-mode> (lido por resumo de busca) |
| Registro stdio: Claude Code `claude mcp add` ou `.mcp.json` (escopo de projeto, pede aprovação); Codex `[mcp_servers.<nome>]` em `.codex/config.toml` (projeto confiável); Cursor `.cursor/mcp.json` | <https://code.claude.com/docs/en/mcp>, <https://developers.openai.com/codex/mcp>, <https://cursor.com/docs/mcp> (os dois últimos por resumo de busca) |
| `@mastra/mcp` 2.5.0 embrulha o SDK v2 e exige `@mastra/core` como peer | <https://registry.npmjs.org/@mastra/mcp/latest> |

## O que adotar, adaptar ou descartar

| Peça do Boost | Decisão | Por quê |
|---|---|---|
| Guidelines com override por caminho | Adaptar: núcleo do framework em arquivos, override por caminho, exclusão por chave | Hoje as convenções estão fixas em `agents-md.ts`; o time não consegue trocá-las |
| Bloco gerado no `AGENTS.md` | Já existe | `renderAgentsBlock` |
| Skills sob demanda com override por nome | Já existe em parte (skills geradas por módulo e operator) | Override por nome só faz sentido para a skill autoral; fica fora |
| Rules do projeto com `paths:` e índice | Adotar, com índice gerado pelo `compile` e não por tool | Mantém o determinismo do framework (`compile --check` detecta índice velho) e não exige MCP com escrita |
| `record-rule` (tool de escrita) | Descartar | O MCP do agentic-ddd é somente leitura (#68); a regra é escrita como arquivo e entra no `compile` |
| `infer-conventions` | Fora de escopo agora | Seria inferência por LLM; o framework não gera texto por LLM (ADR-0003 D4) |
| MCP stdio local | Adotar sobre a IR compilada | Consulta por pergunta em vez de skill inteira |
| Tools de banco, logs e browser | Descartar | O MCP do agentic-ddd não executa código nem lê dados de execução |
| Search Docs hospedado | Descartar | Envia dados para fora e não há serviço equivalente |
| Atualização por comando | Já existe: `compile` e `skills:install` | — |

## Não confirmado

- Ordem exata de composição das guidelines (`src/Install/GuidelineComposer.php`) e a exclusão por chave em configuração: a doc não cita; o código não foi lido.
- Diretórios de instalação de skills por agente no Boost.
- Quais tools do Boost são estritamente só leitura e se o MCP é restrito a ambiente local/debug.
- O que o Search Docs envia para fora.
- Anotação `readOnlyHint` nas tools no schema atual da spec MCP (página deu timeout).
- Transportes aceitos pelos custom connectors do Claude e planos do ChatGPT que liberam o developer mode.

Os itens desta lista afetam só detalhes de implementação: `readOnlyHint` e os arquivos de MCP do Codex e do Cursor na #68, os transportes dos connectors na #69. A exclusão de regra por chave do ADR-0005 D2 é desenho próprio, não cópia do Boost.
