# @agentic-ddd

Primeira release: [v0.1.0](https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/releases/tag/v0.1.0). [Demonstração reproduzível](docs/releases/0.1.0.md) · [Changelog](CHANGELOG.md) · [Próximos planos e issues](docs/ROADMAP.md).

Framework open-source sobre **NestJS + DDD** em que:

- **use-cases são tools** que um agente de IA pode chamar;
- **operators** (agentes de IA declarativos) substituem os controllers;
- um **compilador** lê entidades, use-cases e operators decorados e gera **skills** (padrão [Agent Skills](https://agentskills.io/specification)) e um **`AGENTS.md`**: skills de _runtime_ para o operator executar o domínio e skills de _dev_ para agentes de código (Claude Code, Codex, Copilot…) manterem o projeto.

O código decorado é a única fonte de verdade: descrição, regra e implementação não divergem, e o CI falha se a documentação gerada estiver desatualizada.

## Como funciona

```
@AgentEntity / @Invariant / @AgentMethod / @AgentEvent / @AgentUseCase / @Operator
        │  (decorators registram metadados + arquivo:linha)
        ▼
   registry ──▶ IR canônica ──▶ validação ──▶ renderers ──▶ .agents/skills/  .agentic/runtime/  AGENTS.md
```

```ts
@AgentEntity({
  description: 'Pedido de compra de um cliente.',
  states: ['pending', 'confirmed', 'cancelled'],
})
@Invariant({
  id: 'ao-menos-um-item',
  text: 'Um pedido precisa ter ao menos um item.',
})
export class Order extends AggregateRoot<string> {
  @AgentMethod({
    description: 'Confirma um pedido pendente.',
    transition: { from: ['pending'], to: 'confirmed' },
    emits: [OrderConfirmed],
  })
  confirm(): void {
    /* … */
  }
}
```

O exemplo completo está em [`examples/orders`](examples/orders); as skills geradas a partir dele estão em [`.agentic/runtime/order-operator`](.agentic/runtime/order-operator/SKILL.md) e [`.agents/skills/orders-dev`](.agents/skills/orders-dev/SKILL.md).

## Quickstart

Requer [Bun](https://bun.sh) 1.4.2.

```bash
bun install
bun test                         # testes
bun run agentic compile          # gera skills e o bloco do AGENTS.md
bun run agentic compile --check  # falha se algo gerado estiver desatualizado (usado no CI)
bun run agentic compile --report # tokens por arquivo e lint das skills
```

## Executar operators com Nest

O runtime carrega a skill gerada e compara seu `ir-hash` com as declarações atuais antes de registrar o operator. `root` (default: cwd) e `modules` precisam corresponder à configuração completa do compilador; `runtimeDir` pode apontar para outra saída de compile. Domínio/application continuam independentes do Nest: [OrdersModule](examples/orders/orders.module.ts) fornece factories com o repository injetado.

```ts
import { Test } from '@nestjs/testing';
import { AgenticModule } from '@agentic-ddd/nestjs';
import { OperatorRuntime } from '@agentic-ddd/runtime';
import { FakeLlm, FakeApproval } from '@agentic-ddd/testing';
import { OrdersModule } from './examples/orders/orders.module';

const llm = new FakeLlm([
  {
    content: [
      {
        type: 'tool_call',
        id: 'create-1',
        name: 'create_order',
        input: {
          order_id: 'order-1',
          customer_id: 'customer-1',
          items: [{ sku: 'SKU', quantity: 1, unit_price: 10 }],
        },
      },
    ],
    stopReason: 'tool_calls',
  },
  { content: [{ type: 'text', text: 'Pedido criado.' }], stopReason: 'end' },
]);
const app = await Test.createTestingModule({
  imports: [
    AgenticModule.forRoot({
      llm,
      approval: new FakeApproval(false),
      modules: [{ name: 'orders', path: 'examples/orders' }],
    }),
    OrdersModule,
  ],
}).compile();
try {
  const result = await app.get(OperatorRuntime).run('order-operator', {
    message: 'Crie o pedido.',
    context: { customer: 'customer-1' },
  });
  console.log(result.status, result.output, result.events);
} finally {
  await app.close();
}
```

`forRoot` exporta `LLM_PORT`, `APPROVAL_PORT`, `EVENT_BUS` e `OperatorRuntime`. `forFeature` recebe `operators`, `useCases` (classes ou providers com token da classe decorada), `providers` auxiliares e `imports` opcionais. Use-cases da allowlist precisam ter instâncias injetadas. Sem ApprovalPort, tools protegidas são negadas; o bus default é `InMemoryEventBus`, com publicação e handlers aguardados em ordem. Publicação reentrante no mesmo bus durante um handler é rejeitada explicitamente para evitar deadlock; reações enfileiradas estão no [backlog](https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/issues/10). `FakeLlm.requests` e `FakeApproval.requests` guardam o histórico para assertions; roteiro esgotado é erro explícito.

O system combina instructions com o corpo da skill; tools incluem propósito, quando usar/não usar e JSON Schema. `context` vira uma mensagem user adicional em JSON. Se a serialização lançar erro ou não produzir JSON (por exemplo bigint, referência circular, função ou símbolo no nível superior), o run retorna `failed / invalid_context` com steps/eventos vazios, antes de chamar o LLM. `providerPayload` do assistant volta intacto no turno seguinte. Cada turno executa tools sequencialmente, valida entrada/saída Zod e devolve todos os resultados em uma única mensagem tool. Sucessos contêm `{ output, events: [{ name, payload }] }`; `unknown_tool`, `invalid_input` (issues Zod), `approval_denied` (motivo) e DomainError são recuperáveis. Aprovação negada nunca chama execute.

O resultado inclui `runId`, operator, status, output textual, steps e eventos. Cada step guarda request, response, tools, política/decisão de aprovação, resultados e eventos. Eventos usam `correlationId = runId` e `causationId = step.id`.

| Término                                                   | Status / reason                |
| --------------------------------------------------------- | ------------------------------ |
| Texto final sem tool_call, stopReason end                 | completed                      |
| Limite de chamadas ao LLM                                 | step_limit                     |
| Deadline do run (inclui LLM, aprovação, execute e bus)    | timeout                        |
| max_tokens / refusal                                      | failed / max_tokens ou refused |
| Exceção do provider                                       | failed / provider_error        |
| Contexto sem representação JSON                           | failed / invalid_context       |
| Bug no use-case, output inválido ou erro de aprovação/bus | failed / use_case_error        |

Timeout impede iniciar novas tools/publicações pelo contexto do run, inclusive após resolução tardia de promises. Não interrompe à força operações já iniciadas nem desfaz efeitos externos: cancelamento dessas operações é cooperativo e depende do adapter/use-case. Um evento entregue a um bus antes do timeout pode terminar de ser processado pelos handlers depois dele. Publicações pelo contexto após retorno do use-case são rejeitadas.

O `AppModule` compõe orders com FakeLlm de roteiro vazio: o v0 não fornece canal HTTP nem provider real. Testes e outros canais chamam o runtime diretamente e fornecem seus roteiros/ports. `main.ts` mantém BunAdapter; o build emite source map, necessário para preservar as localizações das declarações e seus hashes no bundle. Distribua `dist/main.js.map` junto do bundle.

Os [E2E](examples/orders/test/operator.test.ts) compilam a skill e validam criação/confirmação, cancelamento, aprovação, outputs, eventos e IDs com a composição Nest.

## Mudanças de domínio e conclusão de tarefas

Toda mudança de regra de negócio fica registrada em `changes/`, e o compilador mantém um snapshot do domínio em `.agentic/domain.lock.json`.

```bash
# proposal-first (regra nova): escreva changes/NNNN-<slug>/proposal.md (delta, critérios de aceite, ## Motivo)
# implemente com testes covers(...) e então:
bun run agentic compile                          # aplica e arquiva a proposta quando o código bate com o delta
bun run agentic verify NNNN                      # gates G1–G7 em JSON: done | needs-human | failed

# code-first (o código já mudou):
bun run agentic compile --draft-change <slug>    # gera o rascunho com o delta preenchido
# preencha o ## Motivo (e os critérios de aceite) no rascunho e então:
bun run agentic compile                          # aplica e arquiva
bun run agentic verify NNNN

# depuração
bun run agentic ir                               # IR canônica
```

O `verify` roda a suíte com reporter JUnit e cruza cada teste marcado com `covers([...])` com as regras e os critérios de aceite da proposta. O histórico por módulo fica em `.agents/skills/<módulo>-dev/references/history.md`.

## Declaração primeiro e coordenação

Declare decorators completos e corpos com `notImplemented()`, abra a proposta e compile. O estado é calculado a partir dos corpos e dos testes, sem arquivo de estado e sem alterar IR, lock ou skills ao implementar um corpo.

```bash
bun run agentic status --json                    # executa a suíte uma vez
bun run agentic status --static                  # lê testes sem importá-los; no máximo covered
bun run agentic next --change 0001               # primeira onda executável e projeção das próximas
bun run agentic packet entity:Order              # especificação, obrigações e comando com specHash
bun run agentic verify --item entity:Order --spec-hash <hash-do-packet> --json
bun run agentic verify 0001                      # inclui G7: itens tocados precisam estar done
```

Os estados são `declared`, `implemented` (faltam testes), `covered` (falha/skip ou análise estática) e `done`; dependências pendentes sobrepõem `blocked`, preservando o estado base. `--change` seleciona itens ADDED/MODIFIED e suas dependências ainda pendentes. Critérios automáticos de propostas abertas também viram obrigações quando cobrem regras do item.

O pacote protege item, regras, contratos referenciados e critérios aplicáveis com SHA-256. Alterar corpo ou localização preserva o hash; alterar uma declaração relevante o invalida. O executor altera apenas o corpo do item e testes. A verificação individual exige dependências concluídas, corpo implementado, hash preservado, cobertura passando e typecheck. Falhas de testes sem relação com o item não o reprovam; coleta JUnit ausente impede certificar conclusão.

Projetos ainda sem testes podem consultar `status`, `next` e `packet` para iniciar a implementação. A ausência de testes não certifica `done`; erros de importação ou coleta JUnit incompleta continuam impedindo consultas dinâmicas e verificação.

Todos os comandos aceitam `--config`. Consultas retornam 0 mesmo com trabalho pendente; uso inválido retorna 2, análise/verificação falha retorna 1. A cobertura do operator executa os use-cases via `FakeLlm` e a composição Nest, incluindo aprovação negada e concedida.

## Skill e agentes de desenvolvimento

A skill autoral [agentic-ddd](skills/agentic-ddd/SKILL.md) orienta autoria e coordenação por gerente/executor. Consulte também a skill gerada do módulo para suas regras e caminhos.

```bash
bun install --frozen-lockfile
bun run skills:install                              # projeto, Cursor/Codex/Claude
bun run skills:install --root /caminho/do/projeto --target codex
bun run skills:install --scope user --target all     # global explícito
bun run skills:install --check                      # verifica sem escrever
bun run skills:example --root /tmp/agentic-tasks     # destino inexistente
```

O instalador cria links para a mesma fonte e agentes nativos `agentic-ddd-manager`/`agentic-ddd-executor`, com modelo herdado. Verifica conflitos antes de escrever, preserva instalações idênticas e não altera configurações/permissões globais. A instalação global depende da permanência do checkout. Veja [instalação](skills/agentic-ddd/references/installation.md) e [tutorial completo](skills/agentic-ddd/references/tutorial.md).

O gerente prepara proposta/contratos e despacha um item por vez; o executor altera só corpo atribuído e testes, verificando com o hash original do packet. O gerente revisa o diff, repete a verificação e encerra com `verify NNNN`. O tutorial tasks começa sem testes e com corpos pendentes, usando aliases para este checkout e typecheck real. [Spec do Plano 5](docs/superpowers/specs/2026-10-08-v0-05-agent-skills-design.md) e [validação com smokes reais](docs/superpowers/validation/2026-10-08-plan5.md).

## Estrutura

| Caminho           | Conteúdo                                                                               |
| ----------------- | -------------------------------------------------------------------------------------- |
| `src/core`        | building blocks DDD (`AggregateRoot`, `DomainEvent`, `DomainError`, `notImplemented`…) |
| `src/decorators`  | decorators autodeclarativos e o registry                                               |
| `src/compiler`    | IR, validação, renderers, escrita/verificação                                          |
| `src/contracts`   | projeção canônica de declarações e hash compartilhados pelo compiler/runtime           |
| `src/runtime`     | ports, registro de operators, loop, aprovação, eventos e traces                        |
| `src/nestjs`      | `AgenticModule.forRoot/forFeature` e tokens de DI                                      |
| `src/testing`     | `covers()`, `createTestContext()`, `FakeLlm`, `FakeApproval` e bus in-memory           |
| `src/cli`         | `agentic-ddd compile`, `ir`, `status`, `next`, `packet` e `verify`                     |
| `examples/orders` | domínio de exemplo                                                                     |

## Roadmap

- **v0** (implementado, ver [`docs/superpowers/plans`](docs/superpowers/plans/2026-10-06-v0-00-index.md)): compilador de documentação → lock, changes e `verify` → estado do projeto e coordenação de agentes → runtime do operator e integração Nest.
- **v0.1.0**: primeira release da base acima.
- **v0.2.0 — em desenvolvimento**: skill do framework e agentes gerente/executor implementados; runner de avaliações, adapter LLM e demonstração CLI acompanhados como próximos planos.
- **Backlog**: `reactsTo`, contratos gerados, canal HTTP, propostas paralelas e distribuição npm. Veja [issues, dependências e critérios de aceite](docs/ROADMAP.md).

Design: [`docs/superpowers/specs/2026-10-06-agentic-ddd-v0-design.md`](docs/superpowers/specs/2026-10-06-agentic-ddd-v0-design.md) · Decisões: [`docs/adr/ADR-0001.md`](docs/adr/ADR-0001.md)

## Licença

[MIT](LICENSE)
