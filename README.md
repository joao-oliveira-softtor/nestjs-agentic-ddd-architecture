# @agentic-ddd

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

## Estrutura

| Caminho           | Conteúdo                                                                               |
| ----------------- | -------------------------------------------------------------------------------------- |
| `src/core`        | building blocks DDD (`AggregateRoot`, `DomainEvent`, `DomainError`, `notImplemented`…) |
| `src/decorators`  | decorators autodeclarativos e o registry                                               |
| `src/compiler`    | IR, validação, renderers, escrita/verificação                                          |
| `src/testing`     | `covers()` e `createTestContext()`                                                     |
| `src/cli`         | `agentic-ddd compile`                                                                  |
| `examples/orders` | domínio de exemplo                                                                     |

## Roadmap

- **v0** (em andamento, ver [`docs/superpowers/plans`](docs/superpowers/plans/2026-10-06-v0-00-index.md)): compilador de documentação → lock, changes e `verify` → estado do projeto e coordenação de agentes → runtime do operator e integração Nest.
- **v0.1**: operators reagindo a eventos (`reactsTo`), testes de contrato gerados, avaliação das skills entre LLMs, canal HTTP, skill do framework.

Design: [`docs/superpowers/specs/2026-10-06-agentic-ddd-v0-design.md`](docs/superpowers/specs/2026-10-06-agentic-ddd-v0-design.md) · Decisões: [`docs/adr/ADR-0001.md`](docs/adr/ADR-0001.md)

## Licença

[MIT](LICENSE)
