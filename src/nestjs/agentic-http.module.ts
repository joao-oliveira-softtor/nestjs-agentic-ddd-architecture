import {
  Inject,
  Module,
  type DynamicModule,
  type OnModuleDestroy,
} from '@nestjs/common';
import { OperatorRuntime } from '@agentic-ddd/runtime';
import type { RuntimeMcpHandler, RuntimeMcpOptions } from '../mcp/runtime-http';
import {
  RUNTIME_MCP_HANDLER,
  RuntimeMcpController,
} from './runtime-mcp.controller';

/** Expose the application’s mounted Operators over Streamable HTTP. */
@Module({})
export class AgenticHttpModule implements OnModuleDestroy {
  constructor(
    @Inject(RUNTIME_MCP_HANDLER) private readonly handler: RuntimeMcpHandler,
  ) {}

  static forRoot(options: RuntimeMcpOptions): DynamicModule {
    return {
      module: AgenticHttpModule,
      controllers: [RuntimeMcpController],
      providers: [
        {
          provide: RUNTIME_MCP_HANDLER,
          inject: [OperatorRuntime],
          useFactory: async (
            runtime: OperatorRuntime,
          ): Promise<RuntimeMcpHandler> => {
            // Resolve the optional SDK and jose peers only when Nest mounts the endpoint.
            const { createRuntimeMcpHandler } =
              await import('../mcp/runtime-http');
            return createRuntimeMcpHandler(runtime, options);
          },
        },
      ],
    };
  }

  onModuleDestroy(): Promise<void> {
    return this.handler.close();
  }
}
