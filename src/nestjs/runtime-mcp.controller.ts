import { All, Controller, Inject, Req, Res } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';
import type { RuntimeMcpHandler } from '../mcp/runtime-http';

export const RUNTIME_MCP_HANDLER = Symbol('agentic-ddd.RuntimeMcpHandler');

// The BunAdapter provides the original web Request and the bounded, parsed body.
interface BunRequest {
  native: Request;
  body?: unknown;
}

@Controller()
export class RuntimeMcpController {
  constructor(
    @Inject(RUNTIME_MCP_HANDLER) private readonly handler: RuntimeMcpHandler,
  ) {}

  @All(['mcp', '.well-known/oauth-protected-resource/mcp'])
  async forward(
    @Req() { native, body }: BunRequest,
    @Res() res: ServerResponse,
  ): Promise<void> {
    // Never reread a drained body or fall back to reading an unparsed body.
    const request = new Request(native.url, {
      method: native.method,
      headers: native.headers,
      signal: native.signal,
    });
    const response = await this.handler.fetch(request, body);
    res.statusCode = response.status;
    response.headers.forEach((value, name) => res.setHeader(name, value));
    if (
      response.body &&
      response.headers.get('content-type')?.startsWith('text/event-stream')
    ) {
      res.flushHeaders();
      try {
        await pipeline(response.body, res, { signal: native.signal });
      } catch (error) {
        if (!native.signal.aborted) throw error;
      }
    } else {
      res.end(new Uint8Array(await response.arrayBuffer()));
    }
  }
}
