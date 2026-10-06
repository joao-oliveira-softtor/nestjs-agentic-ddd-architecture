import { Operator } from '@agentic-ddd/decorators';
import { CancelOrder } from '../application/cancel-order';
import { ConfirmOrder } from '../application/confirm-order';
import { CreateOrder } from '../application/create-order';

@Operator({
  name: 'order-operator',
  description:
    'Opera o ciclo de vida de pedidos de compra: criar, confirmar e cancelar. Use quando a mensagem pedir uma ação sobre um pedido.',
  instructions:
    'Você opera pedidos de compra. Use apenas as tools disponíveis. Identifique o pedido pelo id antes de agir e responda em português.',
  useCases: [CreateOrder, ConfirmOrder, CancelOrder],
  requiresApproval: [CancelOrder],
})
export class OrderOperator {}
