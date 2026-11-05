import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { AggregateRoot, ValueObject } from '@agentic-ddd/core';
import type { Registry } from '@agentic-ddd/decorators';
import { limitsError } from '../contracts/limits';
import { findDecoratedClass } from './ast';
import { aggregateRoots } from './graph';
import {
  sourceOf,
  type CompileError,
  type ErrorCode,
  type IR,
  type IRInvariant,
  type IRMethod,
} from './ir';

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SNAKE = /^[a-z][a-z0-9_]{0,63}$/;
const PASCAL = /^[A-Z][A-Za-z0-9]*$/;
const STATIC_BUILTINS = new Set(['length', 'name', 'prototype']);

// Abstract methods of the @AgentPort class, read from the syntax tree (abstract does not exist at runtime).
// Finds the ClassDeclaration by the decorator that starts on the source line; null if not found.
function abstractMethods(
  file: string,
  line: number,
  name: string,
): { abstract: boolean; methods: Set<string> } | null {
  const sf = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const cls = findDecoratedClass(sf, line, name);
  if (cls === null) return null;
  return {
    abstract: !!ts
      .getModifiers(cls)
      ?.some((m) => m.kind === ts.SyntaxKind.AbstractKeyword),
    methods: new Set(
      cls.members
        .filter(
          (m): m is ts.MethodDeclaration =>
            ts.isMethodDeclaration(m) &&
            !!ts
              .getModifiers(m)
              ?.some((x) => x.kind === ts.SyntaxKind.AbstractKeyword),
        )
        .map((m) =>
          ts.isIdentifier(m.name) || ts.isStringLiteral(m.name)
            ? m.name.text
            : m.name.getText(sf),
        ),
    ),
  };
}

export function validate(
  ir: IR,
  registry: Registry,
  root: string,
): CompileError[] {
  const errors: CompileError[] = [];
  const err = (
    code: ErrorCode,
    message: string,
    source: string | null,
  ): void => {
    errors.push({ code, message, source });
  };
  const required = (value: string, what: string, source: string): void => {
    if (value.trim() === '')
      err(
        'validate.required-empty',
        `${what} is required and cannot be empty`,
        source,
      );
  };

  const seen = new Map<string, string>();
  const claim = (id: string, source: string): void => {
    const previous = seen.get(id);
    if (previous)
      err(
        'validate.duplicate-id',
        `duplicate ID ${id} (also declared in ${previous})`,
        source,
      );
    else seen.set(id, source);
  };

  const checkInvariant = (invariant: IRInvariant): void => {
    claim(invariant.id, invariant.source);
    const local = invariant.id.slice(invariant.id.indexOf('/') + 1);
    if (!KEBAB.test(local))
      err(
        'validate.invariant-id-format',
        `${invariant.id}: the invariant id must be kebab-case (e.g. total-not-negative)`,
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
      err(
        'validate.name-pascal-case',
        `${entity.id}: the class name must be PascalCase`,
        entity.source,
      );
    required(entity.description, `${entity.id}: description`, entity.source);
    if (
      entity.methods.some((m) => m.transition) &&
      entity.states.length === 0
    ) {
      err(
        'validate.transition-without-states',
        `${entity.id} has methods with transition, but @AgentEntity declares no states`,
        entity.source,
      );
    }
    for (const invariant of entity.invariants) {
      checkInvariant(invariant);
      if (invariant.on !== null && !methodsById.has(invariant.on)) {
        err(
          'validate.invariant-method-undeclared',
          `${invariant.id} is on a method without @AgentMethod (${invariant.on})`,
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
          'validate.transition-incomplete',
          `${method.id}: transition needs a non-empty from and a to`,
          method.source,
        );
      } else if (method.transition.from.some((state) => state.trim() === '')) {
        err(
          'validate.transition-empty-state',
          `${method.id}: transition does not accept an empty state in from`,
          method.source,
        );
      }
      if (entity.states.length === 0) continue;
      for (const state of [...method.transition.from, method.transition.to]) {
        if (state.trim() !== '' && !entity.states.includes(state)) {
          err(
            'validate.transition-state-unknown',
            `${method.id}: state "${state}" is not in the states of ${entity.name}`,
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
          'validate.references-value-object',
          `${entity.id}: references can only point to an entity, not to ${id}`,
          entity.source,
        );
    }
    for (const id of entity.contains ?? []) {
      if (!id.startsWith('entity:')) continue;
      owners.set(id, [...(owners.get(id) ?? []), entity.id]);
      const other = moduleById.get(id);
      if (other !== undefined && other !== entity.module)
        err(
          'validate.contains-cross-module',
          `${entity.id}: contains cites ${id}, from another module (${other})`,
          entity.source,
        );
    }
  }
  for (const [child, list] of owners) {
    if (list.length < 2) continue;
    const source = ir.entities.find((e) => e.id === list[0])!.source;
    err(
      'validate.contains-multiple-owners',
      `${child} is in the contains of more than one owner (${list.join(', ')})`,
      source,
    );
  }
  // cycle: DFS over the contains edges between entities (without it, the waves recurse)
  const state = new Map<string, 'open' | 'done'>();
  // Report on the entity whose edge lands on a still-'open' node (it closes the cycle and is inside it).
  const visit = (id: string): void => {
    state.set(id, 'open');
    const entity = ir.entities.find((e) => e.id === id);
    for (const c of entity?.contains ?? []) {
      if (!c.startsWith('entity:')) continue;
      if (state.get(c) === 'open')
        err(
          'validate.contains-cycle',
          `${id}: contains cycle between entities`,
          entity?.source ?? null,
        );
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
      err(
        'validate.name-pascal-case',
        `${vo.id}: the class name must be PascalCase`,
        vo.source,
      );
    required(vo.description, `${vo.id}: description`, vo.source);
    if (entityNames.has(vo.name))
      err(
        'validate.value-object-name-collision',
        `${vo.id}: the name matches the entity entity:${vo.name} (they would share invariant:${vo.name}/ and the history section)`,
        vo.source,
      );
    for (const invariant of vo.invariants) checkInvariant(invariant);
  }
  for (const rec of registry.valueObjects) {
    if (!(rec.target.prototype instanceof ValueObject))
      err(
        'validate.value-object-base-missing',
        `valueobject:${rec.target.name}: does not extend ValueObject from @agentic-ddd/core (project and CLI with different copies of the package?)`,
        sourceOf(root, rec.source),
      );
  }

  for (const event of ir.events) {
    claim(event.id, event.source);
    if (!PASCAL.test(event.name))
      err(
        'validate.name-pascal-case',
        `${event.id}: the class name must be PascalCase`,
        event.source,
      );
    required(event.description, `${event.id}: description`, event.source);
  }

  const roots = aggregateRoots(ir);
  for (const port of ir.ports ?? []) {
    claim(port.id, port.source);
    if (!PASCAL.test(port.name))
      err(
        'validate.name-pascal-case',
        `${port.id}: the class name must be PascalCase`,
        port.source,
      );
    required(port.description, `${port.id}: description`, port.source);
    for (const method of port.methods)
      required(
        method.description,
        `${port.id}.${method.name}: description`,
        port.source,
      );
    if (!roots.has(port.root))
      err(
        'validate.port-root-not-aggregate',
        `${port.id}: root cites ${port.root}, which is not an aggregate root`,
        port.source,
      );
  }
  for (const rec of registry.ports) {
    const id = `port:${rec.target.name}`;
    if (
      !ir.ports?.some(
        (p) => p.id === id && p.source === sourceOf(root, rec.source),
      )
    )
      continue;
    const source = sourceOf(root, rec.source);
    let ast: ReturnType<typeof abstractMethods>;
    try {
      ast = abstractMethods(rec.source.file, rec.source.line, rec.target.name);
    } catch (error) {
      err(
        'validate.port-source-unreadable',
        `${id}: could not read the source file (${error instanceof Error ? error.message : String(error)})`,
        source,
      );
      continue;
    }
    if (ast === null) {
      err(
        'validate.port-class-missing',
        `${id}: class not found in the source file to check the abstract methods`,
        source,
      );
      continue;
    }
    if (!ast.abstract) {
      err(
        'validate.port-not-abstract',
        `${id}: the class must be abstract`,
        source,
      );
      continue;
    }
    const declared = new Set(Object.keys(rec.methods));
    const missing = [...ast.methods].filter((m) => !declared.has(m)).sort();
    const extra = [...declared].filter((m) => !ast.methods.has(m)).sort();
    if (missing.length > 0)
      err(
        'validate.port-methods-undeclared',
        `${id}: abstract methods not declared in methods: ${missing.join(', ')}`,
        source,
      );
    if (extra.length > 0)
      err(
        'validate.port-methods-extra',
        `${id}: methods declares methods that the class does not have as abstract: ${extra.join(', ')}`,
        source,
      );
  }

  const adapterOf = new Map<string, string>();
  for (const adapter of ir.adapters ?? []) {
    claim(adapter.id, adapter.source);
    if (!PASCAL.test(adapter.name))
      err(
        'validate.name-pascal-case',
        `${adapter.id}: the class name must be PascalCase`,
        adapter.source,
      );
    required(adapter.description, `${adapter.id}: description`, adapter.source);
    const other = adapterOf.get(adapter.implements);
    if (other !== undefined)
      err(
        'validate.adapter-duplicate',
        `${adapter.id}: the port ${adapter.implements} already has the adapter ${other}`,
        adapter.source,
      );
    else adapterOf.set(adapter.implements, adapter.id);
    if (
      ir.ports?.find((p) => p.id === adapter.implements)?.methods.length === 0
    )
      err(
        'validate.adapter-port-empty',
        `${adapter.id}: ${adapter.implements} declares no methods; the adapter would have no obligations`,
        adapter.source,
      );
    const rec = registry.adapters.find(
      (r) =>
        `adapter:${r.target.name}` === adapter.id &&
        sourceOf(root, r.source) === adapter.source,
    );
    // buildIR already resolved implements without error; here only the inheritance is checked.
    const port = rec?.implements();
    if (typeof port === 'function' && !(rec!.target.prototype instanceof port))
      err(
        'validate.adapter-not-extending',
        `${adapter.id}: does not extend ${adapter.implements} (the class needs extends ${port.name} and the same copy of the package that declared the port)`,
        adapter.source,
      );
  }

  for (const useCase of ir.useCases) {
    claim(useCase.id, useCase.source);
    if (!SNAKE.test(useCase.name))
      err(
        'validate.usecase-name-format',
        `${useCase.id}: name must be snake_case (^[a-z][a-z0-9_]{0,63}$)`,
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
        err(
          'validate.uses-unknown',
          `${useCase.id}: uses cites ${use}, which does not exist`,
          useCase.source,
        );
      else
        for (const emitted of method.emits) {
          reachable.add(emitted);
          if (!declared.has(emitted))
            err(
              'validate.emit-undeclared',
              `${useCase.id}: ${method.id} emits ${emitted}, which is missing from emits (the runtime would refuse to publish it)`,
              useCase.source,
            );
        }
    }
    for (const emitted of useCase.emits) {
      if (!reachable.has(emitted))
        err(
          'validate.emit-unreachable',
          `${useCase.id}: emits ${emitted}, but no method in uses emits that event`,
          useCase.source,
        );
    }
  }

  for (const operator of ir.operators) {
    claim(operator.id, operator.source);
    if (!KEBAB.test(operator.name) || operator.name.length > 64) {
      err(
        'validate.operator-name-format',
        `${operator.id}: name must be kebab-case with up to 64 characters`,
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
      err(
        'validate.operator-usecases-empty',
        `${operator.id}: useCases cannot be empty`,
        operator.source,
      );
    const limitsProblem = limitsError(operator.limits);
    if (limitsProblem !== null)
      err(
        'validate.operator-limits-invalid',
        `${operator.id}: invalid limits (${limitsProblem})`,
        operator.source,
      );
    for (const approval of operator.requiresApproval) {
      if (!operator.useCases.includes(approval)) {
        err(
          'validate.operator-approval-unknown',
          `${operator.id}: requiresApproval cites ${approval}, which is not in useCases`,
          operator.source,
        );
      }
    }
  }

  const entityTargets = new Set(registry.entities.map((e) => e.target));
  for (const method of registry.methods) {
    if (!entityTargets.has(method.entity)) {
      err(
        'validate.method-entity-missing',
        `${method.entity.name}.${method.name} has @AgentMethod, but ${method.entity.name} has no @AgentEntity`,
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
        'validate.invariant-owner-ambiguous',
        isVo
          ? `@Invariant ${invariant.id} on ${invariant.entity.name}: the class has more than one of @AgentEntity, @AgentUseCase and @AgentValueObject, so the invariant owner is ambiguous`
          : `@Invariant ${invariant.id} on ${invariant.entity.name}: the class has @AgentEntity and @AgentUseCase, so the invariant owner is ambiguous`,
        sourceOf(root, invariant.source),
      );
    } else if (owners === 0) {
      err(
        'validate.invariant-owner-missing',
        `@Invariant ${invariant.id} on ${invariant.entity.name}, which has none of @AgentEntity, @AgentUseCase or @AgentValueObject`,
        sourceOf(root, invariant.source),
      );
    } else if (!isEntity && invariant.method !== null) {
      err(
        'validate.invariant-method-misplaced',
        `@Invariant ${invariant.id} on ${invariant.entity.name}.${invariant.method}: on a ${isVo ? 'value object' : 'use-case'}, @Invariant goes on the class`,
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
            'validate.method-undecorated',
            `${rec.target.name}.${key} is public and has no @AgentMethod: declare it or make it private (#${key})`,
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

// AggregateRoot warnings (not errors): a root without the base class and a child that extends it (ADR-0006 D4).
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
      warnings.push(
        `${entity.id}: aggregate root does not extend AggregateRoot`,
      );
    if (!roots.has(entity.id) && isAggregate)
      warnings.push(`${entity.id}: contained entity extends AggregateRoot`);
  }
  return warnings;
}
