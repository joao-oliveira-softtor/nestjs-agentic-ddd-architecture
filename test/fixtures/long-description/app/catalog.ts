import { AgentUseCase, Operator } from '@agentic-ddd/decorators';
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

@Operator({
  name: 'long-operator',
  description: `Opera ${'x'.repeat(1100)}`,
  instructions: 'Teste.',
  useCases: [Noop],
})
export class LongOperator {}
