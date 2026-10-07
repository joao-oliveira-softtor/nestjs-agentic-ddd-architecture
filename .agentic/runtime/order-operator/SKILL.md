---
name: order-operator
description: "Opera o ciclo de vida de pedidos de compra: criar, confirmar e cancelar. Use quando a mensagem pedir uma ação sobre um pedido."
metadata:
  agentic-ddd.audience: runtime
  agentic-ddd.generated: "true"
  agentic-ddd.ir-hash: "249cecaf9b809fff25dbec75ec2610f45fffabb8ad1d380c64a3cfe0c3b5bda6"
---
<!-- GERADO por agentic-ddd compile — não edite. Fonte: examples/orders/operators/order.operator.ts:6 -->

# Operator `order-operator`

Opera o ciclo de vida de pedidos de compra: criar, confirmar e cancelar. Use quando a mensagem pedir uma ação sobre um pedido.

## Tools

Tools marcadas com **Exige aprovação humana: sim** só executam depois de uma pessoa aprovar; se a aprovação for negada, a tool devolve o erro `approval_denied` e nada é alterado.

### `cancel_order`

Cancela um pedido pendente ou confirmado.

- **Quando usar:** Quando o cliente desistir de um pedido que ainda não foi cancelado.
- **Quando não usar:** Para pedidos já cancelados.
- **Aciona:** `Order.cancel`
- **Emite:** `OrderCancelled`
- **Exige aprovação humana:** sim

| Parâmetro | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `order_id` | string | sim | Id do pedido a cancelar |

Schema completo (restrições, campos aninhados e saída): `references/tools.schema.json` → `cancel_order`.

### `confirm_order`

Confirma um pedido pendente.

- **Quando usar:** Quando o cliente ou o atendente confirmar um pedido pendente.
- **Quando não usar:** Para pedidos já confirmados ou cancelados.
- **Aciona:** `Order.confirm`
- **Emite:** `OrderConfirmed`
- **Exige aprovação humana:** não

| Parâmetro | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `order_id` | string | sim | Id do pedido a confirmar |

Schema completo (restrições, campos aninhados e saída): `references/tools.schema.json` → `confirm_order`.

### `create_order`

Cria um pedido pendente para um cliente com os itens informados.

- **Quando usar:** Quando o cliente quer abrir um novo pedido.
- **Quando não usar:** Para alterar itens de um pedido que já existe.
- **Aciona:** `Order.create`
- **Emite:** `OrderCreated`
- **Exige aprovação humana:** não

| Parâmetro | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `order_id` | string | sim | Id do novo pedido |
| `customer_id` | string | sim | Id do cliente |
| `items` | array<object> | sim | Itens do pedido |

Schema completo (restrições, campos aninhados e saída): `references/tools.schema.json` → `create_order`.

## Regras de negócio

| Invariante | Regra | Garantida por |
|---|---|---|
| `invariant:Order/ao-menos-um-item` | Um pedido precisa ter ao menos um item. | construção |
| `invariant:Order/total-nao-negativo` | O total do pedido (soma de quantidade × preço unitário) nunca pode ser negativo. | construção |

## Estados e transições

| Método | De | Para |
|---|---|---|
| `Order.cancel` | `pending`, `confirmed` | `cancelled` |
| `Order.confirm` | `pending` | `confirmed` |

Detalhes: [schemas das tools](references/tools.schema.json) · [máquina de estados](references/state-machine.md)
