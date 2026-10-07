---
name: orders-dev
description: "Domínio orders: entidades Order; use-cases cancel_order, confirm_order, create_order; operators order-operator. Use quando for implementar, alterar, testar ou revisar código em examples/orders."
metadata:
  agentic-ddd.audience: dev
  agentic-ddd.generated: "true"
  agentic-ddd.ir-hash: "249cecaf9b809fff25dbec75ec2610f45fffabb8ad1d380c64a3cfe0c3b5bda6"
---
<!-- GERADO por agentic-ddd compile — não edite. Fonte: examples/orders -->

# Módulo `orders`

Código em `examples/orders`. Esta skill descreve o domínio declarado (requisitos, regras e contratos); ela não registra estado de implementação.

## Entidades

### Order — `entity:Order`

Pedido de compra de um cliente, com itens e ciclo de vida pendente, confirmado ou cancelado.

Fonte: `examples/orders/domain/order.ts:19` · Estados: `pending`, `confirmed`, `cancelled`

| Invariante | Regra | Garantida por | Fonte |
|---|---|---|---|
| `invariant:Order/ao-menos-um-item` | Um pedido precisa ter ao menos um item. | construção | `examples/orders/domain/order.ts:24` |
| `invariant:Order/total-nao-negativo` | O total do pedido (soma de quantidade × preço unitário) nunca pode ser negativo. | construção | `examples/orders/domain/order.ts:28` |

| Método | Descrição | Transição | Emite | Fonte |
|---|---|---|---|---|
| `Order.cancel` | Cancela um pedido pendente ou confirmado. | `pending`, `confirmed` → `cancelled` | `OrderCancelled` | `examples/orders/domain/order.ts:103` |
| `Order.confirm` | Confirma um pedido pendente. | `pending` → `confirmed` | `OrderConfirmed` | `examples/orders/domain/order.ts:92` |
| `Order.create` | Cria um pedido pendente para um cliente. | — | `OrderCreated` | `examples/orders/domain/order.ts:64` |

## Eventos

| Evento | Descrição | Fonte |
|---|---|---|
| `OrderCancelled` | Um pedido foi cancelado. | `examples/orders/domain/order.events.ts:27` |
| `OrderConfirmed` | Um pedido pendente foi confirmado. | `examples/orders/domain/order.events.ts:21` |
| `OrderCreated` | Um pedido foi criado e está pendente. | `examples/orders/domain/order.events.ts:11` |

## Use-cases

| Use-case | Descrição | Aciona | Emite | Fonte |
|---|---|---|---|---|
| `cancel_order` | Cancela um pedido pendente ou confirmado. | `Order.cancel` | `OrderCancelled` | `examples/orders/application/cancel-order.ts:18` |
| `confirm_order` | Confirma um pedido pendente. | `Order.confirm` | `OrderConfirmed` | `examples/orders/application/confirm-order.ts:18` |
| `create_order` | Cria um pedido pendente para um cliente com os itens informados. | `Order.create` | `OrderCreated` | `examples/orders/application/create-order.ts:37` |

## Operators

| Operator | Use-cases | Exige aprovação | Fonte |
|---|---|---|---|
| `order-operator` | `cancel_order`, `confirm_order`, `create_order` | `cancel_order` | `examples/orders/operators/order.operator.ts:6` |

## Dependências entre itens

| Item | Camada | Depende de |
|---|---|---|
| `entity:Order` | domain | — |
| `method:Order.cancel` | domain | `entity:Order` |
| `method:Order.confirm` | domain | `entity:Order` |
| `operator:order-operator` | operators | `usecase:cancel_order`, `usecase:confirm_order`, `usecase:create_order` |
| `usecase:cancel_order` | application | `method:Order.cancel` |
| `usecase:confirm_order` | application | `method:Order.confirm` |
| `usecase:create_order` | application | `entity:Order` |

## Obrigações de teste

Cada ID abaixo precisa de ao menos um teste nomeado com `covers([...ids], título)` de `@agentic-ddd/testing`.

| Item | IDs a cobrir |
|---|---|
| `entity:Order` | `invariant:Order/ao-menos-um-item`, `invariant:Order/total-nao-negativo`, `method:Order.create` |
| `method:Order.cancel` | `method:Order.cancel` |
| `method:Order.confirm` | `method:Order.confirm` |
| `operator:order-operator` | `operator:order-operator` |
| `usecase:cancel_order` | `usecase:cancel_order` |
| `usecase:confirm_order` | `usecase:confirm_order` |
| `usecase:create_order` | `usecase:create_order` |

## Como estender

| Artefato | Onde criar | Como declarar |
|---|---|---|
| Entidade | `examples/orders/domain/<nome>.ts` | `@AgentEntity({ description, states })` + `@Invariant({ id, text })` na classe |
| Método de entidade | na classe da entidade | `@AgentMethod({ description, transition?, emits? })`; regra garantida pelo método: `@Invariant` no método; auxiliares: `#privado` |
| Evento | `examples/orders/domain/<agregado>.events.ts` | `@AgentEvent({ description, payload })` estendendo `DomainEvent` |
| Use-case | `examples/orders/application/<nome>.ts` | `@AgentUseCase({ name, description, whenToUse, input, output, uses: ['method:<Entidade>.<método>'], emits? })` |
| Operator | `examples/orders/operators/<nome>.operator.ts` | `@Operator({ name, description, instructions, useCases, requiresApproval? })` |

Corpo declarado e ainda não implementado usa `notImplemented()` de `@agentic-ddd/core`.

## Referências

- [Schemas de eventos e use-cases](references/schemas.json)
- [Máquina de estados](references/state-machine.md)
