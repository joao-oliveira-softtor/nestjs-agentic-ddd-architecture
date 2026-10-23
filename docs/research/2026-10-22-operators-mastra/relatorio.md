# Operators hospedáveis, com o Mastra como host opcional

Pesquisa de 2026-10-22, feita a pedido do usuário: "runtime-agnostic, com possibilidade e retrocompatibilidade com o Mastra; os operators podem ser agentes do Mastra sem acoplar a estrutura ao Mastra". Ela alimenta um ADR futuro de operators hospedáveis, que emenda o [ADR-0004](../../adr/ADR-0004.md):28. A [#7](https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/issues/7), o provider real do `LlmPort`, continua independente.

O processo foi em rodadas:
- rodada 0: fatos do runtime e da API do Mastra;
- rodada 1: quatro propostas;
- rodada 2: dois juízes;
- rodada 3: spikes em Bun 1.4.3 e Node 24.19, com `@mastra/core` 1.79.0 e um modelo simulado (`MockLanguageModelV3`, de `ai` 7.0.150), sem rede nem chave;
- rodada 4: dois revisores adversários.

Os scripts de spike não foram versionados; o resultado está abaixo.

## Fatos

- **O nosso runtime** (`src/runtime/run.ts`, `operator-runtime.ts`): o laço chama `LlmPort.complete` a cada turno, e as garantias moram dentro dele:
  - allowlist e validação zod de entrada e saída;
  - aprovação via `ApprovalPort`;
  - limites `maxSteps` e `timeoutMs`;
  - eventos só os declarados em `emits`, carimbados e publicados;
  - DomainError volta ao modelo, e qualquer outro erro derruba o run.

  A montagem recusa uma skill de runtime cujo hash não bate com o da IR. Não há provider real, só `FakeLlm`.
- **O Mastra** (`@mastra/core` 1.79.0, de 2026-10-21; 79 versões minor em 9 meses; `engines` Node >= 22.13; peer zod ^3.25 || ^4):
  - `new Agent({ id, name, instructions, model, tools, defaultOptions, outputProcessors })`;
  - `createTool({ id, description, inputSchema, execute })`, com schemas no formato Standard JSON Schema;
  - aprovação humana nativa, que exige storage;
  - `MCPClient` e `MCPServer` em `@mastra/mcp` 2.5.0.

## Propostas (rodada 1)

| Proposta | Ideia | Fraqueza |
|---|---|---|
| A, Mastra só como camada de modelo | `MastraLlm implements LlmPort`; o laço continua sendo o nosso | O operator não vira um `Agent` do Mastra (sem Studio, sem workflows) |
| B, projeção para `Agent` | Cada operator vira um `Agent`; cada use-case, uma tool que chama um núcleo neutro de garantias | Os limites de laço dependem de quem chama o `Agent` |
| C, porta de runtime | Um contrato `AgentRuntime` com duas implementações | Dois laços para manter; os passos do Mastra não equivalem aos nossos |
| D, protocolo (MCP) | Use-cases expostos por MCP, consumidos pelo `MCPClient` | As garantias de laço ficam do lado do cliente; contraria o ADR-0005 D7/D8 |

Os dois juízes ordenaram **B > A > C > D** e recomendaram a base B mais o núcleo de garantias extraído da C.

## Spikes (rodadas 3 e 4)

| # | Hipótese | Resultado |
|---|---|---|
| H1 | O Mastra roda em Bun 1.4 | Confirmada: o mesmo resultado em Bun e Node |
| H2 | `Agent` funciona sem `new Mastra(...)` | Confirmada |
| H3 | O `execute(input, ctx)` recebe ids | Confirmada: `ctx.agent.toolCallId`, `ctx.runId` (fora do tipo público), `ctx.abortSignal` e `ctx.requestContext` |
| H4 | Um `throw` no `execute` derruba o run | **Refutada:** o erro volta ao modelo e o laço continua |
| H5 | Tool sem `execute` devolve a chamada a quem chamou | Confirmada: `finishReason 'tool-calls'`, `toolCalls [{toolCallId, toolName, args}]` |
| H6 | Dá para distinguir o limite de passos | Confirmada |
| H7 | O `abortSignal` cancela | Confirmada: o `generate` termina com `finishReason 'aborted'` em vez de lançar erro |
| H8 | O schema zod chega ao modelo como JSON Schema | Confirmada |
| H9 | O resultado traz os tokens usados | Confirmada: `usage` com input, output, total, reasoning e cached |
| H10 | `processToolResult` aborta o run antes do próximo turno | Confirmada: `tripwire {reason, processorId}`, uma única chamada ao modelo |
| H11 | `defaultOptions` com `maxSteps` e `toolCallConcurrency: 1` vale por padrão | Confirmada |
| H12 | Quem chama o `generate` consegue sobrescrever o `maxSteps` | Confirmada: os limites de laço são um padrão forte, não uma garantia absoluta |
| H13 | Tool desconhecida não executa | Confirmada |
| H14 | `defaultOptions` como função roda a cada `generate`, e o `runId` que ela devolve chega a `ctx.runId` | Confirmada, inclusive quando quem chama passa outro `runId` |
| H14d | Um `requestContext` novo, devolvido pelo `defaultOptions`, chega à tool | **Refutada** quando quem chama passa o próprio `requestContext`: por isso o escopo fica ligado ao `runId` |
| H15 | Um Standard Schema "passa tudo" entrega o JSON Schema da IR e não valida | Confirmada: o input inválido chega cru ao `execute`, e a validação fica só do nosso lado |
| rev | `modelSettings.timeout` numérico | Quebra o `generate`: o formato certo é `{ totalMs }` |
| rev | Depois do `totalMs`, uma tool em andamento continua rodando | Confirmada: o prazo precisa ser imposto dentro do `invoke` |

## Solução final

1. **`src/runtime/invoke.ts` (neutro), extraído de `run.ts:119-229`:** `invoke(name, rawInput, { runId, stepId, deadline, trace })` devolve `result | fatal | timeout`.
   - Aplica allowlist, zod, aprovação via `ApprovalPort`, `execute`, saída, DomainError e `emits`, com o carimbo e o publish.
   - O prazo envolve a aprovação, o `execute` e cada publish.
   - O laço nativo passa a usá-lo sem mudar os testes atuais.
2. **`OperatorRuntime.invoker(name)`**, só leitura. O `llm` passa a ser opcional (`run()` sem ele lança erro claro). O `forFeature` exporta um token nomeado `OPERATORS_REGISTERED`.
3. **`@agentic-ddd/mastra`**, com `@mastra/core` como peer opcional `>=1.79.0 <2` e devDependency exata. `toMastraAgent(runtime, operator, { model })` devolve um `Agent` comum:
   - **`defaultOptions` é uma função** que gera o `runId` e grava um escopo `{ deadline, fatal, fila }` num Map do adaptador. Os escopos vencidos são varridos, porque nenhum run vive além do `timeoutMs`. Ela devolve `{ runId, maxSteps, toolCallConcurrency: 1, modelSettings: { timeout: { totalMs } } }`.
   - **Tools:** schema "passa tudo" com o JSON Schema da IR.
     - O `execute` procura o escopo pelo `runId`; escopo ausente ou vencido é recusado (fail-closed).
     - As chamadas são enfileiradas uma de cada vez e passam pelo `invoke`.
     - O resultado volta como valor, nunca como `throw`: `{ error: { code, message } }` para erro, e um marcador para fatal.
   - **Processor `guard`:** aborta o run no marcador de fatal.
4. **Suíte de contrato** rodando nos dois hosts (`FakeLlm` e `MockLanguageModelV3`). Cobre: tool permitida e desconhecida, input inválido, aprovação, DomainError, fatal e evento não declarado sem efeito novo, timeout com aprovação lenta, concorrência sobrescrita, `runId` do chamador, limite de passos e `stream`.
5. **Garantias:**
   - **Absolutas:** só use-cases declarados, schemas, aprovação, eventos, nada depois do prazo, uma tool por vez e nada depois de um fatal.
   - **Padrão forte:** o limite de turnos do modelo e o encerramento imediato, porque quem chama pode sobrescrevê-los (H12). Mesmo assim, nenhum efeito novo acontece.

Fora: `AgentRuntime` genérico, servidor MCP que executa use-cases, `operatorAsMastraTool`, e aprovação, memória e storage nativos do Mastra. O `MastraLlm` é uma opção da #7.

**Hosts em outra linguagem** (ex.: Laravel AI SDK, em PHP) entrariam por um servidor de tools autenticado que chama o mesmo `invoke`. Isso exige uma decisão nova sobre MCP de execução, porque o ADR-0005 só prevê MCP de leitura.

## Não confirmado

- O uso no Studio e em workflows.
- O Mastra com storage e memória junto do `invoke`.
- Se o `runId` do `defaultOptions` continua prevalecendo em versões futuras. A suíte de contrato vigia isso, e o fail-closed cobre se mudar.
