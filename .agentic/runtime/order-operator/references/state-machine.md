<!-- GERADO por agentic-ddd compile — não edite. Fonte: examples/orders/operators/order.operator.ts:6 -->

# Máquina de estados

## Order

Estados: `pending`, `confirmed`, `cancelled`

| Método | De | Para | Emite |
|---|---|---|---|
| `Order.cancel` | `pending`, `confirmed` | `cancelled` | `OrderCancelled` |
| `Order.confirm` | `pending` | `confirmed` | `OrderConfirmed` |
