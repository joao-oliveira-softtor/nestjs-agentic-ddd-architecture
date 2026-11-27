import type { DomainEvent } from '@agentic-ddd/core';
import type {
  ApprovalDecision,
  ApprovalRequest,
  LlmRequest,
  LlmResponse,
} from './types';

export interface LlmPort {
  /** `signal` aborts when the run deadline is reached; adapters may ignore it. */
  complete(request: LlmRequest, signal?: AbortSignal): Promise<LlmResponse>;
}
export interface ApprovalPort {
  request(request: ApprovalRequest): Promise<ApprovalDecision>;
}
export type EventHandler = (event: DomainEvent) => void | Promise<void>;
export interface EventBus {
  publish(events: readonly DomainEvent[]): Promise<void>;
  subscribe(handler: EventHandler): () => void;
}
