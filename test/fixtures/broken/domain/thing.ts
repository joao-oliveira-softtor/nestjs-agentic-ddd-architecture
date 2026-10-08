import { AggregateRoot } from '@agentic-ddd/core';
import { AgentEntity, Invariant } from '@agentic-ddd/decorators';

@AgentEntity({ description: 'Coisa com invariante mal nomeada.' })
@Invariant({ id: 'Id Ruim', text: 'Regra qualquer.' })
export class Thing extends AggregateRoot<string> {}
