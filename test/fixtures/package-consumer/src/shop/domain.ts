import 'reflect-metadata';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Entity, type UseCase } from 'nestjs-agentic-ddd-architecture/core';
import {
  AgentEntity,
  AgentMethod,
  AgentUseCase,
  Operator,
} from 'nestjs-agentic-ddd-architecture/decorators';

@AgentEntity({ description: 'A named greeting.' })
export class Greeting extends Entity<string> {
  constructor(id: string) {
    super(id);
  }
  @AgentMethod({ description: 'Greet the named person.' })
  greet(): string {
    return `Hello ${this.id}`;
  }
}
export const PREFIX = Symbol('prefix');
@AgentUseCase({
  name: 'greet_person',
  description: 'Greet someone by name.',
  whenToUse: 'When greeting a person.',
  input: z.object({ name: z.string() }),
  output: z.object({ greeting: z.string() }),
  uses: ['method:Greeting.greet'],
})
@Injectable()
export class GreetPerson implements UseCase<
  { name: string },
  { greeting: string }
> {
  constructor(@Inject(PREFIX) private readonly prefix: string) {}
  async execute(input: { name: string }): Promise<{ greeting: string }> {
    return { greeting: `${this.prefix}${new Greeting(input.name).greet()}` };
  }
}
@Operator({
  name: 'greeting-operator',
  description: 'Greet people.',
  instructions: 'Use greet_person to greet.',
  useCases: [GreetPerson],
})
export class GreetingOperator {}
