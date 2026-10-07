---
id: "0001"
title: "Estado inicial do domínio orders"
status: applied
origin: code-first
delta:
  added:
    - "entity:Order"
    - "event:OrderCancelled"
    - "event:OrderConfirmed"
    - "event:OrderCreated"
    - "invariant:Order/ao-menos-um-item"
    - "invariant:Order/total-nao-negativo"
    - "method:Order.cancel"
    - "method:Order.confirm"
    - "method:Order.create"
    - "operator:order-operator"
    - "usecase:cancel_order"
    - "usecase:confirm_order"
    - "usecase:create_order"
  modified: []
  removed: []
acceptance: []
---

## Motivo

Registra o estado inicial do domínio `orders` — pedido com criação, confirmação e cancelamento, três use-cases e o `order-operator` — como base do histórico. A partir daqui, toda mudança de regra de negócio passa por uma proposta em `changes/`.
