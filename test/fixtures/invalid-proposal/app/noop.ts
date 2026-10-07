import { AgentUseCase } from '@agentic-ddd/decorators';
import { z } from 'zod';

@AgentUseCase({
  name: 'noop',
  description: 'Não faz nada.',
  whenToUse: 'Nunca.',
  input: z.object({}),
  output: z.object({}),
  uses: [],
})
export class Noop {}
