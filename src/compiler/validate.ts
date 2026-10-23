import { AggregateRoot, ValueObject } from '@agentic-ddd/core';
import type { Registry } from '@agentic-ddd/decorators';
import { limitsError } from '../contracts/limits';
import { aggregateRoots } from './graph';
import {
  sourceOf,
  type CompileError,
  type IR,
  type IRInvariant,
  type IRMethod,
} from './ir';

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SNAKE = /^[a-z][a-z0-9_]{0,63}$/;
const PASCAL = /^[A-Z][A-Za-z0-9]*$/;
const STATIC_BUILTINS = new Set(['length', 'name', 'prototype']);

export function validate(
  ir: IR,
  registry: Registry,
  root: string,
): CompileError[] {
  const errors: CompileError[] = [];
  const err = (message: string, source: string | null): void => {
    errors.push({ message, source });
  };
  const required = (value: string, what: string, source: string): void => {
    if (value.trim() === '')
      err(`${what} é obrigatório e não pode ser vazio`, source);
  };

  const seen = new Map<string, string>();
  const claim = (id: string, source: string): void => {
    const previous = seen.get(id);
    if (previous)
      err(`ID duplicado ${id} (também declarado em ${previous})`, source);
    else seen.set(id, source);
  };

  const checkInvariant = (invariant: IRInvariant): void => {
    claim(invariant.id, invariant.source);
    const local = invariant.id.slice(invariant.id.indexOf('/') + 1);
    if (!KEBAB.test(local))
      err(
        `${invariant.id}: o id da invariante deve ser kebab-case (ex.: total-nao-negativo)`,
        invariant.source,
      );
    required(invariant.text, `${invariant.id}: text`, invariant.source);
  };

  const methodsById = new Map<string, IRMethod>(
    ir.entities.flatMap((e) => e.methods.map((m) => [m.id, m] as const)),
  );

  for (const entity of ir.entities) {
    claim(entity.id, entity.source);
    if (!PASCAL.test(entity.name))
      err(`${entity.id}: o nome da classe deve ser PascalCase`, entity.source);
    required(entity.description, `${entity.id}: description`, entity.source);
    if (
      entity.methods.some((m) => m.transition) &&
      entity.states.length === 0
    ) {
      err(
        `${entity.id} tem métodos com transition, mas @AgentEntity não declara states`,
        entity.source,
      );
    }
    for (const invariant of entity.invariants) {
      checkInvariant(invariant);
      if (invariant.on !== null && !methodsById.has(invariant.on)) {
        err(
          `${invariant.id} está num método sem @AgentMethod (${invariant.on})`,
          invariant.source,
        );
      }
    }
    for (const method of entity.methods) {
      claim(method.id, method.source);
      required(method.description, `${method.id}: description`, method.source);
      if (!method.transition) continue;
      if (
        method.transition.from.length === 0 ||
        method.transition.to.trim() === ''
      ) {
        err(
          `${method.id}: transition precisa de from (não vazio) e to`,
          method.source,
        );
      } else if (method.transition.from.some((state) => state.trim() === '')) {
        err(
          `${method.id}: transition não aceita estado vazio em from`,
          method.source,
        );
      }
      if (entity.states.length === 0) continue;
      for (const state of [...method.transition.from, method.transition.to]) {
        if (state.trim() !== '' && !entity.states.includes(state)) {
          err(
            `${method.id}: estado "${state}" não está em states de ${entity.name}`,
            method.source,
          );
        }
      }
    }
  }

  const owners = new Map<string, string[]>();
  const moduleById = new Map(ir.entities.map((e) => [e.id, e.module]));
  for (const entity of ir.entities) {
    for (const id of entity.references ?? []) {
      if (id.startsWith('valueobject:'))
        err(
          `${entity.id}: references só aponta para entidade, não para ${id}`,
          entity.source,
        );
    }
    for (const id of entity.contains ?? []) {
      if (!id.startsWith('entity:')) continue;
      owners.set(id, [...(owners.get(id) ?? []), entity.id]);
      const other = moduleById.get(id);
      if (other !== undefined && other !== entity.module)
        err(
          `${entity.id}: contains cita ${id}, de outro módulo (${other})`,
          entity.source,
        );
    }
  }
  for (const [child, list] of owners) {
    if (list.length < 2) continue;
    const source = ir.entities.find((e) => e.id === list[0])!.source;
    err(
      `${child} está no contains de mais de um dono (${list.join(', ')})`,
      source,
    );
  }
  // ciclo: DFS pelas arestas de contains entre entidades (sem ele, as ondas recursam)
  const state = new Map<string, 'open' | 'done'>();
  // Erro na entidade cuja aresta cai num nó ainda 'open' (ela fecha o ciclo, e está dentro dele).
  const visit = (id: string): void => {
    state.set(id, 'open');
    const entity = ir.entities.find((e) => e.id === id);
    for (const c of entity?.contains ?? []) {
      if (!c.startsWith('entity:')) continue;
      if (state.get(c) === 'open')
        err(`${id}: ciclo de contains entre entidades`, entity?.source ?? null);
      else if (!state.has(c)) visit(c);
    }
    state.set(id, 'done');
  };
  for (const entity of ir.entities) {
    if (!state.has(entity.id)) visit(entity.id);
  }

  const entityNames = new Set(ir.entities.map((e) => e.name));
  for (const vo of ir.valueObjects ?? []) {
    claim(vo.id, vo.source);
    if (!PASCAL.test(vo.name))
      err(`${vo.id}: o nome da classe deve ser PascalCase`, vo.source);
    required(vo.description, `${vo.id}: description`, vo.source);
    if (entityNames.has(vo.name))
      err(
        `${vo.id}: o nome coincide com o da entidade entity:${vo.name} (compartilhariam invariant:${vo.name}/ e a seção do histórico)`,
        vo.source,
      );
    for (const invariant of vo.invariants) checkInvariant(invariant);
  }
  for (const rec of registry.valueObjects) {
    if (!(rec.target.prototype instanceof ValueObject))
      err(
        `valueobject:${rec.target.name}: não estende ValueObject de @agentic-ddd/core (projeto e CLI com cópias diferentes do pacote?)`,
        sourceOf(root, rec.source),
      );
  }

  for (const event of ir.events) {
    claim(event.id, event.source);
    if (!PASCAL.test(event.name))
      err(`${event.id}: o nome da classe deve ser PascalCase`, event.source);
    required(event.description, `${event.id}: description`, event.source);
  }

  for (const useCase of ir.useCases) {
    claim(useCase.id, useCase.source);
    if (!SNAKE.test(useCase.name))
      err(
        `${useCase.id}: name deve ser snake_case (^[a-z][a-z0-9_]{0,63}$)`,
        useCase.source,
      );
    required(useCase.description, `${useCase.id}: description`, useCase.source);
    required(useCase.whenToUse, `${useCase.id}: whenToUse`, useCase.source);
    for (const invariant of useCase.invariants ?? []) checkInvariant(invariant);
    const reachable = new Set<string>();
    const declared = new Set(useCase.emits);
    for (const use of useCase.uses) {
      const method = methodsById.get(use);
      if (!method)
        err(`${useCase.id}: uses cita ${use}, que não existe`, useCase.source);
      else
        for (const emitted of method.emits) {
          reachable.add(emitted);
          if (!declared.has(emitted))
            err(
              `${useCase.id}: ${method.id} emite ${emitted}, que falta em emits (o runtime recusaria a publicação)`,
              useCase.source,
            );
        }
    }
    for (const emitted of useCase.emits) {
      if (!reachable.has(emitted))
        err(
          `${useCase.id}: emite ${emitted}, mas nenhum método em uses emite esse evento`,
          useCase.source,
        );
    }
  }

  for (const operator of ir.operators) {
    claim(operator.id, operator.source);
    if (!KEBAB.test(operator.name) || operator.name.length > 64) {
      err(
        `${operator.id}: name deve ser kebab-case com até 64 caracteres`,
        operator.source,
      );
    }
    required(
      operator.description,
      `${operator.id}: description`,
      operator.source,
    );
    required(
      operator.instructions,
      `${operator.id}: instructions`,
      operator.source,
    );
    if (operator.useCases.length === 0)
      err(`${operator.id}: useCases não pode ser vazio`, operator.source);
    const limitsProblem = limitsError(operator.limits);
    if (limitsProblem !== null)
      err(
        `${operator.id}: limits inválidos (${limitsProblem})`,
        operator.source,
      );
    for (const approval of operator.requiresApproval) {
      if (!operator.useCases.includes(approval)) {
        err(
          `${operator.id}: requiresApproval cita ${approval}, que não está em useCases`,
          operator.source,
        );
      }
    }
  }

  const entityTargets = new Set(registry.entities.map((e) => e.target));
  for (const method of registry.methods) {
    if (!entityTargets.has(method.entity)) {
      err(
        `${method.entity.name}.${method.name} tem @AgentMethod, mas ${method.entity.name} não tem @AgentEntity`,
        sourceOf(root, method.source),
      );
    }
  }
  const useCaseTargets = new Set(registry.useCases.map((u) => u.target));
  const voTargets = new Set(registry.valueObjects.map((v) => v.target));
  for (const invariant of registry.invariants) {
    const isEntity = entityTargets.has(invariant.entity);
    const isUseCase = useCaseTargets.has(invariant.entity);
    const isVo = voTargets.has(invariant.entity);
    const owners = [isEntity, isUseCase, isVo].filter(Boolean).length;
    if (owners > 1) {
      err(
        isVo
          ? `@Invariant ${invariant.id} em ${invariant.entity.name}: a classe tem mais de um entre @AgentEntity, @AgentUseCase e @AgentValueObject, e o dono da invariante fica ambíguo`
          : `@Invariant ${invariant.id} em ${invariant.entity.name}: a classe tem @AgentEntity e @AgentUseCase, e o dono da invariante fica ambíguo`,
        sourceOf(root, invariant.source),
      );
    } else if (owners === 0) {
      err(
        `@Invariant ${invariant.id} em ${invariant.entity.name}, que não tem @AgentEntity, @AgentUseCase nem @AgentValueObject`,
        sourceOf(root, invariant.source),
      );
    } else if (!isEntity && invariant.method !== null) {
      err(
        `@Invariant ${invariant.id} em ${invariant.entity.name}.${invariant.method}: em ${isVo ? 'value object' : 'use-case'}, @Invariant vai na classe`,
        sourceOf(root, invariant.source),
      );
    }
  }

  for (const rec of registry.entities) {
    const decorated = new Set(
      registry.methods
        .filter((m) => m.entity === rec.target)
        .map((m) => `${m.isStatic}:${m.name}`),
    );
    const scan = (owner: object, isStatic: boolean): void => {
      for (const key of Object.getOwnPropertyNames(owner)) {
        if (isStatic ? STATIC_BUILTINS.has(key) : key === 'constructor')
          continue;
        const descriptor = Object.getOwnPropertyDescriptor(owner, key);
        if (
          !descriptor ||
          descriptor.get ||
          descriptor.set ||
          typeof descriptor.value !== 'function'
        )
          continue;
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

// Avisos (não erros) de AggregateRoot: raiz sem a classe base e filha que a estende (ADR-0006 D4).
export function relationWarnings(ir: IR, registry: Registry): string[] {
  if (!ir.entities.some((e) => e.contains || e.references)) return [];
  const roots = aggregateRoots(ir);
  const classOf = new Map(
    registry.entities.map((r) => [`entity:${r.target.name}`, r.target]),
  );
  const warnings: string[] = [];
  for (const entity of ir.entities) {
    const target = classOf.get(entity.id);
    if (!target) continue;
    const isAggregate = target.prototype instanceof AggregateRoot;
    if (roots.has(entity.id) && !isAggregate)
      warnings.push(`${entity.id}: raiz de agregado não estende AggregateRoot`);
    if (!roots.has(entity.id) && isAggregate)
      warnings.push(`${entity.id}: entidade contida estende AggregateRoot`);
  }
  return warnings;
}
