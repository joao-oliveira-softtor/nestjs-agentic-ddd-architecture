import type {
  ApprovalDecision,
  ApprovalPort,
  ApprovalRequest,
} from '@agentic-ddd/runtime';
export type ApprovalScript =
  | boolean
  | ((
      request: ApprovalRequest,
    ) => ApprovalDecision | Promise<ApprovalDecision>);
export class FakeApproval implements ApprovalPort {
  readonly requests: ApprovalRequest[] = [];
  constructor(private readonly decision: ApprovalScript) {}
  async request(request: ApprovalRequest): Promise<ApprovalDecision> {
    this.requests.push(request);
    return typeof this.decision === 'boolean'
      ? { approved: this.decision }
      : await this.decision(request);
  }
}
