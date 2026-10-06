import type { Repository } from '@agentic-ddd/core';
import type { Order } from './order.js';

export type OrderRepository = Repository<Order, string>;
