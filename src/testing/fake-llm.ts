import type { LlmPort, LlmRequest, LlmResponse } from '@agentic-ddd/runtime';
export type LlmScriptEntry =
  LlmResponse | ((request: LlmRequest) => LlmResponse | Promise<LlmResponse>);
export class FakeLlm implements LlmPort {
  readonly requests: LlmRequest[] = [];
  #script: LlmScriptEntry[];
  constructor(script: readonly LlmScriptEntry[]) {
    this.#script = [...script];
  }
  async complete(request: LlmRequest): Promise<LlmResponse> {
    this.requests.push(request);
    const next = this.#script.shift();
    if (!next) throw new Error('FakeLlm script exhausted');
    return typeof next === 'function' ? await next(request) : next;
  }
}
