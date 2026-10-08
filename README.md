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

Todos os comandos aceitam `--config`. Consultas retornam 0 mesmo com trabalho pendente; uso inválido retorna 2, análise/verificação falha retorna 1. O operator usa cobertura declarativa de allowlist e aprovação neste marco; a execução com `FakeLlm` será entregue no plano 4.

## Estrutura

| Caminho           | Conteúdo                                                                               |
| ----------------- | -------------------------------------------------------------------------------------- |
| `src/core`        | building blocks DDD (`AggregateRoot`, `DomainEvent`, `DomainError`, `notImplemented`…) |
| `src/decorators`  | decorators autodeclarativos e o registry                                               |
| `src/compiler`    | IR, validação, renderers, escrita/verificação                                          |
| `src/testing`     | `covers()` e `createTestContext()`                                                     |
| `src/cli`         | `agentic-ddd compile`, `ir`, `status`, `next`, `packet` e `verify`                      |
| `examples/orders` | domínio de exemplo                                                                     |

## Roadmap

- **v0** (em andamento, ver [`docs/superpowers/plans`](docs/superpowers/plans/2026-10-06-v0-00-index.md)): compilador de documentação → lock, changes e `verify` → estado do projeto e coordenação de agentes → runtime do operator e integração Nest.
- **v0.1**: operators reagindo a eventos (`reactsTo`), testes de contrato gerados, avaliação das skills entre LLMs, canal HTTP, skill do framework.

Design: [`docs/superpowers/specs/2026-10-06-agentic-ddd-v0-design.md`](docs/superpowers/specs/2026-10-06-agentic-ddd-v0-design.md) · Decisões: [`docs/adr/ADR-0001.md`](docs/adr/ADR-0001.md)

## Licença

[MIT](LICENSE)
