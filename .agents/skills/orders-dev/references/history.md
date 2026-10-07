<!-- GERADO por agentic-ddd compile — não edite. Fonte: examples/orders -->

# Histórico do módulo `orders`

## Order

| Change | Título | Mudanças | Motivo |
|---|---|---|---|
| [0001](../../../../changes/archive/0001-estado-inicial/proposal.md) | Estado inicial do domínio orders | added `entity:Order` (behavioral); added `invariant:Order/ao-menos-um-item` (behavioral); added `invariant:Order/total-nao-negativo` (behavioral); added `method:Order.cancel` (behavioral); added `method:Order.confirm` (behavioral); added `method:Order.create` (behavioral) | Registra o estado inicial do domínio `orders` — pedido com criação, confirmação e cancelamento, três use-cases e o `order-operator` — como base do histórico. A partir daqui, toda mudança de regra de negócio passa por uma proposta em `changes/`. |
| [0002](../../../../changes/archive/0002-cancelamento-exige-motivo/proposal.md) | Cancelamento exige motivo | added `invariant:Order/cancelamento-exige-motivo` (behavioral) | O atendimento precisa saber por que cada pedido foi cancelado para tratar reclamações e medir desistências. Hoje `cancel_order` aceita cancelar sem nenhuma justificativa. |

## Eventos, use-cases e operators

| Change | Título | Mudanças | Motivo |
|---|---|---|---|
| [0001](../../../../changes/archive/0001-estado-inicial/proposal.md) | Estado inicial do domínio orders | added `event:OrderCancelled` (behavioral); added `event:OrderConfirmed` (behavioral); added `event:OrderCreated` (behavioral); added `operator:order-operator` (behavioral); added `usecase:cancel_order` (behavioral); added `usecase:confirm_order` (behavioral); added `usecase:create_order` (behavioral) | Registra o estado inicial do domínio `orders` — pedido com criação, confirmação e cancelamento, três use-cases e o `order-operator` — como base do histórico. A partir daqui, toda mudança de regra de negócio passa por uma proposta em `changes/`. |
| [0002](../../../../changes/archive/0002-cancelamento-exige-motivo/proposal.md) | Cancelamento exige motivo | modified `usecase:cancel_order` (breaking) | O atendimento precisa saber por que cada pedido foi cancelado para tratar reclamações e medir desistências. Hoje `cancel_order` aceita cancelar sem nenhuma justificativa. |
