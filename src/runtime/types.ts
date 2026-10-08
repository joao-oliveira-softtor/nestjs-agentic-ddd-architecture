import type { DomainEvent } from '@agentic-ddd/core';

export type JsonSchema = Record<string, unknown>;
export type AssistantBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown };
export type ToolCall = Extract<AssistantBlock, { type: 'tool_call' }>;
export interface ToolResult {
  toolCallId: string;
  content: unknown;
  isError: boolean;
}
export type LlmMessage =
  | { role: 'user'; text: string }
  | { role: 'assistant'; content: AssistantBlock[]; providerPayload?: unknown }
  | { role: 'tool'; results: ToolResult[] };
export interface LlmTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}
export interface LlmRequest {
  model: string;
  system: string;
  messages: LlmMessage[];
  tools: LlmTool[];
  toolChoice: 'auto' | 'none';
}
export interface LlmResponse {
  content: AssistantBlock[];
  stopReason: 'end' | 'tool_calls' | 'max_tokens' | 'refusal';
  providerPayload?: unknown;
}
export interface ApprovalRequest {
  operator: string;
  runId: string;
  useCase: string;
  input: unknown;
}
export interface ApprovalDecision {
  approved: boolean;
  reason?: string;
}
export type ApprovalPolicy = 'allow' | 'deny' | 'require_approval';
export interface ToolStep {
  call: ToolCall;
  policy?: ApprovalPolicy;
  approval?: ApprovalDecision;
  result?: ToolResult;
  events: DomainEvent[];
}
export interface Step {
  id: string;
  request: LlmRequest;
  response?: LlmResponse;
  tools: ToolStep[];
  events: DomainEvent[];
}
export type RunStatus = 'completed' | 'step_limit' | 'timeout' | 'failed';
export type TerminationReason =
  'max_tokens' | 'refused' | 'provider_error' | 'use_case_error';
export interface OperatorRunResult {
  runId: string;
  operator: string;
  status: RunStatus;
  reason?: TerminationReason;
  output?: string;
  steps: Step[];
  events: DomainEvent[];
}
export interface RunInput {
  message: string;
  context?: unknown;
}
