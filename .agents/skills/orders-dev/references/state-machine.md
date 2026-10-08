<!-- GERADO por agentic-ddd compile — não edite. Fonte: examples/orders -->

# Máquina de estados

## Order

Estados: `pending`, `confirmed`, `cancelled`

| Método | De | Para | Emite |
|---|---|---|---|
| `Order.cancel` | `pending`, `confirmed` | `cancelled` | `OrderCancelled` |
| `Order.confirm` | `pending` | `confirmed` | `OrderConfirmed` |
