import type { Registry } from '@agentic-ddd/decorators';
import { sourceOf, type CompileError, type IR, type IRMethod } from './ir.js';

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SNAKE = /^[a-z][a-z0-9_]{0,63}$/;
const PASCAL = /^[A-Z][A-Za-z0-9]*$/;
const STATIC_BUILTINS = new Set(['length', 'name', 'prototype']);

export function validate(ir: IR, registry: Registry, root: string): CompileError[] {
  const errors: CompileError[] = [];
  const err = (message: string, source: string | null): void => {
    errors.push({ message, source });
  };
  const required = (value: string, what: string, source: string): void => {
    if (value.trim() === '') err(`${what} é obrigatório e não pode ser vazio`, source);
  };

  const seen = new Map<string, string>();
  const claim = (id: string, source: string): void => {
    const previous = seen.get(id);
    if (previous) err(`ID duplicado ${id} (também declarado em ${previous})`, source);
    else seen.set(id, source);
  };

  const methodsById = new Map<string, IRMethod>(ir.entities.flatMap((e) => e.methods.map((m) => [m.id, m] as const)));

  for (const entity of ir.entities) {
    claim(entity.id, entity.source);
    if (!PASCAL.test(entity.name)) err(`${entity.id}: o nome da classe deve ser PascalCase`, entity.source);
    required(entity.description, `${entity.id}: description`, entity.source);
    if (entity.methods.some((m) => m.transition) && entity.states.length === 0) {
      err(`${entity.id} tem métodos com transition, mas @AgentEntity não declara states`, entity.source);
    }
    for (const invariant of entity.invariants) {
      claim(invariant.id, invariant.source);
      const local = invariant.id.slice(invariant.id.indexOf('/') + 1);
      if (!KEBAB.test(local)) err(`${invariant.id}: o id da invariante deve ser kebab-case (ex.: total-nao-negativo)`, invariant.source);
      required(invariant.text, `${invariant.id}: text`, invariant.source);
      if (invariant.on !== null && !methodsById.has(invariant.on)) {
        err(`${invariant.id} está num método sem @AgentMethod (${invariant.on})`, invariant.source);
      }
    }
    for (const method of entity.methods) {
      claim(method.id, method.source);
      required(method.description, `${method.id}: description`, method.source);
      if (!method.transition) continue;
      if (method.transition.from.length === 0 || method.transition.to.trim() === '') {
        err(`${method.id}: transition precisa de from (não vazio) e to`, method.source);
      }
      if (entity.states.length === 0) continue;
      for (const state of [...method.transition.from, method.transition.to]) {
        if (state !== '' && !entity.states.includes(state)) {
          err(`${method.id}: estado "${state}" não está em states de ${entity.name}`, method.source);
        }
      }
    }
  }

  for (const event of ir.events) {
    claim(event.id, event.source);
    if (!PASCAL.test(event.name)) err(`${event.id}: o nome da classe deve ser PascalCase`, event.source);
    required(event.description, `${event.id}: description`, event.source);
  }

  for (const useCase of ir.useCases) {
    claim(useCase.id, useCase.source);
    if (!SNAKE.test(useCase.name)) err(`${useCase.id}: name deve ser snake_case (^[a-z][a-z0-9_]{0,63}$)`, useCase.source);
    required(useCase.description, `${useCase.id}: description`, useCase.source);
    required(useCase.whenToUse, `${useCase.id}: whenToUse`, useCase.source);
    const reachable = new Set<string>();
    for (const use of useCase.uses) {
      const method = methodsById.get(use);
      if (!method) err(`${useCase.id}: uses cita ${use}, que não existe`, useCase.source);
      else for (const emitted of method.emits) reachable.add(emitted);
    }
    for (const emitted of useCase.emits) {
      if (!reachable.has(emitted)) err(`${useCase.id}: emite ${emitted}, mas nenhum método em uses emite esse evento`, useCase.source);
    }
  }

  for (const operator of ir.operators) {
    claim(operator.id, operator.source);
    if (!KEBAB.test(operator.name) || operator.name.length > 64) {
      err(`${operator.id}: name deve ser kebab-case com até 64 caracteres`, operator.source);
    }
    required(operator.description, `${operator.id}: description`, operator.source);
    required(operator.instructions, `${operator.id}: instructions`, operator.source);
    if (operator.useCases.length === 0) err(`${operator.id}: useCases não pode ser vazio`, operator.source);
    for (const approval of operator.requiresApproval) {
      if (!operator.useCases.includes(approval)) {
        err(`${operator.id}: requiresApproval cita ${approval}, que não está em useCases`, operator.source);
      }
    }
  }

  const entityTargets = new Set(registry.entities.map((e) => e.target));
  for (const method of registry.methods) {
    if (!entityTargets.has(method.entity)) {
      err(`${method.entity.name}.${method.name} tem @AgentMethod, mas ${method.entity.name} não tem @AgentEntity`, sourceOf(root, method.source));
    }
  }
  for (const invariant of registry.invariants) {
    if (!entityTargets.has(invariant.entity)) {
      err(`@Invariant ${invariant.id} em ${invariant.entity.name}, que não tem @AgentEntity`, sourceOf(root, invariant.source));
    }
  }

  for (const rec of registry.entities) {
    const decorated = new Set(registry.methods.filter((m) => m.entity === rec.target).map((m) => `${m.isStatic}:${m.name}`));
    const scan = (owner: object, isStatic: boolean): void => {
      for (const key of Object.getOwnPropertyNames(owner)) {
        if (isStatic ? STATIC_BUILTINS.has(key) : key === 'constructor') continue;
        const descriptor = Object.getOwnPropertyDescriptor(owner, key);
        if (!descriptor || descriptor.get || descriptor.set || typeof descriptor.value !== 'function') continue;
        if (!decorated.has(`${isStatic}:${key}`)) {
          err(
            `${rec.target.name}.${key} é público e não tem @AgentMethod: declare-o ou torne-o privado (#${key})`,
            sourceOf(root, rec.source),
          );
        }
      }
    };
    scan(rec.target.prototype as object, false);
    scan(rec.target, true);
  }

  return errors;
}
