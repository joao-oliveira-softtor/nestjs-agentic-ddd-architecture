# Plano 1 — Fundação e compilador de documentação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ter o toolchain Bun limpo, os building blocks DDD, os decorators autodeclarativos e um compilador determinístico que transforma o domínio decorado do exemplo `orders` em skills de runtime, skills de dev e no bloco gerado do `AGENTS.md`, com `compile`, `--check` e `--report`.

**Architecture:** Decorators só registram metadados explícitos (com `arquivo:linha` capturado do stack) num registry injetável. O compilador converte o registry numa IR canônica (`buildIR`), valida (`validate`), e renderers puros produzem um mapa `caminho → conteúdo`; uma camada separada escreve ou compara com o disco. O CLI (`bun run agentic compile`) importa os módulos listados em `agentic.config.ts` e orquestra tudo.

**Tech Stack:** Bun 1.4.2 (runtime, `bun test`, `bun build`), TypeScript 6 (`tsc --noEmit` para typecheck), NestJS 12 + `@nestbun/platform`, Zod 4.6 (`z.toJSONSchema`), `reflect-metadata`, oxlint.

**Spec:** [`docs/superpowers/specs/2026-10-06-agentic-ddd-v0-design.md`](../specs/2026-10-06-agentic-ddd-v0-design.md) — este plano cobre §3, §4, §5, §6.1–§6.5, §11 (sem changes), §12.1 (partes sem lock/changes), §12.2 (arquitetura) e §13.1 (higiene, README, CONTRIBUTING, CI). Lock, changes e `verify` ficam no plano 2; estado do projeto no plano 3; runtime no plano 4 (ver [índice](2026-10-06-v0-00-index.md)).

## Global Constraints

- Runtime e testes: **Bun 1.4.2**; testes com `bun test` importando de `bun:test`. Nada de Vitest, Jest ou supertest.
- ESM com `"module": "nodenext"`: imports relativos **com sufixo `.js`** (`./entity.js`), mesmo apontando para `.ts`.
- `isolatedModules` + `emitDecoratorMetadata`: tipo usado em assinatura de classe decorada (ex.: parâmetro de construtor) é importado com **`import type`**.
- Aliases (tsconfig `paths`): `@agentic-ddd/core`, `@agentic-ddd/decorators`, `@agentic-ddd/compiler`, `@agentic-ddd/testing` (e, nos planos seguintes, `@agentic-ddd/runtime`, `@agentic-ddd/nestjs`).
- `examples/**` importa o framework **só** via `@agentic-ddd/*`; `src/core` só importa `zod` e arquivos do próprio `core`.
- Zod v4 (`zod@^4.6`); JSON Schema **somente** via `z.toJSONSchema()` (sem dependência extra).
- Saída gerada determinística: chaves ordenadas, listas ordenadas por `id`, caminhos POSIX relativos, LF, newline final, sem timestamp.
- Frontmatter das skills: só `name` (≤64, `^[a-z0-9]+(-[a-z0-9]+)*$`, igual à pasta), `description` (1–1024) e `metadata` (`agentic-ddd.audience`, `agentic-ddd.generated`, `agentic-ddd.ir-hash`).
- Textos gerados, mensagens de erro e documentação em **pt-BR**; identificadores de código em inglês.
- Nenhum `@Controller` no repositório.
- Commits: Conventional Commits em pt-BR, **sem** `Co-Authored-By` e sem rodapé "Generated with Claude Code". Antes de commitar, `git config user.email` deve ser o e-mail correto do repositório (aqui: `joao.oliveira@softtor.com.br`).

## Review Focus

1. **Schema Zod não representável em JSON Schema** (ex.: `z.date()`) num use-case ou evento → erro de compilação com `arquivo:linha`, nunca exceção crua. Teste na Task 6.
2. **Duas entidades com o mesmo nome** (em módulos ou blocos diferentes) → erro de ID duplicado citando as duas fontes, nunca sobrescrita silenciosa. Teste na Task 7.
3. **Descrição com aspas, `|` ou quebra de linha** → frontmatter continua YAML válido numa linha e tabelas markdown não quebram. Teste na Task 9.
4. **Operator ou módulo removido do código** → a skill gerada órfã é removida no `compile` e acusada no `--check`; skills do usuário (sem a marca de gerado) nunca são tocadas. Teste na Task 12.
5. **`AGENTS.md` editado à mão** (texto fora do bloco, arquivo sem marcadores) → o texto manual é preservado e o bloco é anexado/substituído; `CLAUDE.md` existente nunca é sobrescrito. Teste na Task 12.

---

## Estrutura de arquivos

```
LICENSE  .gitattributes  agentic.config.ts  AGENTS.md  CLAUDE.md  README.md  CONTRIBUTING.md
.github/workflows/ci.yml
src/
  app.module.ts                  (modificado: sem controllers)
  main.ts                        (inalterado)
  core/
    entity.ts  aggregate-root.ts  value-object.ts  domain-event.ts  domain-error.ts
    not-implemented.ts  use-case.ts  repository.ts  index.ts  core.test.ts
  decorators/
    source.ts  registry.ts  domain.ts  application.ts  index.ts
    registry.test.ts  domain.test.ts  application.test.ts
  compiler/
    canonical.ts  ir.ts  validate.ts  analyze.ts  graph.ts
    config.ts  load.ts  write.ts  compile.ts  lint.ts  report.ts  index.ts
    render/ markdown.ts  frontmatter.ts  state-machine.ts  runtime-skill.ts  dev-skill.ts  agents-md.ts  index.ts
    __fixtures__/shop.ts
    ir.test.ts  validate.test.ts  graph.test.ts  runtime-skill.test.ts  dev-skill.test.ts
    render-all.test.ts  write.test.ts  compile.test.ts  lint.test.ts
  testing/
    covers.ts  context.ts  index.ts  testing.test.ts
  cli/
    main.ts  cli.test.ts
examples/orders/
  domain/ order.events.ts  order.ts  order.repository.ts
  application/ load-order.ts  create-order.ts  confirm-order.ts  cancel-order.ts
  infrastructure/ in-memory-order.repository.ts
  operators/ order.operator.ts
  test/ order.test.ts  use-cases.test.ts
test/
  app.test.ts  architecture.test.ts
  fixtures/located.ts
  fixtures/broken/agentic.config.ts  fixtures/broken/domain/thing.ts
.agents/skills/orders-dev/…   .claude/skills/orders-dev → link   .agentic/runtime/order-operator/…   (gerados)
```

Removidos: `src/app.controller.ts`, `src/app.controller.spec.ts`, `src/app.service.ts`, `test/app.e2e-spec.ts`, `vitest.config.ts`, `vitest.config.e2e.ts`, `tsconfig.build.json`.

---

### Task 1: Toolchain Bun e higiene do repositório

**Files:**
- Modify: `package.json`, `tsconfig.json`, `src/app.module.ts`
- Delete: `src/app.controller.ts`, `src/app.controller.spec.ts`, `src/app.service.ts`, `test/app.e2e-spec.ts`, `vitest.config.ts`, `vitest.config.e2e.ts`, `tsconfig.build.json`
- Create: `LICENSE`, `.gitattributes`, `test/app.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: scripts `test`, `typecheck`, `lint`, `build`, `agentic`; aliases `@agentic-ddd/*` no tsconfig; `AppModule` sem controllers.

- [ ] **Step 1: Commitar as mudanças de scaffold pendentes do usuário (se houver)**

Run: `git status --short`
Se aparecerem `package.json`, `bun.lock` e `src/main.ts` modificados (troca do Express por `@nestbun/platform`, feita antes deste plano), commitar só eles:

```bash
git config user.email   # deve ser joao.oliveira@softtor.com.br
git add package.json bun.lock src/main.ts
git commit -m "chore: roda o NestJS sobre Bun com @nestbun/platform"
```

- [ ] **Step 2: Escrever o teste que falha**

Create `test/app.test.ts`:

```ts
import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import { AppModule } from '../src/app.module.js';

describe('AppModule', () => {
  test('não registra nenhum controller', () => {
    expect(Reflect.getMetadata('controllers', AppModule) ?? []).toEqual([]);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `bun test test/app.test.ts`
Expected: FAIL — recebido `[AppController]`, esperado `[]`.

- [ ] **Step 4: Remover o scaffold de controller e o Vitest**

```bash
git rm -q src/app.controller.ts src/app.controller.spec.ts src/app.service.ts test/app.e2e-spec.ts vitest.config.ts vitest.config.e2e.ts tsconfig.build.json
bun remove @nestjs/platform-express @types/express @types/supertest supertest @vitest/coverage-v8 vite-tsconfig-paths vitest
bun add -d @types/bun@1.4.2
```

Replace `src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';

@Module({})
export class AppModule {}
```

- [ ] **Step 5: Atualizar `package.json`**

Trocar os campos `description`, `license` e o bloco `scripts` (manter `dependencies`/`devDependencies` como ficaram após o Step 4):

```json
  "description": "Framework NestJS + DDD em que use-cases são tools, operators (agentes de IA) substituem controllers e um compilador gera skills e AGENTS.md a partir do domínio decorado.",
  "license": "MIT",
  "scripts": {
    "build": "bun build ./src/main.ts --target=bun --packages=external --outdir=dist",
    "typecheck": "tsc --noEmit",
    "format": "prettier --write \"src/**/*.ts\" \"test/**/*.ts\"",
    "start": "bun src/main.ts",
    "start:dev": "bun --watch src/main.ts",
    "start:debug": "bun --inspect --watch src/main.ts",
    "start:prod": "bun dist/main.js",
    "lint": "oxlint --type-aware src/ test/",
    "test": "bun test",
    "test:cov": "bun test --coverage",
    "agentic": "bun src/cli/main.ts"
  },
```

(Remover o script `deploy` e os scripts `test:watch`, `test:debug`, `test:e2e`.)

- [ ] **Step 6: Substituir `tsconfig.json`**

```json
{
  "compilerOptions": {
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "resolvePackageJsonExports": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "ES2023",
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": ".",
    "skipLibCheck": true,
    "strict": true,
    "strictPropertyInitialization": false,
    "noEmit": true,
    "types": ["bun"],
    "paths": {
      "@agentic-ddd/core": ["./src/core/index.ts"],
      "@agentic-ddd/decorators": ["./src/decorators/index.ts"],
      "@agentic-ddd/compiler": ["./src/compiler/index.ts"],
      "@agentic-ddd/testing": ["./src/testing/index.ts"],
      "@agentic-ddd/runtime": ["./src/runtime/index.ts"],
      "@agentic-ddd/nestjs": ["./src/nestjs/index.ts"]
    }
  },
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 7: Criar `LICENSE` e `.gitattributes`**

`LICENSE`:

```
MIT License

Copyright (c) 2026 João Victor

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

`.gitattributes`:

```
.agentic/** linguist-generated=true
.agents/skills/** linguist-generated=true
.claude/skills/** linguist-generated=true
```

- [ ] **Step 8: Rodar tudo**

Run: `bun test && bun run typecheck && bun run lint && bun run build`
Expected: `1 pass`; `tsc` sem erros; oxlint sem erros; `dist/main.js` gerado.

- [ ] **Step 9: Commit**

```bash
git add -A package.json bun.lock tsconfig.json src/app.module.ts test/app.test.ts LICENSE .gitattributes
git commit -m "chore: migra testes para bun test e remove scaffold de controller"
```

---

### Task 2: Building blocks DDD (`src/core`)

**Files:**
- Create: `src/core/entity.ts`, `src/core/aggregate-root.ts`, `src/core/value-object.ts`, `src/core/domain-event.ts`, `src/core/domain-error.ts`, `src/core/not-implemented.ts`, `src/core/use-case.ts`, `src/core/repository.ts`, `src/core/index.ts`
- Test: `src/core/core.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces (`@agentic-ddd/core`):
  - `abstract class Entity<Id>` — `protected constructor(readonly id: Id)`, `equals(other): boolean`
  - `abstract class AggregateRoot<Id> extends Entity<Id>` — `protected record(event: DomainEvent): void`, `pullEvents(): DomainEvent[]`
  - `abstract class ValueObject<P extends object>` — `readonly props: Readonly<P>`, `equals(other): boolean`
  - `abstract class DomainEvent<P = unknown>` — `eventId`, `occurredAt`, `payload`, getters `name`, `correlationId`, `causationId`; `stamp(correlationId: string, causationId: string): void`; `interface DomainEventMeta { eventId?; occurredAt?; correlationId?; causationId? }`
  - `class DomainError extends Error` — `constructor(readonly code: string, message: string)`
  - `class NotImplementedError extends Error`; `function notImplemented(): never`
  - `interface UseCaseContext { correlationId: string; causationId: string; publish(events: readonly DomainEvent[]): Promise<void> }`
  - `interface UseCase<In, Out> { execute(input: In, ctx: UseCaseContext): Promise<Out> }`
  - `interface Repository<T, Id> { findById(id: Id): Promise<T | null>; save(aggregate: T): Promise<void> }`

- [ ] **Step 1: Escrever o teste que falha**

Create `src/core/core.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import {
  AggregateRoot,
  DomainError,
  DomainEvent,
  NotImplementedError,
  ValueObject,
  notImplemented,
} from '@agentic-ddd/core';

class Ping extends DomainEvent<{ n: number }> {}

class Counter extends AggregateRoot<string> {
  constructor(id: string) {
    super(id);
  }

  hit(): void {
    this.record(new Ping({ n: 1 }));
  }
}

class Money extends ValueObject<{ amount: number; currency: string }> {
  constructor(amount: number, currency: string) {
    super({ amount, currency });
  }
}

describe('core', () => {
  test('AggregateRoot acumula eventos e pullEvents os esvazia', () => {
    const counter = new Counter('c1');
    counter.hit();
    counter.hit();
    expect(counter.pullEvents().map((e) => e.name)).toEqual(['Ping', 'Ping']);
    expect(counter.pullEvents()).toEqual([]);
  });

  test('Entity compara por classe e id', () => {
    expect(new Counter('a').equals(new Counter('a'))).toBe(true);
    expect(new Counter('a').equals(new Counter('b'))).toBe(false);
    expect(new Counter('a').equals(null)).toBe(false);
  });

  test('ValueObject compara estruturalmente e congela as props', () => {
    const money = new Money(10, 'BRL');
    expect(money.equals(new Money(10, 'BRL'))).toBe(true);
    expect(money.equals(new Money(11, 'BRL'))).toBe(false);
    expect(Object.isFrozen(money.props)).toBe(true);
  });

  test('DomainEvent gera id e data e aceita um único carimbo de correlação', () => {
    const event = new Ping({ n: 1 }, { eventId: 'e1', occurredAt: new Date('2026-01-01T00:00:00Z') });
    expect(event.eventId).toBe('e1');
    expect(event.occurredAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(event.correlationId).toBeNull();
    event.stamp('run-1', 'step-1');
    expect([event.correlationId, event.causationId]).toEqual(['run-1', 'step-1']);
    expect(() => event.stamp('run-2', 'step-2')).toThrow('já foi carimbado');
  });

  test('DomainEvent sem meta gera eventId UUID', () => {
    expect(new Ping({ n: 1 }).eventId).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('DomainError carrega um code estável', () => {
    const error = new DomainError('ORDER_NOT_FOUND', 'Pedido não encontrado.');
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('ORDER_NOT_FOUND');
    expect(error.message).toBe('Pedido não encontrado.');
  });

  test('notImplemented lança NotImplementedError', () => {
    expect(() => notImplemented()).toThrow(NotImplementedError);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bun test src/core`
Expected: FAIL — `Cannot find module '@agentic-ddd/core'` (ou `./src/core/index.ts` inexistente).

- [ ] **Step 3: Implementar**

`src/core/entity.ts`:

```ts
export abstract class Entity<Id> {
  protected constructor(readonly id: Id) {}

  equals(other: Entity<Id> | null | undefined): boolean {
    return other != null && other.constructor === this.constructor && other.id === this.id;
  }
}
```

`src/core/domain-event.ts`:

```ts
export interface DomainEventMeta {
  readonly eventId?: string;
  readonly occurredAt?: Date;
  readonly correlationId?: string | null;
  readonly causationId?: string | null;
}

export abstract class DomainEvent<P = unknown> {
  readonly eventId: string;
  readonly occurredAt: Date;
  #correlationId: string | null;
  #causationId: string | null;

  constructor(
    readonly payload: P,
    meta: DomainEventMeta = {},
  ) {
    this.eventId = meta.eventId ?? crypto.randomUUID();
    this.occurredAt = meta.occurredAt ?? new Date();
    this.#correlationId = meta.correlationId ?? null;
    this.#causationId = meta.causationId ?? null;
  }

  get name(): string {
    return this.constructor.name;
  }

  get correlationId(): string | null {
    return this.#correlationId;
  }

  get causationId(): string | null {
    return this.#causationId;
  }

  stamp(correlationId: string, causationId: string): void {
    if (this.#correlationId !== null) {
      throw new Error(`Evento ${this.eventId} já foi carimbado`);
    }
    this.#correlationId = correlationId;
    this.#causationId = causationId;
  }
}
```

`src/core/aggregate-root.ts`:

```ts
import type { DomainEvent } from './domain-event.js';
import { Entity } from './entity.js';

export abstract class AggregateRoot<Id> extends Entity<Id> {
  #events: DomainEvent[] = [];

  protected record(event: DomainEvent): void {
    this.#events.push(event);
  }

  pullEvents(): DomainEvent[] {
    const events = this.#events;
    this.#events = [];
    return events;
  }
}
```

`src/core/value-object.ts`:

```ts
export abstract class ValueObject<P extends object> {
  readonly props: Readonly<P>;

  protected constructor(props: P) {
    this.props = Object.freeze({ ...props });
  }

  equals(other: ValueObject<P> | null | undefined): boolean {
    return other != null && other.constructor === this.constructor && deepEqual(this.props, other.props);
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => deepEqual(left[key], right[key]));
}
```

`src/core/domain-error.ts`:

```ts
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}
```

`src/core/not-implemented.ts`:

```ts
export class NotImplementedError extends Error {
  constructor() {
    super('Corpo declarado e ainda não implementado (notImplemented)');
    this.name = 'NotImplementedError';
  }
}

export function notImplemented(): never {
  throw new NotImplementedError();
}
```

`src/core/use-case.ts`:

```ts
import type { DomainEvent } from './domain-event.js';

export interface UseCaseContext {
  readonly correlationId: string;
  readonly causationId: string;
  publish(events: readonly DomainEvent[]): Promise<void>;
}

export interface UseCase<In, Out> {
  execute(input: In, ctx: UseCaseContext): Promise<Out>;
}
```

`src/core/repository.ts`:

```ts
export interface Repository<T, Id> {
  findById(id: Id): Promise<T | null>;
  save(aggregate: T): Promise<void>;
}
```

`src/core/index.ts`:

```ts
export { AggregateRoot } from './aggregate-root.js';
export { DomainError } from './domain-error.js';
export { DomainEvent, type DomainEventMeta } from './domain-event.js';
export { Entity } from './entity.js';
export { NotImplementedError, notImplemented } from './not-implemented.js';
export type { Repository } from './repository.js';
export type { UseCase, UseCaseContext } from './use-case.js';
export { ValueObject } from './value-object.js';
```

- [ ] **Step 4: Rodar e ver passar**

Run: `bun test src/core && bun run typecheck`
Expected: `7 pass`; `tsc` sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/core
git commit -m "feat(core): adiciona building blocks DDD"
```

---

### Task 3: Registry e captura de `arquivo:linha`

**Files:**
- Create: `src/decorators/source.ts`, `src/decorators/registry.ts`, `src/decorators/index.ts`, `test/fixtures/located.ts`
- Test: `src/decorators/registry.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces (`@agentic-ddd/decorators`):
  - `interface SourceLoc { file: string /* absoluto */; line: number }`; `function captureSource(): SourceLoc` — primeiro frame do stack fora dos arquivos de implementação de `src/decorators/` (arquivos `*.test.ts` dessa pasta contam como chamadores).
  - `type ClassRef = Function`
  - Records: `EntityRecord { target; description; states }`, `InvariantRecord { entity; method: string | null; id; text }`, `TransitionSpec { from: readonly string[]; to: string }`, `MethodRecord { entity; name; isStatic; description; emits: readonly ClassRef[]; transition: TransitionSpec | null; fn: Function }`, `EventRecord { target; description; payload: ZodType }`, `UseCaseRecord { target; name; description; whenToUse; whenNotToUse: string | null; input: ZodType; output: ZodType; uses: readonly string[]; emits: readonly ClassRef[] }`, `OperatorLimits { maxSteps; timeoutMs }`, `OperatorRecord { target; name; description; instructions; useCases: readonly ClassRef[]; requiresApproval: readonly ClassRef[]; limits: OperatorLimits; model: string }` — todos com `source: SourceLoc`.
  - `class Registry { entities; invariants; methods; events; useCases; operators /* arrays */; reset(): void }`
  - `defaultRegistry: Registry`, `activeRegistry(): Registry`, `createRegistry(): Registry`, `withRegistry<T>(registry, fn: () => T): T`

- [ ] **Step 1: Escrever a fixture e o teste que falha**

Create `test/fixtures/located.ts` (a chamada **precisa** ficar na linha 3):

```ts
import { captureSource } from '../../src/decorators/source.js';

export const located = captureSource();
```

Create `src/decorators/registry.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { activeRegistry, createRegistry, defaultRegistry, withRegistry } from '@agentic-ddd/decorators';
import { located } from '../../test/fixtures/located.js';

describe('captureSource', () => {
  test('aponta o arquivo e a linha de quem chamou', () => {
    expect(located.file.endsWith('/test/fixtures/located.ts')).toBe(true);
    expect(located.line).toBe(3);
  });
});

describe('registry', () => {
  test('withRegistry troca o registry ativo e restaura ao final', () => {
    const registry = createRegistry();
    expect(withRegistry(registry, () => activeRegistry())).toBe(registry);
    expect(activeRegistry()).toBe(defaultRegistry);
  });

  test('withRegistry restaura o registry mesmo quando a função lança', () => {
    const registry = createRegistry();
    expect(() =>
      withRegistry(registry, () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(activeRegistry()).toBe(defaultRegistry);
  });

  test('reset esvazia todas as listas', () => {
    const registry = createRegistry();
    registry.entities.push({ target: class X {}, description: 'x', states: [], source: { file: '/x.ts', line: 1 } });
    registry.reset();
    expect(registry.entities).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bun test src/decorators`
Expected: FAIL — módulo `../../src/decorators/source.js` não encontrado.

- [ ] **Step 3: Implementar**

`src/decorators/source.ts`:

```ts
import { dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface SourceLoc {
  readonly file: string;
  readonly line: number;
}

const SELF_DIR = `${dirname(fileURLToPath(import.meta.url))}${sep}`;
const FRAME = /((?:file:\/\/)?\/[^\s():]+\.[cm]?[jt]sx?):(\d+):\d+/;

function isDecoratorImplementation(file: string): boolean {
  return file.startsWith(SELF_DIR) && !file.endsWith('.test.ts');
}

export function captureSource(): SourceLoc {
  const frames = new Error().stack?.split('\n') ?? [];
  for (const frame of frames.slice(1)) {
    const match = FRAME.exec(frame);
    if (!match) continue;
    const raw = match[1]!;
    const file = raw.startsWith('file://') ? fileURLToPath(raw) : raw;
    if (isDecoratorImplementation(file)) continue;
    return { file, line: Number(match[2]) };
  }
  return { file: '<desconhecido>', line: 0 };
}
```

`src/decorators/registry.ts`:

```ts
import type { ZodType } from 'zod';
import type { SourceLoc } from './source.js';

export type ClassRef = Function;

export interface EntityRecord {
  readonly target: ClassRef;
  readonly description: string;
  readonly states: readonly string[];
  readonly source: SourceLoc;
}

export interface InvariantRecord {
  readonly entity: ClassRef;
  readonly method: string | null;
  readonly id: string;
  readonly text: string;
  readonly source: SourceLoc;
}

export interface TransitionSpec {
  readonly from: readonly string[];
  readonly to: string;
}

export interface MethodRecord {
  readonly entity: ClassRef;
  readonly name: string;
  readonly isStatic: boolean;
  readonly description: string;
  readonly emits: readonly ClassRef[];
  readonly transition: TransitionSpec | null;
  readonly fn: Function;
  readonly source: SourceLoc;
}

export interface EventRecord {
  readonly target: ClassRef;
  readonly description: string;
  readonly payload: ZodType;
  readonly source: SourceLoc;
}

export interface UseCaseRecord {
  readonly target: ClassRef;
  readonly name: string;
  readonly description: string;
  readonly whenToUse: string;
  readonly whenNotToUse: string | null;
  readonly input: ZodType;
  readonly output: ZodType;
  readonly uses: readonly string[];
  readonly emits: readonly ClassRef[];
  readonly source: SourceLoc;
}

export interface OperatorLimits {
  readonly maxSteps: number;
  readonly timeoutMs: number;
}

export interface OperatorRecord {
  readonly target: ClassRef;
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  readonly useCases: readonly ClassRef[];
  readonly requiresApproval: readonly ClassRef[];
  readonly limits: OperatorLimits;
  readonly model: string;
  readonly source: SourceLoc;
}

export class Registry {
  readonly entities: EntityRecord[] = [];
  readonly invariants: InvariantRecord[] = [];
  readonly methods: MethodRecord[] = [];
  readonly events: EventRecord[] = [];
  readonly useCases: UseCaseRecord[] = [];
  readonly operators: OperatorRecord[] = [];

  reset(): void {
    this.entities.length = 0;
    this.invariants.length = 0;
    this.methods.length = 0;
    this.events.length = 0;
    this.useCases.length = 0;
    this.operators.length = 0;
  }
}

export const defaultRegistry = new Registry();
let active: Registry = defaultRegistry;

export function activeRegistry(): Registry {
  return active;
}

export function createRegistry(): Registry {
  return new Registry();
}

export function withRegistry<T>(registry: Registry, fn: () => T): T {
  const previous = active;
  active = registry;
  try {
    return fn();
  } finally {
    active = previous;
  }
}
```

`src/decorators/index.ts`:

```ts
export {
  Registry,
  activeRegistry,
  createRegistry,
  defaultRegistry,
  withRegistry,
  type ClassRef,
  type EntityRecord,
  type EventRecord,
  type InvariantRecord,
  type MethodRecord,
  type OperatorLimits,
  type OperatorRecord,
  type TransitionSpec,
  type UseCaseRecord,
} from './registry.js';
export { captureSource, type SourceLoc } from './source.js';
```

- [ ] **Step 4: Rodar e ver passar**

Run: `bun test src/decorators && bun run typecheck`
Expected: `4 pass`; `tsc` sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/decorators test/fixtures/located.ts
git commit -m "feat(decorators): adiciona registry injetável e captura de arquivo:linha"
```

---

### Task 4: Decorators de domínio

**Files:**
- Create: `src/decorators/domain.ts`
- Modify: `src/decorators/index.ts`
- Test: `src/decorators/domain.test.ts`

**Interfaces:**
- Consumes: `activeRegistry`, `captureSource`, records da Task 3; `AggregateRoot`, `DomainEvent`, `notImplemented` da Task 2 (só no teste).
- Produces:
  - `AgentEntity(options: { description: string; states?: readonly string[] }): ClassDecorator`
  - `Invariant(options: { id: string; text: string }): ClassDecorator & MethodDecorator` — na classe grava `method: null`; num método grava o nome do método.
  - `AgentMethod(options: { description: string; emits?: readonly ClassRef[]; transition?: TransitionSpec }): MethodDecorator` — grava `isStatic` e `fn`.
  - `AgentEvent(options: { description: string; payload: ZodType }): ClassDecorator` — o nome do evento é o nome da classe.

- [ ] **Step 1: Escrever o teste que falha**

Create `src/decorators/domain.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { AggregateRoot, DomainEvent, notImplemented } from '@agentic-ddd/core';
import {
  AgentEntity,
  AgentEvent,
  AgentMethod,
  Invariant,
  createRegistry,
  defaultRegistry,
  withRegistry,
} from '@agentic-ddd/decorators';

function declareProduct() {
  const registry = createRegistry();
  const classes = withRegistry(registry, () => {
    @AgentEvent({ description: 'Produto publicado.', payload: z.object({ productId: z.string() }) })
    class ProductPublished extends DomainEvent<{ productId: string }> {}

    @AgentEntity({ description: 'Produto do catálogo.', states: ['draft', 'published'] })
    @Invariant({ id: 'preco-positivo', text: 'O preço é sempre maior que zero.' })
    class Product extends AggregateRoot<string> {
      @AgentMethod({ description: 'Cria um rascunho.' })
      static create(): Product {
        return notImplemented();
      }

      @AgentMethod({
        description: 'Publica o produto.',
        transition: { from: ['draft'], to: 'published' },
        emits: [ProductPublished],
      })
      @Invariant({ id: 'publicacao-exige-estoque', text: 'Só publica com estoque.' })
      publish(): void {
        notImplemented();
      }
    }

    return { Product, ProductPublished };
  });
  return { registry, ...classes };
}

describe('decorators de domínio', () => {
  test('@AgentEntity registra descrição e estados', () => {
    const { registry, Product } = declareProduct();
    expect(registry.entities).toHaveLength(1);
    expect(registry.entities[0]!.target).toBe(Product);
    expect(registry.entities[0]!.states).toEqual(['draft', 'published']);
  });

  test('@Invariant distingue classe e método', () => {
    const { registry, Product } = declareProduct();
    const byId = Object.fromEntries(registry.invariants.map((i) => [i.id, i]));
    expect(byId['preco-positivo']!.method).toBeNull();
    expect(byId['publicacao-exige-estoque']!.method).toBe('publish');
    expect(registry.invariants.every((i) => i.entity === Product)).toBe(true);
  });

  test('@AgentMethod registra estático, transição, emits e a função', () => {
    const { registry, Product, ProductPublished } = declareProduct();
    const create = registry.methods.find((m) => m.name === 'create')!;
    const publish = registry.methods.find((m) => m.name === 'publish')!;
    expect(create.isStatic).toBe(true);
    expect(create.entity).toBe(Product);
    expect(publish.isStatic).toBe(false);
    expect(publish.entity).toBe(Product);
    expect(publish.transition).toEqual({ from: ['draft'], to: 'published' });
    expect(publish.emits).toEqual([ProductPublished]);
    expect(publish.fn).toBe(Product.prototype.publish);
  });

  test('@AgentEvent registra o evento', () => {
    const { registry, ProductPublished } = declareProduct();
    expect(registry.events.map((e) => e.target)).toEqual([ProductPublished]);
  });

  test('a fonte aponta para este arquivo de teste', () => {
    const { registry } = declareProduct();
    const publish = registry.methods.find((m) => m.name === 'publish')!;
    expect(publish.source.file.endsWith('/src/decorators/domain.test.ts')).toBe(true);
    expect(publish.source.line).toBeGreaterThan(0);
  });

  test('decorators dentro de withRegistry não vazam para o registry default', () => {
    const { Product } = declareProduct();
    expect(defaultRegistry.entities.some((e) => e.target === Product)).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bun test src/decorators/domain.test.ts`
Expected: FAIL — `AgentEntity` não é exportado por `@agentic-ddd/decorators`.

- [ ] **Step 3: Implementar**

`src/decorators/domain.ts`:

```ts
import type { ZodType } from 'zod';
import { activeRegistry, type ClassRef, type TransitionSpec } from './registry.js';
import { captureSource } from './source.js';

export interface AgentEntityOptions {
  readonly description: string;
  readonly states?: readonly string[];
}

export function AgentEntity(options: AgentEntityOptions): ClassDecorator {
  const source = captureSource();
  return (target) => {
    activeRegistry().entities.push({
      target,
      description: options.description,
      states: options.states ?? [],
      source,
    });
  };
}

export interface InvariantOptions {
  readonly id: string;
  readonly text: string;
}

export function Invariant(options: InvariantOptions): ClassDecorator & MethodDecorator {
  const source = captureSource();
  const decorator = (target: object, key?: string | symbol): void => {
    const onClass = key === undefined;
    const entity = (onClass || typeof target === 'function' ? target : target.constructor) as ClassRef;
    activeRegistry().invariants.push({
      entity,
      method: onClass ? null : String(key),
      id: options.id,
      text: options.text,
      source,
    });
  };
  return decorator as ClassDecorator & MethodDecorator;
}

export interface AgentMethodOptions {
  readonly description: string;
  readonly emits?: readonly ClassRef[];
  readonly transition?: TransitionSpec;
}

export function AgentMethod(options: AgentMethodOptions): MethodDecorator {
  const source = captureSource();
  return (target, key, descriptor) => {
    const isStatic = typeof target === 'function';
    activeRegistry().methods.push({
      entity: (isStatic ? target : target.constructor) as ClassRef,
      name: String(key),
      isStatic,
      description: options.description,
      emits: options.emits ?? [],
      transition: options.transition ?? null,
      fn: descriptor.value as unknown as Function,
      source,
    });
  };
}

export interface AgentEventOptions {
  readonly description: string;
  readonly payload: ZodType;
}

export function AgentEvent(options: AgentEventOptions): ClassDecorator {
  const source = captureSource();
  return (target) => {
    activeRegistry().events.push({
      target,
      description: options.description,
      payload: options.payload,
      source,
    });
  };
}
```

Replace `src/decorators/index.ts`:

```ts
export {
  AgentEntity,
  AgentEvent,
  AgentMethod,
  Invariant,
  type AgentEntityOptions,
  type AgentEventOptions,
  type AgentMethodOptions,
  type InvariantOptions,
} from './domain.js';
export {
  Registry,
  activeRegistry,
  createRegistry,
  defaultRegistry,
  withRegistry,
  type ClassRef,
  type EntityRecord,
  type EventRecord,
  type InvariantRecord,
  type MethodRecord,
  type OperatorLimits,
  type OperatorRecord,
  type TransitionSpec,
  type UseCaseRecord,
} from './registry.js';
export { captureSource, type SourceLoc } from './source.js';
```

- [ ] **Step 4: Rodar e ver passar**

Run: `bun test src/decorators && bun run typecheck && bun run lint`
Expected: `10 pass`; sem erros de tipo nem de lint.

- [ ] **Step 5: Commit**

```bash
git add src/decorators
git commit -m "feat(decorators): adiciona @AgentEntity, @Invariant, @AgentMethod e @AgentEvent"
```

---

### Task 5: Decorators de aplicação (`@AgentUseCase`, `@Operator`)

**Files:**
- Create: `src/decorators/application.ts`
- Modify: `src/decorators/index.ts`
- Test: `src/decorators/application.test.ts`

**Interfaces:**
- Consumes: Task 3 e Task 4.
- Produces:
  - `AgentUseCase(options: { name; description; whenToUse; whenNotToUse?; input: ZodType; output: ZodType; uses: readonly string[]; emits?: readonly ClassRef[] }): ClassDecorator`
  - `Operator(options: { name; description; instructions; useCases: readonly ClassRef[]; requiresApproval?: readonly ClassRef[]; limits?: Partial<OperatorLimits>; model?: string }): ClassDecorator`
  - `DEFAULT_LIMITS = { maxSteps: 8, timeoutMs: 30_000 }`; `model` default `'default'`.

- [ ] **Step 1: Escrever o teste que falha**

Create `src/decorators/application.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { notImplemented } from '@agentic-ddd/core';
import { AgentUseCase, DEFAULT_LIMITS, Operator, createRegistry, withRegistry } from '@agentic-ddd/decorators';

function declareCatalog() {
  const registry = createRegistry();
  const classes = withRegistry(registry, () => {
    @AgentUseCase({
      name: 'publish_product',
      description: 'Publica um produto.',
      whenToUse: 'Quando pedirem para publicar.',
      input: z.object({ product_id: z.string() }),
      output: z.object({ product_id: z.string() }),
      uses: ['method:Product.publish'],
    })
    class PublishProduct {
      execute(): Promise<never> {
        return notImplemented();
      }
    }

    @Operator({
      name: 'catalog-operator',
      description: 'Opera o catálogo.',
      instructions: 'Use só as tools disponíveis.',
      useCases: [PublishProduct],
      requiresApproval: [PublishProduct],
      limits: { maxSteps: 3 },
    })
    class CatalogOperator {}

    return { PublishProduct, CatalogOperator };
  });
  return { registry, ...classes };
}

describe('decorators de aplicação', () => {
  test('@AgentUseCase registra contrato, uses e defaults', () => {
    const { registry, PublishProduct } = declareCatalog();
    const useCase = registry.useCases[0]!;
    expect(useCase.target).toBe(PublishProduct);
    expect(useCase.name).toBe('publish_product');
    expect(useCase.uses).toEqual(['method:Product.publish']);
    expect(useCase.whenNotToUse).toBeNull();
    expect(useCase.emits).toEqual([]);
  });

  test('@Operator registra allowlist, aprovação e mescla limites com o default', () => {
    const { registry, PublishProduct, CatalogOperator } = declareCatalog();
    const operator = registry.operators[0]!;
    expect(operator.target).toBe(CatalogOperator);
    expect(operator.useCases).toEqual([PublishProduct]);
    expect(operator.requiresApproval).toEqual([PublishProduct]);
    expect(operator.limits).toEqual({ maxSteps: 3, timeoutMs: DEFAULT_LIMITS.timeoutMs });
    expect(operator.model).toBe('default');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bun test src/decorators/application.test.ts`
Expected: FAIL — `AgentUseCase` não exportado.

- [ ] **Step 3: Implementar**

`src/decorators/application.ts`:

```ts
import type { ZodType } from 'zod';
import { activeRegistry, type ClassRef, type OperatorLimits } from './registry.js';
import { captureSource } from './source.js';

export interface AgentUseCaseOptions {
  readonly name: string;
  readonly description: string;
  readonly whenToUse: string;
  readonly whenNotToUse?: string;
  readonly input: ZodType;
  readonly output: ZodType;
  readonly uses: readonly string[];
  readonly emits?: readonly ClassRef[];
}

export function AgentUseCase(options: AgentUseCaseOptions): ClassDecorator {
  const source = captureSource();
  return (target) => {
    activeRegistry().useCases.push({
      target,
      name: options.name,
      description: options.description,
      whenToUse: options.whenToUse,
      whenNotToUse: options.whenNotToUse ?? null,
      input: options.input,
      output: options.output,
      uses: options.uses,
      emits: options.emits ?? [],
      source,
    });
  };
}

export const DEFAULT_LIMITS: OperatorLimits = { maxSteps: 8, timeoutMs: 30_000 };

export interface OperatorOptions {
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  readonly useCases: readonly ClassRef[];
  readonly requiresApproval?: readonly ClassRef[];
  readonly limits?: Partial<OperatorLimits>;
  readonly model?: string;
}

export function Operator(options: OperatorOptions): ClassDecorator {
  const source = captureSource();
  return (target) => {
    activeRegistry().operators.push({
      target,
      name: options.name,
      description: options.description,
      instructions: options.instructions,
      useCases: options.useCases,
      requiresApproval: options.requiresApproval ?? [],
      limits: { ...DEFAULT_LIMITS, ...options.limits },
      model: options.model ?? 'default',
      source,
    });
  };
}
```

Replace `src/decorators/index.ts`:

```ts
export {
  AgentUseCase,
  DEFAULT_LIMITS,
  Operator,
  type AgentUseCaseOptions,
  type OperatorOptions,
} from './application.js';
export {
  AgentEntity,
  AgentEvent,
  AgentMethod,
  Invariant,
  type AgentEntityOptions,
  type AgentEventOptions,
  type AgentMethodOptions,
  type InvariantOptions,
} from './domain.js';
export {
  Registry,
  activeRegistry,
  createRegistry,
  defaultRegistry,
  withRegistry,
  type ClassRef,
  type EntityRecord,
  type EventRecord,
  type InvariantRecord,
  type MethodRecord,
  type OperatorLimits,
  type OperatorRecord,
  type TransitionSpec,
  type UseCaseRecord,
} from './registry.js';
export { captureSource, type SourceLoc } from './source.js';
```

- [ ] **Step 4: Rodar e ver passar**

Run: `bun test src/decorators && bun run typecheck && bun run lint`
Expected: `12 pass`; sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/decorators
git commit -m "feat(decorators): adiciona @AgentUseCase e @Operator"
```

---
### Task 6: JSON canônico e construção da IR

**Files:**
- Create: `src/compiler/canonical.ts`, `src/compiler/ir.ts`, `src/compiler/__fixtures__/shop.ts`
- Test: `src/compiler/ir.test.ts`

**Interfaces:**
- Consumes: `Registry`, records e `SourceLoc` (Task 3–5); `z.toJSONSchema`.
- Produces:
  - `canonicalize(value: unknown): unknown`, `stableStringify(value: unknown): string` (chaves ordenadas, sem `undefined`, 2 espaços, `\n` final), `sha256(text: string): string`, `byId(a, b): number`
  - Tipos `JsonSchema`, `IRModule { name; path }`, `IRTransition`, `IRInvariant { id; text; on: string | null; source }`, `IRMethod { id; name; static; description; transition; emits; source }`, `IREntity { id; name; module; description; states; invariants; methods; source }`, `IREvent { id; name; module; description; payloadSchema; source }`, `IRUseCase { id; name; module; description; whenToUse; whenNotToUse; inputSchema; outputSchema; uses; emits; source }`, `IROperator { id; name; module; description; instructions; useCases; requiresApproval; limits; model; source }`, `IR { irVersion: 1; modules; entities; events; useCases; operators }`, `CompileError { message; source: string | null }`, `IRBuildOptions { root; modules }`, `IRBuildResult { ir; errors }`
  - `toPosix(path)`, `sourceOf(root, loc): string` (`caminho/relativo.ts:linha`), `irHash(ir): string`, `buildIR(registry, options): IRBuildResult`
  - Fixture `defineShop(): Registry` e `SHOP_MODULE = { name: 'shop', path: 'src/compiler/__fixtures__' }`, usados pelas Tasks 7, 9, 10 e 11.

- [ ] **Step 1: Criar a fixture `shop`**

Create `src/compiler/__fixtures__/shop.ts`:

```ts
import { z } from 'zod';
import { AggregateRoot, DomainEvent, notImplemented, type UseCase, type UseCaseContext } from '@agentic-ddd/core';
import {
  AgentEntity,
  AgentEvent,
  AgentMethod,
  AgentUseCase,
  Invariant,
  Operator,
  createRegistry,
  withRegistry,
  type Registry,
} from '@agentic-ddd/decorators';

export const SHOP_MODULE = { name: 'shop', path: 'src/compiler/__fixtures__' } as const;

export function defineShop(): Registry {
  const registry = createRegistry();
  withRegistry(registry, () => {
    @AgentEvent({ description: 'Um produto foi criado como rascunho.', payload: z.object({ productId: z.string() }) })
    class ProductCreated extends DomainEvent<{ productId: string }> {}

    @AgentEvent({ description: 'Um produto foi publicado no catálogo.', payload: z.object({ productId: z.string() }) })
    class ProductPublished extends DomainEvent<{ productId: string }> {}

    @AgentEntity({ description: 'Produto do catálogo da loja.', states: ['draft', 'published'] })
    @Invariant({ id: 'preco-positivo', text: 'O preço de um produto é sempre maior que zero.' })
    class Product extends AggregateRoot<string> {
      @AgentMethod({ description: 'Cria um produto em rascunho.', emits: [ProductCreated] })
      static create(): Product {
        return notImplemented();
      }

      @AgentMethod({
        description: 'Publica o produto no catálogo.',
        transition: { from: ['draft'], to: 'published' },
        emits: [ProductPublished],
      })
      @Invariant({ id: 'publicacao-exige-estoque', text: 'Só é possível publicar um produto com estoque maior que zero.' })
      publish(): void {
        notImplemented();
      }
    }

    const createInput = z.object({
      product_id: z.string().min(1).describe('Id do novo produto'),
      price: z.number().positive().describe('Preço em reais'),
    });
    const createOutput = z.object({ product_id: z.string(), status: z.literal('draft') });

    @AgentUseCase({
      name: 'create_product',
      description: 'Cria um produto em rascunho.',
      whenToUse: 'Quando pedirem para cadastrar um produto novo.',
      input: createInput,
      output: createOutput,
      uses: ['method:Product.create'],
      emits: [ProductCreated],
    })
    class CreateProduct implements UseCase<z.infer<typeof createInput>, z.infer<typeof createOutput>> {
      execute(_input: z.infer<typeof createInput>, _ctx: UseCaseContext): Promise<z.infer<typeof createOutput>> {
        return notImplemented();
      }
    }

    const publishInput = z.object({ product_id: z.string().min(1).describe('Id do produto a publicar') });
    const publishOutput = z.object({ product_id: z.string(), status: z.literal('published') });

    @AgentUseCase({
      name: 'publish_product',
      description: 'Publica um produto em rascunho no catálogo.',
      whenToUse: 'Quando pedirem para disponibilizar um produto para venda.',
      whenNotToUse: 'Para alterar preço ou estoque.',
      input: publishInput,
      output: publishOutput,
      uses: ['method:Product.publish'],
      emits: [ProductPublished],
    })
    class PublishProduct implements UseCase<z.infer<typeof publishInput>, z.infer<typeof publishOutput>> {
      execute(_input: z.infer<typeof publishInput>, _ctx: UseCaseContext): Promise<z.infer<typeof publishOutput>> {
        return notImplemented();
      }
    }

    @Operator({
      name: 'catalog-operator',
      description: 'Opera o catálogo de produtos: cadastrar e publicar. Use quando a conversa for sobre produtos da loja.',
      instructions: 'Você gerencia o catálogo. Use apenas as tools disponíveis e confirme o produto pelo id.',
      useCases: [CreateProduct, PublishProduct],
      requiresApproval: [PublishProduct],
    })
    class CatalogOperator {}

    void Product;
    void CatalogOperator;
  });
  return registry;
}
```

- [ ] **Step 2: Escrever o teste que falha**

Create `src/compiler/ir.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { z } from 'zod';
import { DomainEvent } from '@agentic-ddd/core';
import { AgentEvent, Registry, createRegistry, withRegistry } from '@agentic-ddd/decorators';
import { SHOP_MODULE, defineShop } from './__fixtures__/shop.js';
import { canonicalize, stableStringify } from './canonical.js';
import { buildIR } from './ir.js';

const ROOT = resolve(import.meta.dir, '../..');
const options = { root: ROOT, modules: [SHOP_MODULE] };

describe('canonical', () => {
  test('ordena chaves recursivamente e descarta undefined', () => {
    expect(JSON.stringify(canonicalize({ b: 1, a: { d: undefined, c: [{ z: 1, y: 2 }] } }))).toBe(
      '{"a":{"c":[{"y":2,"z":1}]},"b":1}',
    );
    expect(stableStringify({ b: 1, a: 2 })).toBe('{\n  "a": 2,\n  "b": 1\n}\n');
  });
});

describe('buildIR', () => {
  test('converte o shop sem erros', () => {
    const { ir, errors } = buildIR(defineShop(), options);
    expect(errors).toEqual([]);
    expect(ir.irVersion).toBe(1);
    expect(ir.entities.map((e) => e.id)).toEqual(['entity:Product']);
    expect(ir.events.map((e) => e.id)).toEqual(['event:ProductCreated', 'event:ProductPublished']);
    expect(ir.useCases.map((u) => u.id)).toEqual(['usecase:create_product', 'usecase:publish_product']);
    expect(ir.operators[0]!.useCases).toEqual(['usecase:create_product', 'usecase:publish_product']);
    expect(ir.operators[0]!.requiresApproval).toEqual(['usecase:publish_product']);
  });

  test('distingue invariantes de classe e de método e ordena por id', () => {
    const product = buildIR(defineShop(), options).ir.entities[0]!;
    expect(product.invariants.map((i) => [i.id, i.on])).toEqual([
      ['invariant:Product/preco-positivo', null],
      ['invariant:Product/publicacao-exige-estoque', 'method:Product.publish'],
    ]);
    expect(product.methods.map((m) => [m.id, m.static])).toEqual([
      ['method:Product.create', true],
      ['method:Product.publish', false],
    ]);
    expect(product.methods[1]!.emits).toEqual(['event:ProductPublished']);
  });

  test('usa fonte relativa POSIX com linha e o módulo configurado', () => {
    const product = buildIR(defineShop(), options).ir.entities[0]!;
    expect(product.source).toMatch(/^src\/compiler\/__fixtures__\/shop\.ts:\d+$/);
    expect(product.module).toBe('shop');
  });

  test('gera JSON Schema sem a chave $schema', () => {
    const publish = buildIR(defineShop(), options).ir.useCases.find((u) => u.name === 'publish_product')!;
    expect(publish.inputSchema.$schema).toBeUndefined();
    expect(publish.inputSchema.required).toEqual(['product_id']);
  });

  test('IR estável (snapshot)', () => {
    expect(stableStringify(buildIR(defineShop(), options).ir)).toMatchSnapshot();
  });

  test('não depende da ordem de registro', () => {
    const original = defineShop();
    const shuffled = new Registry();
    for (const key of ['entities', 'invariants', 'methods', 'events', 'useCases', 'operators'] as const) {
      (shuffled[key] as unknown[]).push(...[...(original[key] as unknown[])].reverse());
    }
    expect(stableStringify(buildIR(shuffled, options).ir)).toBe(stableStringify(buildIR(original, options).ir));
  });

  test('schema Zod não representável vira erro com arquivo:linha', () => {
    const registry = createRegistry();
    withRegistry(registry, () => {
      @AgentEvent({ description: 'Evento com data.', payload: z.object({ at: z.date() }) })
      class Dated extends DomainEvent<{ at: Date }> {}
      void Dated;
    });
    const { errors } = buildIR(registry, { root: ROOT, modules: [{ name: 'compiler', path: 'src/compiler' }] });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('não representável em JSON Schema');
    expect(errors[0]!.source).toMatch(/^src\/compiler\/ir\.test\.ts:\d+$/);
  });

  test('elemento fora dos módulos configurados vira erro', () => {
    const { errors } = buildIR(defineShop(), { root: ROOT, modules: [{ name: 'outro', path: 'examples/outro' }] });
    expect(errors.some((e) => e.message.includes('fora dos módulos'))).toBe(true);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `bun test src/compiler/ir.test.ts`
Expected: FAIL — `./canonical.js` não encontrado.

- [ ] **Step 4: Implementar**

`src/compiler/canonical.ts`:

```ts
import { createHash } from 'node:crypto';

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] !== undefined) result[key] = canonicalize(source[key]);
    }
    return result;
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function byId<T extends { readonly id: string }>(a: T, b: T): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
```

`src/compiler/ir.ts`:

```ts
import { relative, sep } from 'node:path';
import { z, type ZodType } from 'zod';
import type { ClassRef, Registry, SourceLoc } from '@agentic-ddd/decorators';
import { byId, sha256, stableStringify } from './canonical.js';

export type JsonSchema = Record<string, unknown>;

export interface IRModule {
  readonly name: string;
  readonly path: string;
}

export interface IRTransition {
  readonly from: string[];
  readonly to: string;
}

export interface IRInvariant {
  readonly id: string;
  readonly text: string;
  readonly on: string | null;
  readonly source: string;
}

export interface IRMethod {
  readonly id: string;
  readonly name: string;
  readonly static: boolean;
  readonly description: string;
  readonly transition: IRTransition | null;
  readonly emits: string[];
  readonly source: string;
}

export interface IREntity {
  readonly id: string;
  readonly name: string;
  readonly module: string;
  readonly description: string;
  readonly states: string[];
  readonly invariants: IRInvariant[];
  readonly methods: IRMethod[];
  readonly source: string;
}

export interface IREvent {
  readonly id: string;
  readonly name: string;
  readonly module: string;
  readonly description: string;
  readonly payloadSchema: JsonSchema;
  readonly source: string;
}

export interface IRUseCase {
  readonly id: string;
  readonly name: string;
  readonly module: string;
  readonly description: string;
  readonly whenToUse: string;
  readonly whenNotToUse: string | null;
  readonly inputSchema: JsonSchema;
  readonly outputSchema: JsonSchema;
  readonly uses: string[];
  readonly emits: string[];
  readonly source: string;
}

export interface IROperator {
  readonly id: string;
  readonly name: string;
  readonly module: string;
  readonly description: string;
  readonly instructions: string;
  readonly useCases: string[];
  readonly requiresApproval: string[];
  readonly limits: { readonly maxSteps: number; readonly timeoutMs: number };
  readonly model: string;
  readonly source: string;
}

export interface IR {
  readonly irVersion: 1;
  readonly modules: IRModule[];
  readonly entities: IREntity[];
  readonly events: IREvent[];
  readonly useCases: IRUseCase[];
  readonly operators: IROperator[];
}

export interface CompileError {
  readonly message: string;
  readonly source: string | null;
}

export interface IRBuildOptions {
  readonly root: string;
  readonly modules: readonly IRModule[];
}

export interface IRBuildResult {
  readonly ir: IR;
  readonly errors: CompileError[];
}

export const UNASSIGNED_MODULE = '<sem-modulo>';

export function toPosix(path: string): string {
  return path.split(sep).join('/');
}

export function sourceOf(root: string, loc: SourceLoc): string {
  return `${toPosix(relative(root, loc.file))}:${loc.line}`;
}

export function irHash(ir: IR): string {
  return sha256(stableStringify(ir));
}

export function buildIR(registry: Registry, options: IRBuildOptions): IRBuildResult {
  const errors: CompileError[] = [];
  const modules = [...options.modules].sort((a, b) => b.path.length - a.path.length);
  const loc = (s: SourceLoc): string => sourceOf(options.root, s);

  const moduleOf = (s: SourceLoc): string => {
    const file = toPosix(relative(options.root, s.file));
    const found = modules.find((m) => file === m.path || file.startsWith(`${m.path}/`));
    if (found) return found.name;
    errors.push({ message: 'elemento declarado fora dos módulos de agentic.config.ts', source: loc(s) });
    return UNASSIGNED_MODULE;
  };

  const eventId = (cls: ClassRef, at: SourceLoc): string => {
    if (!registry.events.some((e) => e.target === cls)) {
      errors.push({ message: `emits aponta para ${cls.name}, que não tem @AgentEvent`, source: loc(at) });
    }
    return `event:${cls.name}`;
  };

  const useCaseId = (cls: ClassRef, at: SourceLoc, owner: string): string => {
    const found = registry.useCases.find((u) => u.target === cls);
    if (found) return `usecase:${found.name}`;
    errors.push({ message: `${owner}: ${cls.name} não tem @AgentUseCase`, source: loc(at) });
    return `usecase:${cls.name}`;
  };

  const schema = (zod: ZodType, at: SourceLoc, what: string): JsonSchema => {
    try {
      const json: JsonSchema = { ...(z.toJSONSchema(zod) as JsonSchema) };
      delete json.$schema;
      return json;
    } catch (error) {
      errors.push({
        message: `${what}: schema Zod não representável em JSON Schema (${(error as Error).message})`,
        source: loc(at),
      });
      return {};
    }
  };

  const entities = registry.entities
    .map((rec): IREntity => {
      const name = rec.target.name;
      return {
        id: `entity:${name}`,
        name,
        module: moduleOf(rec.source),
        description: rec.description,
        states: [...rec.states],
        invariants: registry.invariants
          .filter((i) => i.entity === rec.target)
          .map((i) => ({
            id: `invariant:${name}/${i.id}`,
            text: i.text,
            on: i.method === null ? null : `method:${name}.${i.method}`,
            source: loc(i.source),
          }))
          .sort(byId),
        methods: registry.methods
          .filter((m) => m.entity === rec.target)
          .map((m) => ({
            id: `method:${name}.${m.name}`,
            name: m.name,
            static: m.isStatic,
            description: m.description,
            transition: m.transition ? { from: [...m.transition.from], to: m.transition.to } : null,
            emits: m.emits.map((e) => eventId(e, m.source)).sort(),
            source: loc(m.source),
          }))
          .sort(byId),
        source: loc(rec.source),
      };
    })
    .sort(byId);

  const events = registry.events
    .map((rec): IREvent => ({
      id: `event:${rec.target.name}`,
      name: rec.target.name,
      module: moduleOf(rec.source),
      description: rec.description,
      payloadSchema: schema(rec.payload, rec.source, `event:${rec.target.name} payload`),
      source: loc(rec.source),
    }))
    .sort(byId);

  const useCases = registry.useCases
    .map((rec): IRUseCase => ({
      id: `usecase:${rec.name}`,
      name: rec.name,
      module: moduleOf(rec.source),
      description: rec.description,
      whenToUse: rec.whenToUse,
      whenNotToUse: rec.whenNotToUse,
      inputSchema: schema(rec.input, rec.source, `usecase:${rec.name} input`),
      outputSchema: schema(rec.output, rec.source, `usecase:${rec.name} output`),
      uses: [...rec.uses].sort(),
      emits: rec.emits.map((e) => eventId(e, rec.source)).sort(),
      source: loc(rec.source),
    }))
    .sort(byId);

  const operators = registry.operators
    .map((rec): IROperator => {
      const owner = `operator:${rec.name}`;
      return {
        id: owner,
        name: rec.name,
        module: moduleOf(rec.source),
        description: rec.description,
        instructions: rec.instructions,
        useCases: rec.useCases.map((u) => useCaseId(u, rec.source, owner)).sort(),
        requiresApproval: rec.requiresApproval.map((u) => useCaseId(u, rec.source, owner)).sort(),
        limits: { maxSteps: rec.limits.maxSteps, timeoutMs: rec.limits.timeoutMs },
        model: rec.model,
        source: loc(rec.source),
      };
    })
    .sort(byId);

  return {
    ir: {
      irVersion: 1,
      modules: [...options.modules].map((m) => ({ name: m.name, path: m.path })).sort((a, b) => (a.name < b.name ? -1 : 1)),
      entities,
      events,
      useCases,
      operators,
    },
    errors,
  };
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `bun test src/compiler && bun run typecheck && bun run lint`
Expected: `9 pass` (1 snapshot escrito em `src/compiler/__snapshots__/ir.test.ts.snap`); sem erros. Abrir o snapshot e conferir que não há caminho absoluto nem timestamp.

- [ ] **Step 6: Commit**

```bash
git add src/compiler
git commit -m "feat(compiler): constrói IR canônica a partir do registry"
```

---

### Task 7: Validação do domínio declarado

**Files:**
- Create: `src/compiler/validate.ts`, `src/compiler/analyze.ts`
- Test: `src/compiler/validate.test.ts`

**Interfaces:**
- Consumes: `buildIR`, `sourceOf`, tipos da IR (Task 6); `Registry` (Task 3).
- Produces:
  - `validate(ir: IR, registry: Registry, root: string): CompileError[]`
  - `analyze(registry: Registry, options: IRBuildOptions): IRBuildResult` — `buildIR` + `validate`, erros ordenados por `fonte|mensagem`. **É a função que o resto do compilador usa.**

- [ ] **Step 1: Escrever o teste que falha**

Create `src/compiler/validate.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { z } from 'zod';
import { AggregateRoot, DomainEvent } from '@agentic-ddd/core';
import {
  AgentEntity,
  AgentEvent,
  AgentMethod,
  AgentUseCase,
  Invariant,
  Operator,
  createRegistry,
  withRegistry,
} from '@agentic-ddd/decorators';
import { SHOP_MODULE, defineShop } from './__fixtures__/shop.js';
import { analyze } from './analyze.js';

const ROOT = resolve(import.meta.dir, '../..');
const HERE = /^src\/compiler\/validate\.test\.ts:\d+ /;
const io = { input: z.object({}), output: z.object({}) };

function errorsOf(define: () => void): string[] {
  const registry = createRegistry();
  withRegistry(registry, define);
  return analyze(registry, { root: ROOT, modules: [{ name: 'compiler', path: 'src/compiler' }] }).errors.map(
    (e) => `${e.source ?? '-'} ${e.message}`,
  );
}

describe('validate', () => {
  test('o shop é válido', () => {
    expect(analyze(defineShop(), { root: ROOT, modules: [SHOP_MODULE] }).errors).toEqual([]);
  });

  test('id de invariante precisa ser kebab-case', () => {
    const errors = errorsOf(() => {
      @AgentEntity({ description: 'Coisa.' })
      @Invariant({ id: 'Id Ruim', text: 'Regra.' })
      class Thing extends AggregateRoot<string> {}
      void Thing;
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(HERE);
    expect(errors[0]).toContain('invariant:Thing/Id Ruim: o id da invariante deve ser kebab-case');
  });

  test('transição exige states declarados na entidade', () => {
    const errors = errorsOf(() => {
      @AgentEntity({ description: 'Porta.' })
      class Door extends AggregateRoot<string> {
        @AgentMethod({ description: 'Abre.', transition: { from: ['closed'], to: 'open' } })
        open(): void {}
      }
      void Door;
    });
    expect(errors.some((e) => e.includes('entity:Door tem métodos com transition, mas @AgentEntity não declara states'))).toBe(true);
  });

  test('transição com estado desconhecido', () => {
    const errors = errorsOf(() => {
      @AgentEntity({ description: 'Porta.', states: ['closed', 'open'] })
      class Door extends AggregateRoot<string> {
        @AgentMethod({ description: 'Abre.', transition: { from: ['locked'], to: 'open' } })
        open(): void {}
      }
      void Door;
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('method:Door.open: estado "locked" não está em states de Door');
  });

  test('emits precisa apontar para classe com @AgentEvent', () => {
    const errors = errorsOf(() => {
      class NotAnEvent {}
      @AgentEntity({ description: 'Sino.' })
      class Bell extends AggregateRoot<string> {
        @AgentMethod({ description: 'Toca.', emits: [NotAnEvent] })
        ring(): void {}
      }
      void Bell;
    });
    expect(errors.some((e) => e.includes('emits aponta para NotAnEvent, que não tem @AgentEvent'))).toBe(true);
  });

  test('uses precisa citar método existente', () => {
    const errors = errorsOf(() => {
      @AgentUseCase({ name: 'do_it', description: 'Faz.', whenToUse: 'Sempre.', ...io, uses: ['method:Ghost.boo'] })
      class DoIt {}
      void DoIt;
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('usecase:do_it: uses cita method:Ghost.boo, que não existe');
  });

  test('emits do use-case precisa vir dos métodos em uses', () => {
    const errors = errorsOf(() => {
      @AgentEvent({ description: 'Tocou.', payload: z.object({}) })
      class Rang extends DomainEvent<object> {}
      @AgentEntity({ description: 'Sino.' })
      class Bell extends AggregateRoot<string> {
        @AgentMethod({ description: 'Toca.' })
        ring(): void {}
      }
      @AgentUseCase({ name: 'ring_bell', description: 'Toca.', whenToUse: 'Sempre.', ...io, uses: ['method:Bell.ring'], emits: [Rang] })
      class RingBell {}
      void Bell;
      void RingBell;
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('usecase:ring_bell: emite event:Rang, mas nenhum método em uses emite esse evento');
  });

  test('requiresApproval precisa estar na allowlist', () => {
    const errors = errorsOf(() => {
      @AgentUseCase({ name: 'a_case', description: 'A.', whenToUse: 'A.', ...io, uses: [] })
      class ACase {}
      @AgentUseCase({ name: 'b_case', description: 'B.', whenToUse: 'B.', ...io, uses: [] })
      class BCase {}
      @Operator({ name: 'op', description: 'Op.', instructions: 'Op.', useCases: [ACase], requiresApproval: [BCase] })
      class Op {}
      void Op;
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('operator:op: requiresApproval cita usecase:b_case, que não está em useCases');
  });

  test('operator com classe sem @AgentUseCase', () => {
    const errors = errorsOf(() => {
      class Plain {}
      @Operator({ name: 'op', description: 'Op.', instructions: 'Op.', useCases: [Plain] })
      class Op {}
      void Op;
    });
    expect(errors.some((e) => e.includes('operator:op: Plain não tem @AgentUseCase'))).toBe(true);
  });

  test('método público sem @AgentMethod é erro; #privado e getters não', () => {
    const errors = errorsOf(() => {
      @AgentEntity({ description: 'Conta.' })
      class Account extends AggregateRoot<string> {
        get balance(): number {
          return this.#secret();
        }

        helper(): void {}

        #secret(): number {
          return 0;
        }
      }
      void Account;
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Account.helper é público e não tem @AgentMethod');
  });

  test('duas entidades com o mesmo nome geram ID duplicado', () => {
    const errors = errorsOf(() => {
      {
        @AgentEntity({ description: 'Item A.' })
        class Item extends AggregateRoot<string> {}
        void Item;
      }
      {
        @AgentEntity({ description: 'Item B.' })
        class Item extends AggregateRoot<string> {}
        void Item;
      }
    });
    expect(errors.some((e) => e.includes('ID duplicado entity:Item (também declarado em src/compiler/validate.test.ts:'))).toBe(true);
  });

  test('nome de use-case precisa ser snake_case e whenToUse não pode ser vazio', () => {
    const errors = errorsOf(() => {
      @AgentUseCase({ name: 'PublishProduct', description: 'Publica.', whenToUse: ' ', ...io, uses: [] })
      class PublishProduct {}
      void PublishProduct;
    });
    expect(errors.some((e) => e.includes('name deve ser snake_case'))).toBe(true);
    expect(errors.some((e) => e.includes('whenToUse é obrigatório'))).toBe(true);
  });

  test('@Invariant em método sem @AgentMethod', () => {
    const errors = errorsOf(() => {
      @AgentEntity({ description: 'Caixa.' })
      class Box extends AggregateRoot<string> {
        @Invariant({ id: 'nunca-cheia', text: 'Nunca cheia.' })
        fill(): void {}
      }
      void Box;
    });
    expect(errors.some((e) => e.includes('invariant:Box/nunca-cheia está num método sem @AgentMethod (method:Box.fill)'))).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bun test src/compiler/validate.test.ts`
Expected: FAIL — `./analyze.js` não encontrado.

- [ ] **Step 3: Implementar**

`src/compiler/validate.ts`:

```ts
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
```

`src/compiler/analyze.ts`:

```ts
import type { Registry } from '@agentic-ddd/decorators';
import { buildIR, type CompileError, type IRBuildOptions, type IRBuildResult } from './ir.js';
import { validate } from './validate.js';

function errorKey(error: CompileError): string {
  return `${error.source ?? ''}|${error.message}`;
}

export function analyze(registry: Registry, options: IRBuildOptions): IRBuildResult {
  const built = buildIR(registry, options);
  const errors = [...built.errors, ...validate(built.ir, registry, options.root)].sort((a, b) =>
    errorKey(a) < errorKey(b) ? -1 : errorKey(a) > errorKey(b) ? 1 : 0,
  );
  return { ir: built.ir, errors };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `bun test src/compiler && bun run typecheck && bun run lint`
Expected: `22 pass`; sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/compiler
git commit -m "feat(compiler): valida o domínio declarado com erros em arquivo:linha"
```

---

### Task 8: Helpers de teste e domínio de exemplo `orders`

**Files:**
- Create: `src/testing/covers.ts`, `src/testing/context.ts`, `src/testing/index.ts`, `src/testing/testing.test.ts`
- Create: `examples/orders/domain/order.events.ts`, `examples/orders/domain/order.ts`, `examples/orders/domain/order.repository.ts`, `examples/orders/application/load-order.ts`, `examples/orders/application/create-order.ts`, `examples/orders/application/confirm-order.ts`, `examples/orders/application/cancel-order.ts`, `examples/orders/infrastructure/in-memory-order.repository.ts`, `examples/orders/operators/order.operator.ts`
- Test: `examples/orders/test/order.test.ts`, `examples/orders/test/use-cases.test.ts`
- Modify: `package.json` (scripts `lint` e `format` passam a incluir `examples/`)

**Interfaces:**
- Consumes: `@agentic-ddd/core` (Task 2), `@agentic-ddd/decorators` (Tasks 3–5).
- Produces:
  - `@agentic-ddd/testing`: `covers(ids: readonly string[], title: string): string` (ex.: `"[covers: invariant:Order/x, method:Order.confirm] título"`, IDs ordenados e únicos; lança para lista vazia ou ID fora de `tipo:caminho`), `parseCovers(testName: string): string[]`, `interface TestContext extends UseCaseContext { readonly published: DomainEvent[] }`, `createTestContext(ids?: { correlationId?; causationId? }): TestContext`
  - Exemplo: `Order` (`create`, `confirm`, `cancel`, getters `status`, `total`), `OrderCreated`, `OrderConfirmed`, `OrderCancelled`, `type OrderRepository`, `InMemoryOrderRepository`, `CreateOrder`, `ConfirmOrder`, `CancelOrder` (construtor recebe `OrderRepository`), `OrderOperator`.

- [ ] **Step 1: Escrever os testes dos helpers (falham)**

Create `src/testing/testing.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { DomainEvent } from '@agentic-ddd/core';
import { covers, createTestContext, parseCovers } from '@agentic-ddd/testing';

class Ping extends DomainEvent<object> {}

describe('covers', () => {
  test('ordena, remove duplicatas e prefixa o título', () => {
    expect(covers(['method:Order.confirm', 'invariant:Order/x', 'method:Order.confirm'], 'confirma')).toBe(
      '[covers: invariant:Order/x, method:Order.confirm] confirma',
    );
  });

  test('rejeita lista vazia e ID malformado', () => {
    expect(() => covers([], 'x')).toThrow('ao menos um ID');
    expect(() => covers(['Order.confirm'], 'x')).toThrow('ID inválido');
  });

  test('parseCovers devolve os IDs do nome do teste', () => {
    expect(parseCovers('[covers: invariant:Order/x, method:Order.confirm] confirma')).toEqual([
      'invariant:Order/x',
      'method:Order.confirm',
    ]);
    expect(parseCovers('teste comum')).toEqual([]);
  });
});

describe('createTestContext', () => {
  test('carimba e acumula os eventos publicados', async () => {
    const ctx = createTestContext({ correlationId: 'run-1', causationId: 'step-1' });
    const event = new Ping({});
    await ctx.publish([event]);
    expect(ctx.published).toEqual([event]);
    expect([event.correlationId, event.causationId]).toEqual(['run-1', 'step-1']);
  });
});
```

Run: `bun test src/testing`
Expected: FAIL — `@agentic-ddd/testing` não encontrado.

- [ ] **Step 2: Implementar os helpers**

`src/testing/covers.ts`:

```ts
const ELEMENT_ID = /^(entity|invariant|method|event|usecase|operator|criterion):\S+$/;
const COVERS_PREFIX = /^\[covers: ([^\]]+)\]/;

export function covers(ids: readonly string[], title: string): string {
  if (ids.length === 0) throw new Error('covers() exige ao menos um ID');
  for (const id of ids) {
    if (!ELEMENT_ID.test(id)) throw new Error(`ID inválido em covers(): ${id} (esperado tipo:caminho, ex.: method:Order.confirm)`);
  }
  return `[covers: ${[...new Set(ids)].sort().join(', ')}] ${title}`;
}

export function parseCovers(testName: string): string[] {
  const match = COVERS_PREFIX.exec(testName);
  return match ? match[1]!.split(', ') : [];
}
```

`src/testing/context.ts`:

```ts
import type { DomainEvent, UseCaseContext } from '@agentic-ddd/core';

export interface TestContext extends UseCaseContext {
  readonly published: DomainEvent[];
}

export function createTestContext(ids: { correlationId?: string; causationId?: string } = {}): TestContext {
  const correlationId = ids.correlationId ?? 'test-run';
  const causationId = ids.causationId ?? 'test-step';
  const published: DomainEvent[] = [];
  return {
    correlationId,
    causationId,
    published,
    async publish(events) {
      for (const event of events) {
        event.stamp(correlationId, causationId);
        published.push(event);
      }
    },
  };
}
```

`src/testing/index.ts`:

```ts
export { createTestContext, type TestContext } from './context.js';
export { covers, parseCovers } from './covers.js';
```

Run: `bun test src/testing`
Expected: `4 pass`.

- [ ] **Step 3: Escrever os testes do exemplo (falham)**

Create `examples/orders/test/order.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { DomainError } from '@agentic-ddd/core';
import { covers } from '@agentic-ddd/testing';
import { Order } from '../domain/order.js';

const item = { sku: 'SKU-1', quantity: 2, unitPrice: 10 };

function newOrder(): Order {
  const order = Order.create({ id: 'o1', customerId: 'c1', items: [item] });
  order.pullEvents();
  return order;
}

function expectDomainError(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    return;
  }
  throw new Error(`esperava DomainError ${code}`);
}

describe('Order', () => {
  test(covers(['method:Order.create'], 'cria pedido pendente e emite OrderCreated'), () => {
    const order = Order.create({ id: 'o1', customerId: 'c1', items: [item] });
    expect(order.status).toBe('pending');
    expect(order.total).toBe(20);
    const events = order.pullEvents();
    expect(events.map((e) => e.name)).toEqual(['OrderCreated']);
    expect(events[0]!.payload).toEqual({ orderId: 'o1', customerId: 'c1', total: 20 });
  });

  test(covers(['invariant:Order/ao-menos-um-item'], 'rejeita pedido sem itens'), () => {
    expectDomainError(() => Order.create({ id: 'o1', customerId: 'c1', items: [] }), 'ORDER_WITHOUT_ITEMS');
  });

  test(covers(['invariant:Order/total-nao-negativo'], 'rejeita pedido com total negativo'), () => {
    expectDomainError(
      () => Order.create({ id: 'o1', customerId: 'c1', items: [{ sku: 'X', quantity: 1, unitPrice: -5 }] }),
      'ORDER_NEGATIVE_TOTAL',
    );
  });

  test(covers(['method:Order.confirm'], 'confirma pedido pendente e emite OrderConfirmed'), () => {
    const order = newOrder();
    order.confirm();
    expect(order.status).toBe('confirmed');
    expect(order.pullEvents().map((e) => e.name)).toEqual(['OrderConfirmed']);
  });

  test(covers(['method:Order.confirm'], 'não confirma pedido cancelado'), () => {
    const order = newOrder();
    order.cancel();
    expectDomainError(() => order.confirm(), 'ORDER_INVALID_TRANSITION');
  });

  test(covers(['method:Order.cancel'], 'cancela pedido pendente ou confirmado e emite OrderCancelled'), () => {
    const pending = newOrder();
    pending.cancel();
    expect(pending.status).toBe('cancelled');
    expect(pending.pullEvents().map((e) => e.name)).toEqual(['OrderCancelled']);
    const confirmed = newOrder();
    confirmed.confirm();
    confirmed.cancel();
    expect(confirmed.status).toBe('cancelled');
  });

  test(covers(['method:Order.cancel'], 'não cancela pedido já cancelado'), () => {
    const order = newOrder();
    order.cancel();
    expectDomainError(() => order.cancel(), 'ORDER_INVALID_TRANSITION');
  });
});
```

Create `examples/orders/test/use-cases.test.ts`:

```ts
import { beforeEach, describe, expect, test } from 'bun:test';
import { DomainError } from '@agentic-ddd/core';
import { covers, createTestContext } from '@agentic-ddd/testing';
import { CancelOrder } from '../application/cancel-order.js';
import { ConfirmOrder } from '../application/confirm-order.js';
import { CreateOrder } from '../application/create-order.js';
import { InMemoryOrderRepository } from '../infrastructure/in-memory-order.repository.js';

const input = { order_id: 'o1', customer_id: 'c1', items: [{ sku: 'SKU-1', quantity: 2, unit_price: 10 }] };

let orders: InMemoryOrderRepository;

beforeEach(() => {
  orders = new InMemoryOrderRepository();
});

async function rejectsWith(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);
}

describe('use-cases de orders', () => {
  test(covers(['usecase:create_order'], 'cria, persiste e publica OrderCreated carimbado'), async () => {
    const ctx = createTestContext({ correlationId: 'run-1', causationId: 'step-1' });
    const output = await new CreateOrder(orders).execute(input, ctx);
    expect(output).toEqual({ order_id: 'o1', status: 'pending', total: 20 });
    expect((await orders.findById('o1'))?.status).toBe('pending');
    expect(ctx.published.map((e) => [e.name, e.correlationId])).toEqual([['OrderCreated', 'run-1']]);
  });

  test(covers(['usecase:create_order'], 'recusa id de pedido já existente'), async () => {
    await new CreateOrder(orders).execute(input, createTestContext());
    await rejectsWith(new CreateOrder(orders).execute(input, createTestContext()), 'ORDER_ALREADY_EXISTS');
  });

  test(covers(['usecase:confirm_order'], 'confirma pedido existente e publica OrderConfirmed'), async () => {
    await new CreateOrder(orders).execute(input, createTestContext());
    const ctx = createTestContext();
    expect(await new ConfirmOrder(orders).execute({ order_id: 'o1' }, ctx)).toEqual({ order_id: 'o1', status: 'confirmed' });
    expect(ctx.published.map((e) => e.name)).toEqual(['OrderConfirmed']);
  });

  test(covers(['usecase:confirm_order'], 'falha com ORDER_NOT_FOUND para pedido inexistente'), async () => {
    await rejectsWith(new ConfirmOrder(orders).execute({ order_id: 'nada' }, createTestContext()), 'ORDER_NOT_FOUND');
  });

  test(covers(['usecase:cancel_order'], 'cancela pedido e publica OrderCancelled'), async () => {
    await new CreateOrder(orders).execute(input, createTestContext());
    const ctx = createTestContext();
    expect(await new CancelOrder(orders).execute({ order_id: 'o1' }, ctx)).toEqual({ order_id: 'o1', status: 'cancelled' });
    expect(ctx.published.map((e) => e.name)).toEqual(['OrderCancelled']);
  });
});
```

Run: `bun test examples`
Expected: FAIL — `../domain/order.js` não encontrado.

- [ ] **Step 4: Implementar o domínio do exemplo**

`examples/orders/domain/order.events.ts`:

```ts
import { z } from 'zod';
import { DomainEvent } from '@agentic-ddd/core';
import { AgentEvent } from '@agentic-ddd/decorators';

export interface OrderCreatedPayload {
  readonly orderId: string;
  readonly customerId: string;
  readonly total: number;
}

@AgentEvent({
  description: 'Um pedido foi criado e está pendente.',
  payload: z.object({ orderId: z.string(), customerId: z.string(), total: z.number() }),
})
export class OrderCreated extends DomainEvent<OrderCreatedPayload> {}

@AgentEvent({ description: 'Um pedido pendente foi confirmado.', payload: z.object({ orderId: z.string() }) })
export class OrderConfirmed extends DomainEvent<{ readonly orderId: string }> {}

@AgentEvent({ description: 'Um pedido foi cancelado.', payload: z.object({ orderId: z.string() }) })
export class OrderCancelled extends DomainEvent<{ readonly orderId: string }> {}
```

`examples/orders/domain/order.ts`:

```ts
import { AggregateRoot, DomainError } from '@agentic-ddd/core';
import { AgentEntity, AgentMethod, Invariant } from '@agentic-ddd/decorators';
import { OrderCancelled, OrderConfirmed, OrderCreated } from './order.events.js';

export type OrderStatus = 'pending' | 'confirmed' | 'cancelled';

export interface OrderItem {
  readonly sku: string;
  readonly quantity: number;
  readonly unitPrice: number;
}

export interface CreateOrderProps {
  readonly id: string;
  readonly customerId: string;
  readonly items: readonly OrderItem[];
}

@AgentEntity({
  description: 'Pedido de compra de um cliente, com itens e ciclo de vida pendente, confirmado ou cancelado.',
  states: ['pending', 'confirmed', 'cancelled'],
})
@Invariant({ id: 'ao-menos-um-item', text: 'Um pedido precisa ter ao menos um item.' })
@Invariant({ id: 'total-nao-negativo', text: 'O total do pedido (soma de quantidade × preço unitário) nunca pode ser negativo.' })
export class Order extends AggregateRoot<string> {
  #status: OrderStatus;

  private constructor(
    id: string,
    readonly customerId: string,
    readonly items: readonly OrderItem[],
    status: OrderStatus,
  ) {
    super(id);
    this.#status = status;
  }

  get status(): OrderStatus {
    return this.#status;
  }

  get total(): number {
    return this.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  }

  @AgentMethod({ description: 'Cria um pedido pendente para um cliente.', emits: [OrderCreated] })
  static create(props: CreateOrderProps): Order {
    if (props.items.length === 0) {
      throw new DomainError('ORDER_WITHOUT_ITEMS', 'Um pedido precisa ter ao menos um item.');
    }
    const order = new Order(props.id, props.customerId, [...props.items], 'pending');
    if (order.total < 0) {
      throw new DomainError('ORDER_NEGATIVE_TOTAL', 'O total do pedido não pode ser negativo.');
    }
    order.record(new OrderCreated({ orderId: order.id, customerId: order.customerId, total: order.total }));
    return order;
  }

  @AgentMethod({
    description: 'Confirma um pedido pendente.',
    transition: { from: ['pending'], to: 'confirmed' },
    emits: [OrderConfirmed],
  })
  confirm(): void {
    this.#ensureStatus(['pending'], 'confirmar');
    this.#status = 'confirmed';
    this.record(new OrderConfirmed({ orderId: this.id }));
  }

  @AgentMethod({
    description: 'Cancela um pedido pendente ou confirmado.',
    transition: { from: ['pending', 'confirmed'], to: 'cancelled' },
    emits: [OrderCancelled],
  })
  cancel(): void {
    this.#ensureStatus(['pending', 'confirmed'], 'cancelar');
    this.#status = 'cancelled';
    this.record(new OrderCancelled({ orderId: this.id }));
  }

  #ensureStatus(allowed: readonly OrderStatus[], action: string): void {
    if (!allowed.includes(this.#status)) {
      throw new DomainError('ORDER_INVALID_TRANSITION', `Não é possível ${action} um pedido com status ${this.#status}.`);
    }
  }
}
```

`examples/orders/domain/order.repository.ts`:

```ts
import type { Repository } from '@agentic-ddd/core';
import type { Order } from './order.js';

export type OrderRepository = Repository<Order, string>;
```

`examples/orders/infrastructure/in-memory-order.repository.ts`:

```ts
import type { Order } from '../domain/order.js';
import type { OrderRepository } from '../domain/order.repository.js';

export class InMemoryOrderRepository implements OrderRepository {
  readonly #orders = new Map<string, Order>();

  async findById(id: string): Promise<Order | null> {
    return this.#orders.get(id) ?? null;
  }

  async save(order: Order): Promise<void> {
    this.#orders.set(order.id, order);
  }
}
```

`examples/orders/application/load-order.ts`:

```ts
import { DomainError } from '@agentic-ddd/core';
import type { Order } from '../domain/order.js';
import type { OrderRepository } from '../domain/order.repository.js';

export async function loadOrder(orders: OrderRepository, id: string): Promise<Order> {
  const order = await orders.findById(id);
  if (!order) throw new DomainError('ORDER_NOT_FOUND', `Pedido ${id} não encontrado.`);
  return order;
}
```

`examples/orders/application/create-order.ts`:

```ts
import { z } from 'zod';
import { DomainError, type UseCase, type UseCaseContext } from '@agentic-ddd/core';
import { AgentUseCase } from '@agentic-ddd/decorators';
import { Order } from '../domain/order.js';
import { OrderCreated } from '../domain/order.events.js';
import type { OrderRepository } from '../domain/order.repository.js';

export const createOrderInput = z.object({
  order_id: z.string().min(1).describe('Id do novo pedido'),
  customer_id: z.string().min(1).describe('Id do cliente'),
  items: z
    .array(
      z.object({
        sku: z.string().min(1).describe('Código do produto'),
        quantity: z.number().int().positive().describe('Quantidade'),
        unit_price: z.number().nonnegative().describe('Preço unitário em reais'),
      }),
    )
    .min(1)
    .describe('Itens do pedido'),
});
export const createOrderOutput = z.object({ order_id: z.string(), status: z.literal('pending'), total: z.number() });
export type CreateOrderInput = z.infer<typeof createOrderInput>;
export type CreateOrderOutput = z.infer<typeof createOrderOutput>;

@AgentUseCase({
  name: 'create_order',
  description: 'Cria um pedido pendente para um cliente com os itens informados.',
  whenToUse: 'Quando o cliente quer abrir um novo pedido.',
  whenNotToUse: 'Para alterar itens de um pedido que já existe.',
  input: createOrderInput,
  output: createOrderOutput,
  uses: ['method:Order.create'],
  emits: [OrderCreated],
})
export class CreateOrder implements UseCase<CreateOrderInput, CreateOrderOutput> {
  constructor(private readonly orders: OrderRepository) {}

  async execute(input: CreateOrderInput, ctx: UseCaseContext): Promise<CreateOrderOutput> {
    if (await this.orders.findById(input.order_id)) {
      throw new DomainError('ORDER_ALREADY_EXISTS', `Já existe um pedido com id ${input.order_id}.`);
    }
    const order = Order.create({
      id: input.order_id,
      customerId: input.customer_id,
      items: input.items.map((i) => ({ sku: i.sku, quantity: i.quantity, unitPrice: i.unit_price })),
    });
    await this.orders.save(order);
    await ctx.publish(order.pullEvents());
    return { order_id: order.id, status: 'pending', total: order.total };
  }
}
```

`examples/orders/application/confirm-order.ts`:

```ts
import { z } from 'zod';
import type { UseCase, UseCaseContext } from '@agentic-ddd/core';
import { AgentUseCase } from '@agentic-ddd/decorators';
import { OrderConfirmed } from '../domain/order.events.js';
import type { OrderRepository } from '../domain/order.repository.js';
import { loadOrder } from './load-order.js';

export const confirmOrderInput = z.object({ order_id: z.string().min(1).describe('Id do pedido a confirmar') });
export const confirmOrderOutput = z.object({ order_id: z.string(), status: z.literal('confirmed') });
export type ConfirmOrderInput = z.infer<typeof confirmOrderInput>;
export type ConfirmOrderOutput = z.infer<typeof confirmOrderOutput>;

@AgentUseCase({
  name: 'confirm_order',
  description: 'Confirma um pedido pendente.',
  whenToUse: 'Quando o cliente ou o atendente confirmar um pedido pendente.',
  whenNotToUse: 'Para pedidos já confirmados ou cancelados.',
  input: confirmOrderInput,
  output: confirmOrderOutput,
  uses: ['method:Order.confirm'],
  emits: [OrderConfirmed],
})
export class ConfirmOrder implements UseCase<ConfirmOrderInput, ConfirmOrderOutput> {
  constructor(private readonly orders: OrderRepository) {}

  async execute(input: ConfirmOrderInput, ctx: UseCaseContext): Promise<ConfirmOrderOutput> {
    const order = await loadOrder(this.orders, input.order_id);
    order.confirm();
    await this.orders.save(order);
    await ctx.publish(order.pullEvents());
    return { order_id: order.id, status: 'confirmed' };
  }
}
```

`examples/orders/application/cancel-order.ts`:

```ts
import { z } from 'zod';
import type { UseCase, UseCaseContext } from '@agentic-ddd/core';
import { AgentUseCase } from '@agentic-ddd/decorators';
import { OrderCancelled } from '../domain/order.events.js';
import type { OrderRepository } from '../domain/order.repository.js';
import { loadOrder } from './load-order.js';

export const cancelOrderInput = z.object({ order_id: z.string().min(1).describe('Id do pedido a cancelar') });
export const cancelOrderOutput = z.object({ order_id: z.string(), status: z.literal('cancelled') });
export type CancelOrderInput = z.infer<typeof cancelOrderInput>;
export type CancelOrderOutput = z.infer<typeof cancelOrderOutput>;

@AgentUseCase({
  name: 'cancel_order',
  description: 'Cancela um pedido pendente ou confirmado.',
  whenToUse: 'Quando o cliente desistir de um pedido que ainda não foi cancelado.',
  whenNotToUse: 'Para pedidos já cancelados.',
  input: cancelOrderInput,
  output: cancelOrderOutput,
  uses: ['method:Order.cancel'],
  emits: [OrderCancelled],
})
export class CancelOrder implements UseCase<CancelOrderInput, CancelOrderOutput> {
  constructor(private readonly orders: OrderRepository) {}

  async execute(input: CancelOrderInput, ctx: UseCaseContext): Promise<CancelOrderOutput> {
    const order = await loadOrder(this.orders, input.order_id);
    order.cancel();
    await this.orders.save(order);
    await ctx.publish(order.pullEvents());
    return { order_id: order.id, status: 'cancelled' };
  }
}
```

`examples/orders/operators/order.operator.ts`:

```ts
import { Operator } from '@agentic-ddd/decorators';
import { CancelOrder } from '../application/cancel-order.js';
import { ConfirmOrder } from '../application/confirm-order.js';
import { CreateOrder } from '../application/create-order.js';

@Operator({
  name: 'order-operator',
  description:
    'Opera o ciclo de vida de pedidos de compra: criar, confirmar e cancelar. Use quando a mensagem pedir uma ação sobre um pedido.',
  instructions:
    'Você opera pedidos de compra. Use apenas as tools disponíveis. Identifique o pedido pelo id antes de agir e responda em português.',
  useCases: [CreateOrder, ConfirmOrder, CancelOrder],
  requiresApproval: [CancelOrder],
})
export class OrderOperator {}
```

- [ ] **Step 5: Incluir `examples/` no lint e no format**

Em `package.json`:

```json
    "format": "prettier --write \"src/**/*.ts\" \"test/**/*.ts\" \"examples/**/*.ts\"",
    "lint": "oxlint --type-aware src/ test/ examples/",
```

- [ ] **Step 6: Rodar e ver passar**

Run: `bun test && bun run typecheck && bun run lint`
Expected: todos os testes passam (os 12 do exemplo incluídos); sem erros de tipo nem de lint.

- [ ] **Step 7: Commit**

```bash
git add src/testing examples package.json
git commit -m "feat: adiciona helpers covers/createTestContext e o domínio de exemplo orders"
```

---

### Task 9: Renderer da skill de runtime

**Files:**
- Create: `src/compiler/render/markdown.ts`, `src/compiler/render/frontmatter.ts`, `src/compiler/render/state-machine.ts`, `src/compiler/render/runtime-skill.ts`
- Test: `src/compiler/runtime-skill.test.ts`

**Interfaces:**
- Consumes: tipos da IR, `stableStringify` (Task 6); `analyze` (Task 7); fixture `defineShop` (Task 6).
- Produces:
  - `markdown.ts`: `cell(text)`, `code(text)`, `table(headers, rows)`, `stripKind(id)` (`'method:Order.confirm' → 'Order.confirm'`), `idList(ids)` (lista de códigos ou `—`), `guardedBy(on)` (`'construção'` ou `` `Order.cancel` ``), `typeLabel(schema)`, `parameterRows(schema): string[][]`
  - `frontmatter.ts`: `interface SkillMeta { name; description; audience: 'dev' | 'runtime'; irHash }`, `frontmatter(meta): string` (sem `\n` final; description numa linha só, como string JSON), `GENERATED_HEADER(source): string`
  - `state-machine.ts`: `renderStateMachine(entities: readonly IREntity[], source: string): string`
  - `runtime-skill.ts`: `relatedEntities(ir, useCases): IREntity[]`, `renderRuntimeSkill(ir: IR, operator: IROperator, hash: string): Map<string, string>` com chaves `'SKILL.md'`, `'references/state-machine.md'`, `'references/tools.schema.json'` (nessa ordem).

- [ ] **Step 1: Escrever o teste que falha**

Create `src/compiler/runtime-skill.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { SHOP_MODULE, defineShop } from './__fixtures__/shop.js';
import { analyze } from './analyze.js';
import { table } from './render/markdown.js';
import { renderRuntimeSkill } from './render/runtime-skill.js';

const ROOT = resolve(import.meta.dir, '../..');
const { ir } = analyze(defineShop(), { root: ROOT, modules: [SHOP_MODULE] });
const operator = ir.operators[0]!;
const files = renderRuntimeSkill(ir, operator, 'hash-fixo');
const skill = files.get('SKILL.md')!;

describe('renderRuntimeSkill', () => {
  test('gera SKILL.md e references na ordem fixa', () => {
    expect([...files.keys()]).toEqual(['SKILL.md', 'references/state-machine.md', 'references/tools.schema.json']);
  });

  test('frontmatter só com campos da especificação', () => {
    expect(skill.split('\n').slice(0, 8)).toEqual([
      '---',
      'name: catalog-operator',
      `description: ${JSON.stringify(operator.description)}`,
      'metadata:',
      '  agentic-ddd.audience: runtime',
      '  agentic-ddd.generated: "true"',
      '  agentic-ddd.ir-hash: "hash-fixo"',
      '---',
    ]);
    expect(skill).toContain('<!-- GERADO por agentic-ddd compile — não edite. Fonte: src/compiler/__fixtures__/shop.ts:');
  });

  test('documenta cada tool com parâmetros, uses, emits e aprovação', () => {
    expect(skill).toContain('### `publish_product`');
    expect(skill).toContain('| `product_id` | string | sim | Id do produto a publicar |');
    expect(skill).toContain('- **Aciona:** `Product.publish`');
    expect(skill).toContain('- **Emite:** `ProductPublished`');
    expect(skill).toContain('- **Quando não usar:** Para alterar preço ou estoque.');
    expect(skill.match(/- \*\*Exige aprovação humana:\*\* sim/g)).toHaveLength(1);
    expect(skill.match(/- \*\*Exige aprovação humana:\*\* não/g)).toHaveLength(1);
  });

  test('lista regras e transições das entidades envolvidas', () => {
    expect(skill).toContain(
      '| `invariant:Product/publicacao-exige-estoque` | Só é possível publicar um produto com estoque maior que zero. | `Product.publish` |',
    );
    expect(skill).toContain('| `invariant:Product/preco-positivo` | O preço de um produto é sempre maior que zero. | construção |');
    expect(skill).toContain('| `Product.publish` | `draft` | `published` |');
  });

  test('tools.schema.json tem input e output de cada tool', () => {
    const tools = JSON.parse(files.get('references/tools.schema.json')!) as Record<string, { input: { required: string[] } }>;
    expect(Object.keys(tools)).toEqual(['create_product', 'publish_product']);
    expect(tools.publish_product!.input.required).toEqual(['product_id']);
  });

  test('snapshot dos arquivos', () => {
    for (const [path, content] of files) expect(content).toMatchSnapshot(path);
  });

  test('descrição com aspas, barra vertical e quebra de linha mantém o frontmatter numa linha', () => {
    const tricky = { ...operator, description: 'Opera "pedidos" | estoque\ncom cuidado' };
    const lines = renderRuntimeSkill(ir, tricky, 'h').get('SKILL.md')!.split('\n');
    expect(lines[7]).toBe('---');
    expect(JSON.parse(lines[2]!.slice('description: '.length))).toBe('Opera "pedidos" | estoque com cuidado');
  });

  test('table escapa barra vertical e quebra de linha nas células', () => {
    expect(table(['A', 'B'], [['x | y', 'linha\nquebrada']])).toBe('| A | B |\n|---|---|\n| x \\| y | linha quebrada |');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bun test src/compiler/runtime-skill.test.ts`
Expected: FAIL — `./render/markdown.js` não encontrado.

- [ ] **Step 3: Implementar**

`src/compiler/render/markdown.ts`:

```ts
import type { JsonSchema } from '../ir.js';

export function cell(text: string): string {
  return text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
}

export function code(text: string): string {
  return `\`${text}\``;
}

export function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const line = (columns: readonly string[]): string => `| ${columns.map(cell).join(' | ')} |`;
  return [line(headers), `|${headers.map(() => '---').join('|')}|`, ...rows.map(line)].join('\n');
}

export function stripKind(id: string): string {
  return id.slice(id.indexOf(':') + 1);
}

export function idList(ids: readonly string[]): string {
  return ids.length > 0 ? ids.map((id) => code(stripKind(id))).join(', ') : '—';
}

export function guardedBy(on: string | null): string {
  return on === null ? 'construção' : code(stripKind(on));
}

export function typeLabel(schema: JsonSchema): string {
  if (Array.isArray(schema.enum)) return `enum: ${(schema.enum as unknown[]).map(String).join(', ')}`;
  if ('const' in schema) return `const: ${String(schema.const)}`;
  if (typeof schema.type === 'string') return schema.type;
  if (Array.isArray(schema.type)) return (schema.type as string[]).join(' | ');
  if (Array.isArray(schema.anyOf)) return (schema.anyOf as JsonSchema[]).map(typeLabel).join(' | ');
  return 'qualquer';
}

export function parameterRows(schema: JsonSchema): string[][] {
  const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set((schema.required ?? []) as string[]);
  return Object.entries(properties).map(([key, property]) => [
    code(key),
    typeLabel(property),
    required.has(key) ? 'sim' : 'não',
    typeof property.description === 'string' ? property.description : '—',
  ]);
}
```

`src/compiler/render/frontmatter.ts`:

```ts
export interface SkillMeta {
  readonly name: string;
  readonly description: string;
  readonly audience: 'dev' | 'runtime';
  readonly irHash: string;
}

export function frontmatter(meta: SkillMeta): string {
  const description = meta.description.replace(/\s*\r?\n\s*/g, ' ').trim();
  return [
    '---',
    `name: ${meta.name}`,
    `description: ${JSON.stringify(description)}`,
    'metadata:',
    `  agentic-ddd.audience: ${meta.audience}`,
    '  agentic-ddd.generated: "true"',
    `  agentic-ddd.ir-hash: "${meta.irHash}"`,
    '---',
  ].join('\n');
}

export function GENERATED_HEADER(source: string): string {
  return `<!-- GERADO por agentic-ddd compile — não edite. Fonte: ${source} -->`;
}
```

`src/compiler/render/state-machine.ts`:

```ts
import type { IREntity } from '../ir.js';
import { GENERATED_HEADER } from './frontmatter.js';
import { code, idList, stripKind, table } from './markdown.js';

export function renderStateMachine(entities: readonly IREntity[], source: string): string {
  const lines: string[] = [GENERATED_HEADER(source), '', '# Máquina de estados', ''];
  for (const entity of entities) {
    lines.push(`## ${entity.name}`, '', `Estados: ${entity.states.length > 0 ? entity.states.map(code).join(', ') : '—'}`, '');
    const rows = entity.methods
      .filter((m) => m.transition !== null)
      .map((m) => [code(stripKind(m.id)), m.transition!.from.map(code).join(', '), code(m.transition!.to), idList(m.emits)]);
    lines.push(rows.length > 0 ? table(['Método', 'De', 'Para', 'Emite'], rows) : '_Sem transições declaradas._', '');
  }
  return lines.join('\n');
}
```

`src/compiler/render/runtime-skill.ts`:

```ts
import { stableStringify } from '../canonical.js';
import type { IR, IREntity, IROperator, IRUseCase } from '../ir.js';
import { GENERATED_HEADER, frontmatter } from './frontmatter.js';
import { code, guardedBy, idList, parameterRows, stripKind, table } from './markdown.js';
import { renderStateMachine } from './state-machine.js';

export function relatedEntities(ir: IR, useCases: readonly IRUseCase[]): IREntity[] {
  const names = new Set(useCases.flatMap((u) => u.uses.map((m) => stripKind(m).split('.')[0]!)));
  return ir.entities.filter((e) => names.has(e.name));
}

export function renderRuntimeSkill(ir: IR, operator: IROperator, hash: string): Map<string, string> {
  const useCases = operator.useCases
    .map((id) => ir.useCases.find((u) => u.id === id))
    .filter((u): u is IRUseCase => u !== undefined);
  const entities = relatedEntities(ir, useCases);

  const lines: string[] = [
    frontmatter({ name: operator.name, description: operator.description, audience: 'runtime', irHash: hash }),
    GENERATED_HEADER(operator.source),
    '',
    `# Operator ${code(operator.name)}`,
    '',
    operator.description,
    '',
    '## Tools',
    '',
  ];
  for (const useCase of useCases) {
    lines.push(`### ${code(useCase.name)}`, '', useCase.description, '', `- **Quando usar:** ${useCase.whenToUse}`);
    if (useCase.whenNotToUse) lines.push(`- **Quando não usar:** ${useCase.whenNotToUse}`);
    lines.push(
      `- **Aciona:** ${idList(useCase.uses)}`,
      `- **Emite:** ${idList(useCase.emits)}`,
      `- **Exige aprovação humana:** ${operator.requiresApproval.includes(useCase.id) ? 'sim' : 'não'}`,
      '',
    );
    const rows = parameterRows(useCase.inputSchema);
    lines.push(rows.length > 0 ? table(['Parâmetro', 'Tipo', 'Obrigatório', 'Descrição'], rows) : '_Sem parâmetros._', '');
  }

  const invariants = entities.flatMap((e) => e.invariants.map((i) => [code(i.id), i.text, guardedBy(i.on)]));
  if (invariants.length > 0) lines.push('## Regras de negócio', '', table(['Invariante', 'Regra', 'Garantida por'], invariants), '');

  const transitions = entities.flatMap((e) =>
    e.methods
      .filter((m) => m.transition !== null)
      .map((m) => [code(stripKind(m.id)), m.transition!.from.map(code).join(', '), code(m.transition!.to)]),
  );
  if (transitions.length > 0) lines.push('## Estados e transições', '', table(['Método', 'De', 'Para'], transitions), '');

  lines.push('Detalhes: [schemas das tools](references/tools.schema.json) · [máquina de estados](references/state-machine.md)', '');

  const tools = Object.fromEntries(useCases.map((u) => [u.name, { input: u.inputSchema, output: u.outputSchema }]));
  return new Map([
    ['SKILL.md', lines.join('\n')],
    ['references/state-machine.md', renderStateMachine(entities, operator.source)],
    ['references/tools.schema.json', stableStringify(tools)],
  ]);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `bun test src/compiler && bun run typecheck && bun run lint`
Expected: todos passam (snapshots novos em `src/compiler/__snapshots__/runtime-skill.test.ts.snap`). Ler o snapshot do `SKILL.md` e conferir que está legível para um LLM (tools, parâmetros, regras, transições).

- [ ] **Step 5: Commit**

```bash
git add src/compiler
git commit -m "feat(compiler): renderiza a skill de runtime de cada operator"
```

---

### Task 10: Grafo de work items e renderer da skill de dev

**Files:**
- Create: `src/compiler/graph.ts`, `src/compiler/render/dev-skill.ts`
- Test: `src/compiler/graph.test.ts`, `src/compiler/dev-skill.test.ts`

**Interfaces:**
- Consumes: IR (Task 6), `analyze` (Task 7), helpers de render (Task 9), `byId`/`stableStringify`.
- Produces:
  - `graph.ts`: `type Layer = 'domain' | 'application' | 'operators'`; `interface WorkItem { id; layer; module; source; dependsOn: string[]; obligations: string[] }`; `itemOfMethod(ir, methodId): string` (fábrica estática → `entity:X`); `workItems(ir): WorkItem[]` (regras da spec §8.3; o plano 3 calcula estados em cima disto).
  - `dev-skill.ts`: `renderDevSkill(ir: IR, module: IRModule, hash: string): Map<string, string>` com chaves `'SKILL.md'`, `'references/schemas.json'`, `'references/state-machine.md'`. Nome da skill: `<modulo>-dev`.

- [ ] **Step 1: Escrever os testes que falham**

Create `src/compiler/graph.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { SHOP_MODULE, defineShop } from './__fixtures__/shop.js';
import { analyze } from './analyze.js';
import { workItems } from './graph.js';

const ROOT = resolve(import.meta.dir, '../..');
const { ir } = analyze(defineShop(), { root: ROOT, modules: [SHOP_MODULE] });
const items = Object.fromEntries(workItems(ir).map((i) => [i.id, i]));

describe('workItems', () => {
  test('um item por entidade, método de instância, use-case e operator', () => {
    expect(Object.keys(items)).toEqual([
      'entity:Product',
      'method:Product.publish',
      'operator:catalog-operator',
      'usecase:create_product',
      'usecase:publish_product',
    ]);
  });

  test('a entidade é dona da fábrica estática e das invariantes de classe', () => {
    expect(items['entity:Product']!.dependsOn).toEqual([]);
    expect(items['entity:Product']!.obligations).toEqual(['invariant:Product/preco-positivo', 'method:Product.create']);
  });

  test('método de instância depende da entidade e é dono das invariantes declaradas nele', () => {
    expect(items['method:Product.publish']!.dependsOn).toEqual(['entity:Product']);
    expect(items['method:Product.publish']!.obligations).toEqual([
      'invariant:Product/publicacao-exige-estoque',
      'method:Product.publish',
    ]);
  });

  test('use-case depende do item de cada método em uses (fábrica resolve para a entidade)', () => {
    expect(items['usecase:create_product']!.dependsOn).toEqual(['entity:Product']);
    expect(items['usecase:publish_product']!.dependsOn).toEqual(['method:Product.publish']);
  });

  test('operator depende da allowlist', () => {
    expect(items['operator:catalog-operator']!.dependsOn).toEqual(['usecase:create_product', 'usecase:publish_product']);
    expect(items['operator:catalog-operator']!.layer).toBe('operators');
  });
});
```

Create `src/compiler/dev-skill.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { SHOP_MODULE, defineShop } from './__fixtures__/shop.js';
import { analyze } from './analyze.js';
import { renderDevSkill } from './render/dev-skill.js';

const ROOT = resolve(import.meta.dir, '../..');
const { ir } = analyze(defineShop(), { root: ROOT, modules: [SHOP_MODULE] });
const files = renderDevSkill(ir, ir.modules[0]!, 'hash-fixo');
const skill = files.get('SKILL.md')!;

describe('renderDevSkill', () => {
  test('gera SKILL.md e references', () => {
    expect([...files.keys()]).toEqual(['SKILL.md', 'references/schemas.json', 'references/state-machine.md']);
  });

  test('frontmatter de dev com nome do módulo', () => {
    expect(skill.startsWith('---\nname: shop-dev\ndescription: "Domínio shop: entidades Product; use-cases create_product, publish_product; operators catalog-operator.')).toBe(true);
    expect(skill).toContain('  agentic-ddd.audience: dev');
  });

  test('descreve entidade, invariantes com quem garante e métodos com fonte', () => {
    expect(skill).toContain('### Product — `entity:Product`');
    expect(skill).toMatch(/\| `invariant:Product\/publicacao-exige-estoque` \| Só é possível publicar um produto com estoque maior que zero\. \| `Product\.publish` \| `src\/compiler\/__fixtures__\/shop\.ts:\d+` \|/);
    expect(skill).toMatch(/\| `Product\.publish` \| Publica o produto no catálogo\. \| `draft` → `published` \| `ProductPublished` \|/);
  });

  test('lista dependências e obrigações de teste sem nenhum estado de implementação', () => {
    expect(skill).toContain('| `usecase:create_product` | application | `entity:Product` |');
    expect(skill).toContain('| `method:Product.publish` | `invariant:Product/publicacao-exige-estoque`, `method:Product.publish` |');
    expect(skill).not.toMatch(/pendente|pendência/i);
  });

  test('explica como estender usando o caminho do módulo', () => {
    expect(skill).toContain('| Use-case | `src/compiler/__fixtures__/application/<nome>.ts` |');
  });

  test('snapshot dos arquivos', () => {
    for (const [path, content] of files) expect(content).toMatchSnapshot(path);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bun test src/compiler/graph.test.ts src/compiler/dev-skill.test.ts`
Expected: FAIL — `./graph.js` não encontrado.

- [ ] **Step 3: Implementar**

`src/compiler/graph.ts`:

```ts
import { byId } from './canonical.js';
import type { IR } from './ir.js';

export type Layer = 'domain' | 'application' | 'operators';

export interface WorkItem {
  readonly id: string;
  readonly layer: Layer;
  readonly module: string;
  readonly source: string;
  readonly dependsOn: string[];
  readonly obligations: string[];
}

export function itemOfMethod(ir: IR, methodId: string): string {
  for (const entity of ir.entities) {
    const method = entity.methods.find((m) => m.id === methodId);
    if (method) return method.static ? entity.id : method.id;
  }
  return methodId;
}

export function workItems(ir: IR): WorkItem[] {
  const items: WorkItem[] = [];
  for (const entity of ir.entities) {
    const statics = new Set(entity.methods.filter((m) => m.static).map((m) => m.id));
    const ownedByEntity = entity.invariants.filter((i) => i.on === null || statics.has(i.on)).map((i) => i.id);
    items.push({
      id: entity.id,
      layer: 'domain',
      module: entity.module,
      source: entity.source,
      dependsOn: [],
      obligations: [...ownedByEntity, ...statics].sort(),
    });
    for (const method of entity.methods.filter((m) => !m.static)) {
      items.push({
        id: method.id,
        layer: 'domain',
        module: entity.module,
        source: method.source,
        dependsOn: [entity.id],
        obligations: [method.id, ...entity.invariants.filter((i) => i.on === method.id).map((i) => i.id)].sort(),
      });
    }
  }
  for (const useCase of ir.useCases) {
    items.push({
      id: useCase.id,
      layer: 'application',
      module: useCase.module,
      source: useCase.source,
      dependsOn: [...new Set(useCase.uses.map((m) => itemOfMethod(ir, m)))].sort(),
      obligations: [useCase.id],
    });
  }
  for (const operator of ir.operators) {
    items.push({
      id: operator.id,
      layer: 'operators',
      module: operator.module,
      source: operator.source,
      dependsOn: [...operator.useCases],
      obligations: [operator.id],
    });
  }
  return items.sort(byId);
}
```

`src/compiler/render/dev-skill.ts`:

```ts
import { stableStringify } from '../canonical.js';
import { workItems } from '../graph.js';
import type { IR, IRModule } from '../ir.js';
import { GENERATED_HEADER, frontmatter } from './frontmatter.js';
import { code, guardedBy, idList, stripKind, table } from './markdown.js';
import { renderStateMachine } from './state-machine.js';

export function renderDevSkill(ir: IR, module: IRModule, hash: string): Map<string, string> {
  const inModule = <T extends { readonly module: string }>(xs: readonly T[]): T[] => xs.filter((x) => x.module === module.name);
  const entities = inModule(ir.entities);
  const events = inModule(ir.events);
  const useCases = inModule(ir.useCases);
  const operators = inModule(ir.operators);
  const items = inModule(workItems(ir));

  const summary =
    [
      entities.length > 0 ? `entidades ${entities.map((e) => e.name).join(', ')}` : null,
      useCases.length > 0 ? `use-cases ${useCases.map((u) => u.name).join(', ')}` : null,
      operators.length > 0 ? `operators ${operators.map((o) => o.name).join(', ')}` : null,
    ]
      .filter((part): part is string => part !== null)
      .join('; ') || 'sem elementos declarados';
  const description = `Domínio ${module.name}: ${summary}. Use quando for implementar, alterar, testar ou revisar código em ${module.path}.`;

  const lines: string[] = [
    frontmatter({ name: `${module.name}-dev`, description, audience: 'dev', irHash: hash }),
    GENERATED_HEADER(module.path),
    '',
    `# Módulo ${code(module.name)}`,
    '',
    `Código em ${code(module.path)}. Esta skill descreve o domínio declarado (requisitos, regras e contratos); ela não registra estado de implementação.`,
    '',
  ];

  if (entities.length > 0) {
    lines.push('## Entidades', '');
    for (const entity of entities) {
      lines.push(
        `### ${entity.name} — ${code(entity.id)}`,
        '',
        entity.description,
        '',
        `Fonte: ${code(entity.source)} · Estados: ${entity.states.length > 0 ? entity.states.map(code).join(', ') : '—'}`,
        '',
      );
      if (entity.invariants.length > 0) {
        const rows = entity.invariants.map((i) => [code(i.id), i.text, guardedBy(i.on), code(i.source)]);
        lines.push(table(['Invariante', 'Regra', 'Garantida por', 'Fonte'], rows), '');
      }
      if (entity.methods.length > 0) {
        const rows = entity.methods.map((m) => [
          code(stripKind(m.id)),
          m.description,
          m.transition ? `${m.transition.from.map(code).join(', ')} → ${code(m.transition.to)}` : '—',
          idList(m.emits),
          code(m.source),
        ]);
        lines.push(table(['Método', 'Descrição', 'Transição', 'Emite', 'Fonte'], rows), '');
      }
    }
  }

  if (events.length > 0) {
    lines.push('## Eventos', '', table(['Evento', 'Descrição', 'Fonte'], events.map((e) => [code(e.name), e.description, code(e.source)])), '');
  }

  if (useCases.length > 0) {
    const rows = useCases.map((u) => [code(u.name), u.description, idList(u.uses), idList(u.emits), code(u.source)]);
    lines.push('## Use-cases', '', table(['Use-case', 'Descrição', 'Aciona', 'Emite', 'Fonte'], rows), '');
  }

  if (operators.length > 0) {
    const rows = operators.map((o) => [code(o.name), idList(o.useCases), idList(o.requiresApproval), code(o.source)]);
    lines.push('## Operators', '', table(['Operator', 'Use-cases', 'Exige aprovação', 'Fonte'], rows), '');
  }

  if (items.length > 0) {
    const dependencies = items.map((i) => [code(i.id), i.layer, i.dependsOn.length > 0 ? i.dependsOn.map(code).join(', ') : '—']);
    lines.push('## Dependências entre itens', '', table(['Item', 'Camada', 'Depende de'], dependencies), '');
    const obligations = items.map((i) => [code(i.id), i.obligations.map(code).join(', ')]);
    lines.push(
      '## Obrigações de teste',
      '',
      'Cada ID abaixo precisa de ao menos um teste nomeado com `covers([...ids], título)` de `@agentic-ddd/testing`.',
      '',
      table(['Item', 'IDs a cobrir'], obligations),
      '',
    );
  }

  lines.push(
    '## Como estender',
    '',
    table(
      ['Artefato', 'Onde criar', 'Como declarar'],
      [
        ['Entidade', code(`${module.path}/domain/<nome>.ts`), '`@AgentEntity({ description, states })` + `@Invariant({ id, text })` na classe'],
        ['Método de entidade', 'na classe da entidade', '`@AgentMethod({ description, transition?, emits? })`; regra garantida pelo método: `@Invariant` no método; auxiliares: `#privado`'],
        ['Evento', code(`${module.path}/domain/<agregado>.events.ts`), '`@AgentEvent({ description, payload })` estendendo `DomainEvent`'],
        ['Use-case', code(`${module.path}/application/<nome>.ts`), '`@AgentUseCase({ name, description, whenToUse, input, output, uses, emits? })`'],
        ['Operator', code(`${module.path}/operators/<nome>.operator.ts`), '`@Operator({ name, description, instructions, useCases, requiresApproval? })`'],
      ],
    ),
    '',
    'Corpo declarado e ainda não implementado usa `notImplemented()` de `@agentic-ddd/core`.',
    '',
    '## Referências',
    '',
    '- [Schemas de eventos e use-cases](references/schemas.json)',
    '- [Máquina de estados](references/state-machine.md)',
    '',
  );

  const schemas = {
    events: Object.fromEntries(events.map((e) => [e.name, e.payloadSchema])),
    useCases: Object.fromEntries(useCases.map((u) => [u.name, { input: u.inputSchema, output: u.outputSchema }])),
  };
  return new Map([
    ['SKILL.md', lines.join('\n')],
    ['references/schemas.json', stableStringify(schemas)],
    ['references/state-machine.md', renderStateMachine(entities, module.path)],
  ]);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `bun test src/compiler && bun run typecheck && bun run lint`
Expected: todos passam; snapshots novos. Ler o snapshot do `SKILL.md` de dev: tem entidade, eventos, use-cases, operator, dependências, obrigações e "Como estender", e **nada** sobre estado de implementação.

- [ ] **Step 5: Commit**

```bash
git add src/compiler
git commit -m "feat(compiler): calcula o grafo de work items e renderiza a skill de dev"
```

---
### Task 11: Bloco do `AGENTS.md` e `renderAll`

**Files:**
- Create: `src/compiler/render/agents-md.ts`, `src/compiler/render/index.ts`
- Test: `src/compiler/render-all.test.ts`

**Interfaces:**
- Consumes: `renderDevSkill` (Task 10), `renderRuntimeSkill` (Task 9), `irHash` (Task 6).
- Produces:
  - `BLOCK_BEGIN = '<!-- agentic-ddd:begin -->'`, `BLOCK_END = '<!-- agentic-ddd:end -->'`, `renderAgentsBlock(ir, paths: { devSkills; runtimeSkills }): string` (inclui os marcadores, sem `\n` final)
  - `interface OutputPaths { agentsMd; claudeMd; devSkills; runtimeSkills }`, `DEFAULT_OUT = { agentsMd: 'AGENTS.md', claudeMd: 'CLAUDE.md', devSkills: '.agents/skills', runtimeSkills: '.agentic/runtime' }`
  - `interface Rendered { files: ReadonlyMap<string, string> /* caminho POSIX relativo ao outRoot → conteúdo, ordenado */; agentsBlock: string; devSkillDirs: readonly string[]; runtimeSkillDirs: readonly string[] }`
  - `renderAll(ir: IR, out: OutputPaths): Rendered`

- [ ] **Step 1: Escrever o teste que falha**

Create `src/compiler/render-all.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { SHOP_MODULE, defineShop } from './__fixtures__/shop.js';
import { analyze } from './analyze.js';
import { irHash } from './ir.js';
import { BLOCK_BEGIN, BLOCK_END } from './render/agents-md.js';
import { DEFAULT_OUT, renderAll } from './render/index.js';
import { stripKind } from './render/markdown.js';

const ROOT = resolve(import.meta.dir, '../..');
const { ir } = analyze(defineShop(), { root: ROOT, modules: [SHOP_MODULE] });
const rendered = renderAll(ir, DEFAULT_OUT);

describe('renderAll', () => {
  test('gera os arquivos das skills de dev e de runtime nos caminhos padrão', () => {
    expect([...rendered.files.keys()]).toEqual([
      '.agentic/runtime/catalog-operator/SKILL.md',
      '.agentic/runtime/catalog-operator/references/state-machine.md',
      '.agentic/runtime/catalog-operator/references/tools.schema.json',
      '.agents/skills/shop-dev/SKILL.md',
      '.agents/skills/shop-dev/references/schemas.json',
      '.agents/skills/shop-dev/references/state-machine.md',
    ]);
    expect(rendered.devSkillDirs).toEqual(['shop-dev']);
    expect(rendered.runtimeSkillDirs).toEqual(['catalog-operator']);
  });

  test('todas as skills carregam o mesmo ir-hash', () => {
    const line = `  agentic-ddd.ir-hash: "${irHash(ir)}"`;
    for (const [path, content] of rendered.files) if (path.endsWith('SKILL.md')) expect(content).toContain(line);
  });

  test('o bloco do AGENTS.md tem marcadores, mapa e convenções', () => {
    expect(rendered.agentsBlock.startsWith(BLOCK_BEGIN)).toBe(true);
    expect(rendered.agentsBlock.endsWith(BLOCK_END)).toBe(true);
    expect(rendered.agentsBlock).toContain('| shop | `src/compiler/__fixtures__` | `.agents/skills/shop-dev/SKILL.md` |');
    expect(rendered.agentsBlock).toContain('| catalog-operator | `.agentic/runtime/catalog-operator/SKILL.md` |');
    expect(rendered.agentsBlock).toContain('`notImplemented()`');
    expect(rendered.agentsBlock).toMatchSnapshot();
  });

  test('fidelidade: todo elemento da IR aparece em ao menos um arquivo gerado', () => {
    const all = [...rendered.files.values()].join('\n');
    const ids = [
      ...ir.entities.flatMap((e) => [e.id, ...e.invariants.map((i) => i.id), ...e.methods.map((m) => stripKind(m.id))]),
      ...ir.events.map((e) => e.name),
      ...ir.useCases.map((u) => u.name),
      ...ir.operators.map((o) => o.name),
    ];
    expect(ids.filter((id) => !all.includes(id))).toEqual([]);
  });

  test('é determinístico', () => {
    const again = renderAll(analyze(defineShop(), { root: ROOT, modules: [SHOP_MODULE] }).ir, DEFAULT_OUT);
    expect([...again.files]).toEqual([...rendered.files]);
    expect(again.agentsBlock).toBe(rendered.agentsBlock);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bun test src/compiler/render-all.test.ts`
Expected: FAIL — `./render/agents-md.js` não encontrado.

- [ ] **Step 3: Implementar**

`src/compiler/render/agents-md.ts`:

```ts
import type { IR } from '../ir.js';
import { code, table } from './markdown.js';

export const BLOCK_BEGIN = '<!-- agentic-ddd:begin -->';
export const BLOCK_END = '<!-- agentic-ddd:end -->';

export interface AgentsPaths {
  readonly devSkills: string;
  readonly runtimeSkills: string;
}

export function renderAgentsBlock(ir: IR, paths: AgentsPaths): string {
  const lines: string[] = [
    BLOCK_BEGIN,
    '<!-- GERADO por agentic-ddd compile — não edite este bloco; o texto fora dele é seu. -->',
    '',
    '## Domínio (agentic-ddd)',
    '',
  ];
  if (ir.modules.length > 0) {
    const rows = ir.modules.map((m) => [m.name, code(m.path), code(`${paths.devSkills}/${m.name}-dev/SKILL.md`)]);
    lines.push(table(['Módulo', 'Código', 'Skill de dev'], rows), '');
  }
  if (ir.operators.length > 0) {
    const rows = ir.operators.map((o) => [o.name, code(`${paths.runtimeSkills}/${o.name}/SKILL.md`)]);
    lines.push(table(['Operator', 'Skill de runtime'], rows), '');
  }
  lines.push(
    '### Convenções',
    '',
    '- Entidades, métodos, eventos, use-cases e operators são declarados com `@AgentEntity`, `@AgentMethod`, `@AgentEvent`, `@AgentUseCase` e `@Operator` de `@agentic-ddd/decorators`; cada regra de negócio é um `@Invariant({ id, text })` com ID estável.',
    '- Onde criar: `<módulo>/domain` (entidades, eventos, ports), `<módulo>/application` (use-cases, sempre com `uses`), `<módulo>/operators` (operators). A skill de dev do módulo tem os caminhos exatos.',
    '- Todo método público de entidade tem `@AgentMethod`; métodos auxiliares usam `#privado`.',
    '- Corpo declarado e ainda não implementado usa `notImplemented()` de `@agentic-ddd/core`.',
    '- Testes declaram o que cobrem com `covers([...ids], título)` de `@agentic-ddd/testing`.',
    `- Gerados (não edite): ${code(paths.devSkills)}, ${code(paths.runtimeSkills)}, os espelhos de skills e este bloco. Altere o código decorado e rode \`bun run agentic compile\`; o CI roda \`bun run agentic compile --check\`.`,
    BLOCK_END,
  );
  return lines.join('\n');
}
```

`src/compiler/render/index.ts`:

```ts
import { irHash, type IR } from '../ir.js';
import { renderAgentsBlock } from './agents-md.js';
import { renderDevSkill } from './dev-skill.js';
import { renderRuntimeSkill } from './runtime-skill.js';

export interface OutputPaths {
  readonly agentsMd: string;
  readonly claudeMd: string;
  readonly devSkills: string;
  readonly runtimeSkills: string;
}

export const DEFAULT_OUT: OutputPaths = {
  agentsMd: 'AGENTS.md',
  claudeMd: 'CLAUDE.md',
  devSkills: '.agents/skills',
  runtimeSkills: '.agentic/runtime',
};

export interface Rendered {
  readonly files: ReadonlyMap<string, string>;
  readonly agentsBlock: string;
  readonly devSkillDirs: readonly string[];
  readonly runtimeSkillDirs: readonly string[];
}

export function renderAll(ir: IR, out: OutputPaths): Rendered {
  const hash = irHash(ir);
  const entries: [string, string][] = [];
  for (const module of ir.modules) {
    for (const [rel, content] of renderDevSkill(ir, module, hash)) entries.push([`${out.devSkills}/${module.name}-dev/${rel}`, content]);
  }
  for (const operator of ir.operators) {
    for (const [rel, content] of renderRuntimeSkill(ir, operator, hash)) entries.push([`${out.runtimeSkills}/${operator.name}/${rel}`, content]);
  }
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    files: new Map(entries),
    agentsBlock: renderAgentsBlock(ir, out),
    devSkillDirs: ir.modules.map((m) => `${m.name}-dev`),
    runtimeSkillDirs: ir.operators.map((o) => o.name),
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `bun test src/compiler && bun run typecheck && bun run lint`
Expected: todos passam.

- [ ] **Step 5: Commit**

```bash
git add src/compiler
git commit -m "feat(compiler): renderiza o bloco do AGENTS.md e agrega todas as saídas"
```

---

### Task 12: Config, escrita/verificação em disco e CLI `compile`

**Files:**
- Create: `src/compiler/config.ts`, `src/compiler/load.ts`, `src/compiler/write.ts`, `src/compiler/compile.ts`, `src/compiler/index.ts`, `src/cli/main.ts`, `agentic.config.ts`, `test/fixtures/broken/agentic.config.ts`, `test/fixtures/broken/domain/thing.ts`
- Test: `src/compiler/write.test.ts`, `src/compiler/compile.test.ts`, `src/cli/cli.test.ts`
- Create (gerado + manual): `AGENTS.md`, `CLAUDE.md`, `.agents/skills/orders-dev/**`, `.claude/skills/orders-dev` (symlink), `.agentic/runtime/order-operator/**`

**Interfaces:**
- Consumes: `analyze` (Task 7), `renderAll`, `Rendered`, `OutputPaths`, `DEFAULT_OUT`, `BLOCK_BEGIN`/`BLOCK_END` (Task 11), `defaultRegistry` (Task 3).
- Produces:
  - `config.ts`: `ModuleConfig { name; path }`, `AgenticConfig { root?; modules; out?; mirrors? }`, `ResolvedConfig { root; outRoot; modules; out: OutputPaths; mirrors }`, `defineConfig(config)`, `resolveConfig(config, configDir, overrides?)`, `loadConfig(configPath, overrides?: { outRoot? })`
  - `load.ts`: `importModules(config): Promise<string[]>` (importa todo `*.ts` dos módulos, exceto `*.test.ts`, `*.spec.ts`, `*.d.ts`, pastas `test/`, `__fixtures__/`, `__snapshots__/`)
  - `write.ts`: `type DriftReason = 'missing' | 'changed' | 'extra' | 'mirror'`, `Drift { path; reason }`, `WriteResult { written; warnings }`, `GENERATED_MARK`, `CLAUDE_MD_CONTENT = '@AGENTS.md\n'`, `mergeAgentsBlock(existing: string | null, block): string`, `extractAgentsBlock(text): string | null`, `writeOutputs(config, rendered): Promise<WriteResult>`, `checkOutputs(config, rendered): Promise<Drift[]>`
  - `compile.ts`: `CompileOptions { configPath; outRoot?; mode: 'write' | 'check'; registry? }`, `CompileResult { ok; errors; drift; written; warnings; ir; rendered; config }`, `compile(options): Promise<CompileResult>`
  - `@agentic-ddd/compiler` (index): reexporta `defineConfig`, `compile`, `analyze`, `renderAll`, tipos da IR, `workItems`, `stableStringify`, `irHash`.
  - CLI: `bun run agentic compile [--check] [--config <arquivo>] [--out-root <dir>]`; exit 0 ok, 1 erro/drift, 2 uso incorreto.

- [ ] **Step 1: Escrever os testes de escrita (falham)**

Create `src/compiler/write.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SHOP_MODULE, defineShop } from './__fixtures__/shop.js';
import { analyze } from './analyze.js';
import type { ResolvedConfig } from './config.js';
import { BLOCK_BEGIN, BLOCK_END } from './render/agents-md.js';
import { DEFAULT_OUT, renderAll } from './render/index.js';
import { CLAUDE_MD_CONTENT, checkOutputs, mergeAgentsBlock, writeOutputs } from './write.js';

const ROOT = resolve(import.meta.dir, '../..');
const rendered = renderAll(analyze(defineShop(), { root: ROOT, modules: [SHOP_MODULE] }).ir, DEFAULT_OUT);
const block = `${BLOCK_BEGIN}\nconteúdo\n${BLOCK_END}`;

let out: string;
let config: ResolvedConfig;

beforeEach(async () => {
  out = await mkdtemp(join(tmpdir(), 'agentic-write-'));
  config = { root: ROOT, outRoot: out, modules: [SHOP_MODULE], out: DEFAULT_OUT, mirrors: ['.claude/skills'] };
});

afterEach(async () => {
  await rm(out, { recursive: true, force: true });
});

describe('mergeAgentsBlock', () => {
  test('cria o arquivo quando não existe', () => {
    expect(mergeAgentsBlock(null, block)).toBe(`# AGENTS.md\n\n${block}\n`);
  });

  test('anexa o bloco preservando texto manual sem marcadores', () => {
    expect(mergeAgentsBlock('# Projeto\n\nNotas do time.\n', block)).toBe(`# Projeto\n\nNotas do time.\n\n${block}\n`);
  });

  test('substitui só o bloco e preserva o resto', () => {
    const existing = `# Projeto\n\n${BLOCK_BEGIN}\nvelho\n${BLOCK_END}\n\nRodapé manual.\n`;
    expect(mergeAgentsBlock(existing, block)).toBe(`# Projeto\n\n${block}\n\nRodapé manual.\n`);
  });

  test('marcadores corrompidos (fim antes do início) fazem anexar', () => {
    const existing = `${BLOCK_END}\n${BLOCK_BEGIN}\n`;
    expect(mergeAgentsBlock(existing, block)).toBe(`${existing.trimEnd()}\n\n${block}\n`);
  });
});

describe('writeOutputs / checkOutputs', () => {
  test('escreve tudo e o check fica limpo', async () => {
    await writeOutputs(config, rendered);
    expect(await checkOutputs(config, rendered)).toEqual([]);
    expect(await readFile(join(out, 'CLAUDE.md'), 'utf8')).toBe(CLAUDE_MD_CONTENT);
    expect(await readlink(join(out, '.claude/skills/shop-dev'))).toBe('../../.agents/skills/shop-dev');
  });

  test('detecta arquivo alterado, removido e extra', async () => {
    await writeOutputs(config, rendered);
    await writeFile(join(out, '.agents/skills/shop-dev/SKILL.md'), 'mexido à mão');
    await rm(join(out, '.agentic/runtime/catalog-operator/references/tools.schema.json'));
    await writeFile(join(out, '.agentic/runtime/catalog-operator/references/velho.md'), 'x');
    expect(await checkOutputs(config, rendered)).toEqual([
      { path: '.agentic/runtime/catalog-operator/references/tools.schema.json', reason: 'missing' },
      { path: '.agentic/runtime/catalog-operator/references/velho.md', reason: 'extra' },
      { path: '.agents/skills/shop-dev/SKILL.md', reason: 'changed' },
    ]);
  });

  test('remove skill gerada órfã e nunca toca skill do usuário', async () => {
    const orphan = join(out, '.agentic/runtime/old-operator');
    await mkdir(orphan, { recursive: true });
    await writeFile(join(orphan, 'SKILL.md'), '---\nname: old-operator\nmetadata:\n  agentic-ddd.generated: "true"\n---\n');
    const mine = join(out, '.agents/skills/minha-skill');
    await mkdir(mine, { recursive: true });
    await writeFile(join(mine, 'SKILL.md'), '---\nname: minha-skill\n---\n');

    expect(await checkOutputs(config, rendered)).toContainEqual({ path: '.agentic/runtime/old-operator', reason: 'extra' });
    await writeOutputs(config, rendered);
    expect(await lstat(orphan).catch(() => null)).toBeNull();
    expect(await readFile(join(mine, 'SKILL.md'), 'utf8')).toBe('---\nname: minha-skill\n---\n');
    expect(await checkOutputs(config, rendered)).toEqual([]);
  });

  test('AGENTS.md: preserva texto manual e só o bloco conta para o check', async () => {
    await writeFile(join(out, 'AGENTS.md'), '# Projeto\n\nNotas do time.\n');
    await writeOutputs(config, rendered);
    const agents = await readFile(join(out, 'AGENTS.md'), 'utf8');
    expect(agents.startsWith('# Projeto\n\nNotas do time.\n\n<!-- agentic-ddd:begin -->')).toBe(true);
    await writeFile(join(out, 'AGENTS.md'), agents.replace('Notas do time.', 'Notas novas.'));
    expect(await checkOutputs(config, rendered)).toEqual([]);
    await writeFile(join(out, 'AGENTS.md'), agents.replace('## Domínio (agentic-ddd)', '## Mexido'));
    expect(await checkOutputs(config, rendered)).toEqual([{ path: 'AGENTS.md', reason: 'changed' }]);
  });

  test('CLAUDE.md existente nunca é sobrescrito', async () => {
    await writeFile(join(out, 'CLAUDE.md'), 'meu CLAUDE.md\n');
    await writeOutputs(config, rendered);
    expect(await readFile(join(out, 'CLAUDE.md'), 'utf8')).toBe('meu CLAUDE.md\n');
  });

  test('espelho: link errado vira drift; diretório real não é substituído', async () => {
    await writeOutputs(config, rendered);
    await rm(join(out, '.claude/skills/shop-dev'));
    await symlink('../outro-lugar', join(out, '.claude/skills/shop-dev'));
    expect(await checkOutputs(config, rendered)).toEqual([{ path: '.claude/skills/shop-dev', reason: 'mirror' }]);

    await rm(join(out, '.claude/skills/shop-dev'));
    await mkdir(join(out, '.claude/skills/shop-dev'));
    const { warnings } = await writeOutputs(config, rendered);
    expect(warnings).toEqual(['.claude/skills/shop-dev existe e não é um link; não foi substituído']);
    expect((await lstat(join(out, '.claude/skills/shop-dev'))).isDirectory()).toBe(true);
  });
});
```

Run: `bun test src/compiler/write.test.ts`
Expected: FAIL — `./config.js` não encontrado.

- [ ] **Step 2: Implementar config, load e write**

`src/compiler/config.ts`:

```ts
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { toPosix } from './ir.js';
import { DEFAULT_OUT, type OutputPaths } from './render/index.js';

export interface ModuleConfig {
  readonly name: string;
  readonly path: string;
}

export interface AgenticConfig {
  readonly root?: string;
  readonly modules: readonly ModuleConfig[];
  readonly out?: Partial<OutputPaths>;
  readonly mirrors?: readonly string[];
}

export interface ResolvedConfig {
  readonly root: string;
  readonly outRoot: string;
  readonly modules: readonly ModuleConfig[];
  readonly out: OutputPaths;
  readonly mirrors: readonly string[];
}

const MODULE_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function defineConfig(config: AgenticConfig): AgenticConfig {
  return config;
}

export function resolveConfig(config: AgenticConfig, configDir: string, overrides: { outRoot?: string } = {}): ResolvedConfig {
  if (!Array.isArray(config.modules) || config.modules.length === 0) {
    throw new Error('agentic.config.ts: modules precisa listar ao menos um módulo');
  }
  for (const module of config.modules) {
    if (!MODULE_NAME.test(module.name)) throw new Error(`agentic.config.ts: o nome do módulo "${module.name}" deve ser kebab-case`);
  }
  const root = resolve(configDir, config.root ?? '.');
  return {
    root,
    outRoot: overrides.outRoot ? resolve(overrides.outRoot) : root,
    modules: config.modules.map((m) => ({ name: m.name, path: toPosix(m.path).replace(/^\.\//, '').replace(/\/+$/, '') })),
    out: { ...DEFAULT_OUT, ...config.out },
    mirrors: [...(config.mirrors ?? ['.claude/skills'])],
  };
}

export async function loadConfig(configPath: string, overrides: { outRoot?: string } = {}): Promise<ResolvedConfig> {
  const absolute = resolve(configPath);
  const loaded = (await import(pathToFileURL(absolute).href)) as { default?: AgenticConfig };
  if (!loaded.default) throw new Error(`${configPath}: esperado export default defineConfig({ modules: [...] })`);
  return resolveConfig(loaded.default, dirname(absolute), overrides);
}
```

`src/compiler/load.ts`:

```ts
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ResolvedConfig } from './config.js';
import { toPosix } from './ir.js';

const SKIPPED_DIR = /(^|\/)(test|__fixtures__|__snapshots__)\//;
const SKIPPED_FILE = /\.(test|spec)\.ts$|\.d\.ts$/;

export async function importModules(config: ResolvedConfig): Promise<string[]> {
  const files: string[] = [];
  for (const module of config.modules) {
    const cwd = join(config.root, module.path);
    for await (const rel of new Bun.Glob('**/*.ts').scan({ cwd, onlyFiles: true })) {
      const posix = toPosix(rel);
      if (SKIPPED_DIR.test(posix) || SKIPPED_FILE.test(posix)) continue;
      files.push(join(cwd, rel));
    }
  }
  files.sort();
  for (const file of files) await import(pathToFileURL(file).href);
  return files;
}
```

`src/compiler/write.ts`:

```ts
import { lstat, mkdir, readFile, readdir, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { ResolvedConfig } from './config.js';
import { toPosix } from './ir.js';
import { BLOCK_BEGIN, BLOCK_END } from './render/agents-md.js';
import type { Rendered } from './render/index.js';

export type DriftReason = 'missing' | 'changed' | 'extra' | 'mirror';

export interface Drift {
  readonly path: string;
  readonly reason: DriftReason;
}

export interface WriteResult {
  readonly written: string[];
  readonly warnings: string[];
}

export const GENERATED_MARK = 'agentic-ddd.generated: "true"';
export const CLAUDE_MD_CONTENT = '@AGENTS.md\n';

async function readOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

async function lstatOrNull(path: string): Promise<Stats | null> {
  try {
    return await lstat(path);
  } catch {
    return null;
  }
}

export function extractAgentsBlock(text: string): string | null {
  const begin = text.indexOf(BLOCK_BEGIN);
  const end = text.indexOf(BLOCK_END);
  if (begin === -1 || end === -1 || end < begin) return null;
  return text.slice(begin, end + BLOCK_END.length);
}

export function mergeAgentsBlock(existing: string | null, block: string): string {
  if (existing === null) return `# AGENTS.md\n\n${block}\n`;
  const current = extractAgentsBlock(existing);
  if (current === null) return `${existing.trimEnd()}\n\n${block}\n`;
  const begin = existing.indexOf(current);
  return `${existing.slice(0, begin)}${block}${existing.slice(begin + current.length)}`;
}

async function generatedSkillDirs(base: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(base);
  } catch {
    return [];
  }
  const result: string[] = [];
  for (const name of names.sort()) {
    const skill = await readOrNull(join(base, name, 'SKILL.md'));
    if (skill?.includes(GENERATED_MARK)) result.push(name);
  }
  return result;
}

async function listFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for await (const file of new Bun.Glob('**/*').scan({ cwd: dir, onlyFiles: true, dot: true })) files.push(toPosix(file));
  return files.sort();
}

function managedBases(config: ResolvedConfig, rendered: Rendered): [string, readonly string[]][] {
  return [
    [config.out.devSkills, rendered.devSkillDirs],
    [config.out.runtimeSkills, rendered.runtimeSkillDirs],
  ];
}

function mirrorTarget(config: ResolvedConfig, mirror: string, dir: string): string {
  return toPosix(relative(join(config.outRoot, mirror), join(config.outRoot, config.out.devSkills, dir)));
}

export async function writeOutputs(config: ResolvedConfig, rendered: Rendered): Promise<WriteResult> {
  const written: string[] = [];
  const warnings: string[] = [];

  for (const [base, keep] of managedBases(config, rendered)) {
    for (const dir of await generatedSkillDirs(join(config.outRoot, base))) {
      await rm(join(config.outRoot, base, dir), { recursive: true, force: true });
      if (!keep.includes(dir)) written.push(`${base}/${dir} (removido)`);
    }
  }

  for (const [path, content] of rendered.files) {
    const absolute = join(config.outRoot, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, content);
    written.push(path);
  }

  const agentsPath = join(config.outRoot, config.out.agentsMd);
  await mkdir(dirname(agentsPath), { recursive: true });
  await writeFile(agentsPath, mergeAgentsBlock(await readOrNull(agentsPath), rendered.agentsBlock));
  written.push(config.out.agentsMd);

  const claudePath = join(config.outRoot, config.out.claudeMd);
  if ((await readOrNull(claudePath)) === null) {
    await writeFile(claudePath, CLAUDE_MD_CONTENT);
    written.push(config.out.claudeMd);
  }

  const skillsRoot = `${resolve(config.outRoot, config.out.devSkills)}${sep}`;
  for (const mirror of config.mirrors) {
    const mirrorDir = join(config.outRoot, mirror);
    await mkdir(mirrorDir, { recursive: true });
    for (const name of (await readdir(mirrorDir)).sort()) {
      const link = join(mirrorDir, name);
      const stat = await lstat(link);
      if (!stat.isSymbolicLink() || rendered.devSkillDirs.includes(name)) continue;
      if (resolve(mirrorDir, await readlink(link)).startsWith(skillsRoot)) {
        await rm(link, { force: true });
        written.push(`${mirror}/${name} (link removido)`);
      }
    }
    for (const dir of rendered.devSkillDirs) {
      const link = join(mirrorDir, dir);
      const stat = await lstatOrNull(link);
      if (stat && !stat.isSymbolicLink()) {
        warnings.push(`${mirror}/${dir} existe e não é um link; não foi substituído`);
        continue;
      }
      if (stat) await rm(link, { force: true });
      await symlink(mirrorTarget(config, mirror, dir), link);
      written.push(`${mirror}/${dir}`);
    }
  }

  return { written, warnings };
}

export async function checkOutputs(config: ResolvedConfig, rendered: Rendered): Promise<Drift[]> {
  const drift: Drift[] = [];

  for (const [path, content] of rendered.files) {
    const actual = await readOrNull(join(config.outRoot, path));
    if (actual === null) drift.push({ path, reason: 'missing' });
    else if (actual !== content) drift.push({ path, reason: 'changed' });
  }

  for (const [base, keep] of managedBases(config, rendered)) {
    for (const dir of await generatedSkillDirs(join(config.outRoot, base))) {
      if (!keep.includes(dir)) {
        drift.push({ path: `${base}/${dir}`, reason: 'extra' });
        continue;
      }
      for (const file of await listFiles(join(config.outRoot, base, dir))) {
        const path = `${base}/${dir}/${file}`;
        if (!rendered.files.has(path)) drift.push({ path, reason: 'extra' });
      }
    }
  }

  const agents = await readOrNull(join(config.outRoot, config.out.agentsMd));
  const block = agents === null ? null : extractAgentsBlock(agents);
  if (block === null) drift.push({ path: config.out.agentsMd, reason: 'missing' });
  else if (block !== rendered.agentsBlock) drift.push({ path: config.out.agentsMd, reason: 'changed' });

  if ((await readOrNull(join(config.outRoot, config.out.claudeMd))) === null) {
    drift.push({ path: config.out.claudeMd, reason: 'missing' });
  }

  for (const mirror of config.mirrors) {
    for (const dir of rendered.devSkillDirs) {
      const link = join(config.outRoot, mirror, dir);
      const stat = await lstatOrNull(link);
      if (!stat?.isSymbolicLink() || (await readlink(link)) !== mirrorTarget(config, mirror, dir)) {
        drift.push({ path: `${mirror}/${dir}`, reason: 'mirror' });
      }
    }
  }

  return drift.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
```

Run: `bun test src/compiler/write.test.ts`
Expected: `10 pass`.

- [ ] **Step 3: Escrever os testes de `compile` e do CLI (falham)**

Create `agentic.config.ts` (raiz):

```ts
import { defineConfig } from '@agentic-ddd/compiler';

export default defineConfig({
  modules: [{ name: 'orders', path: 'examples/orders' }],
});
```

Create `test/fixtures/broken/agentic.config.ts`:

```ts
import { defineConfig } from '@agentic-ddd/compiler';

export default defineConfig({
  modules: [{ name: 'broken', path: 'domain' }],
});
```

Create `test/fixtures/broken/domain/thing.ts` (o `@Invariant` **precisa** ficar na linha 5):

```ts
import { AggregateRoot } from '@agentic-ddd/core';
import { AgentEntity, Invariant } from '@agentic-ddd/decorators';

@AgentEntity({ description: 'Coisa com invariante mal nomeada.' })
@Invariant({ id: 'Id Ruim', text: 'Regra qualquer.' })
export class Thing extends AggregateRoot<string> {}
```

Create `src/compiler/compile.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { compile } from '@agentic-ddd/compiler';

const ROOT = resolve(import.meta.dir, '../..');
const configPath = join(ROOT, 'agentic.config.ts');

let out: string;

beforeEach(async () => {
  out = await mkdtemp(join(tmpdir(), 'agentic-compile-'));
});

afterEach(async () => {
  await rm(out, { recursive: true, force: true });
});

describe('compile (exemplo orders)', () => {
  test('escreve skills de dev e de runtime, AGENTS.md e CLAUDE.md', async () => {
    const result = await compile({ configPath, outRoot: out, mode: 'write' });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.ir?.operators.map((o) => o.id)).toEqual(['operator:order-operator']);
    const runtime = await readFile(join(out, '.agentic/runtime/order-operator/SKILL.md'), 'utf8');
    expect(runtime).toContain('### `cancel_order`');
    expect(runtime).toContain('| `invariant:Order/total-nao-negativo` |');
    const dev = await readFile(join(out, '.agents/skills/orders-dev/SKILL.md'), 'utf8');
    expect(dev).toContain('name: orders-dev');
    expect(dev).toContain('`examples/orders/domain/order.ts:');
    expect(await readFile(join(out, 'AGENTS.md'), 'utf8')).toContain('| orders | `examples/orders` |');
  });

  test('é idempotente e o check passa depois de escrever', async () => {
    await compile({ configPath, outRoot: out, mode: 'write' });
    const first = await readFile(join(out, '.agents/skills/orders-dev/SKILL.md'), 'utf8');
    await compile({ configPath, outRoot: out, mode: 'write' });
    expect(await readFile(join(out, '.agents/skills/orders-dev/SKILL.md'), 'utf8')).toBe(first);
    const check = await compile({ configPath, outRoot: out, mode: 'check' });
    expect(check.drift).toEqual([]);
    expect(check.ok).toBe(true);
  });

  test('check acusa arquivo gerado editado à mão', async () => {
    await compile({ configPath, outRoot: out, mode: 'write' });
    await writeFile(join(out, '.agentic/runtime/order-operator/SKILL.md'), 'editado');
    const check = await compile({ configPath, outRoot: out, mode: 'check' });
    expect(check.ok).toBe(false);
    expect(check.drift).toEqual([{ path: '.agentic/runtime/order-operator/SKILL.md', reason: 'changed' }]);
  });

  test('avisa quando CLAUDE.md existe sem @AGENTS.md', async () => {
    await writeFile(join(out, 'CLAUDE.md'), 'meu arquivo\n');
    const result = await compile({ configPath, outRoot: out, mode: 'write' });
    expect(result.warnings).toContain('CLAUDE.md existe mas não contém @AGENTS.md');
  });
});
```

Create `src/cli/cli.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '../..');

function run(...args: string[]) {
  const result = Bun.spawnSync(['bun', 'src/cli/main.ts', ...args], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' });
  return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

let out: string;

beforeEach(async () => {
  out = await mkdtemp(join(tmpdir(), 'agentic-cli-'));
});

afterEach(async () => {
  await rm(out, { recursive: true, force: true });
});

describe('agentic-ddd compile (CLI)', () => {
  test('escreve e depois --check sai com 0', () => {
    expect(run('compile', '--out-root', out).code).toBe(0);
    const check = run('compile', '--check', '--out-root', out);
    expect(check.code).toBe(0);
    expect(check.stdout).toContain('arquivos gerados estão em dia');
  });

  test('--check sai com 1 e lista o arquivo desatualizado', async () => {
    run('compile', '--out-root', out);
    await writeFile(join(out, '.agents/skills/orders-dev/SKILL.md'), 'editado');
    const check = run('compile', '--check', '--out-root', out);
    expect(check.code).toBe(1);
    expect(check.stderr).toContain('desatualizado (changed): .agents/skills/orders-dev/SKILL.md');
  });

  test('erro de declaração sai com 1 e aponta arquivo:linha', () => {
    const result = run('compile', '--config', 'test/fixtures/broken/agentic.config.ts', '--out-root', out);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('domain/thing.ts:5: invariant:Thing/Id Ruim: o id da invariante deve ser kebab-case');
  });

  test('uso incorreto sai com 2', () => {
    expect(run('build').code).toBe(2);
    expect(run('compile', '--nada').code).toBe(2);
  });
});
```

Run: `bun test src/compiler/compile.test.ts src/cli`
Expected: FAIL — `@agentic-ddd/compiler` / `src/cli/main.ts` inexistentes.

- [ ] **Step 4: Implementar `compile`, o index do compilador e o CLI**

`src/compiler/compile.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultRegistry, type Registry } from '@agentic-ddd/decorators';
import { analyze } from './analyze.js';
import { loadConfig, type ResolvedConfig } from './config.js';
import type { CompileError, IR } from './ir.js';
import { importModules } from './load.js';
import { renderAll, type Rendered } from './render/index.js';
import { checkOutputs, writeOutputs, type Drift } from './write.js';

export interface CompileOptions {
  readonly configPath: string;
  readonly outRoot?: string;
  readonly mode: 'write' | 'check';
  readonly registry?: Registry;
}

export interface CompileResult {
  readonly ok: boolean;
  readonly errors: CompileError[];
  readonly drift: Drift[];
  readonly written: string[];
  readonly warnings: string[];
  readonly ir: IR | null;
  readonly rendered: Rendered | null;
  readonly config: ResolvedConfig;
}

async function claudeWarnings(config: ResolvedConfig): Promise<string[]> {
  const content = await readFile(join(config.outRoot, config.out.claudeMd), 'utf8').catch(() => null);
  return content !== null && !content.includes('@AGENTS.md') ? [`${config.out.claudeMd} existe mas não contém @AGENTS.md`] : [];
}

export async function compile(options: CompileOptions): Promise<CompileResult> {
  const config = await loadConfig(options.configPath, { outRoot: options.outRoot });
  await importModules(config);
  const { ir, errors } = analyze(options.registry ?? defaultRegistry, { root: config.root, modules: config.modules });
  if (errors.length > 0) {
    return { ok: false, errors, drift: [], written: [], warnings: [], ir, rendered: null, config };
  }
  const rendered = renderAll(ir, config.out);
  const warnings = await claudeWarnings(config);
  if (options.mode === 'check') {
    const drift = await checkOutputs(config, rendered);
    return { ok: drift.length === 0, errors: [], drift, written: [], warnings, ir, rendered, config };
  }
  const result = await writeOutputs(config, rendered);
  return { ok: true, errors: [], drift: [], written: result.written, warnings: [...warnings, ...result.warnings], ir, rendered, config };
}
```

`src/compiler/index.ts`:

```ts
export { analyze } from './analyze.js';
export { byId, canonicalize, sha256, stableStringify } from './canonical.js';
export { compile, type CompileOptions, type CompileResult } from './compile.js';
export { defineConfig, loadConfig, resolveConfig, type AgenticConfig, type ModuleConfig, type ResolvedConfig } from './config.js';
export { itemOfMethod, workItems, type Layer, type WorkItem } from './graph.js';
export {
  buildIR,
  irHash,
  type CompileError,
  type IR,
  type IREntity,
  type IREvent,
  type IRInvariant,
  type IRMethod,
  type IRModule,
  type IROperator,
  type IRUseCase,
  type JsonSchema,
} from './ir.js';
export { DEFAULT_OUT, renderAll, type OutputPaths, type Rendered } from './render/index.js';
export { checkOutputs, writeOutputs, type Drift } from './write.js';
```

`src/cli/main.ts`:

```ts
import { compile } from '../compiler/compile.js';

export const USAGE = 'uso: agentic-ddd compile [--check] [--config <arquivo>] [--out-root <dir>]';

interface Flags {
  check: boolean;
  config: string;
  outRoot?: string;
}

function parseFlags(args: readonly string[]): Flags | string {
  const flags: Flags = { check: false, config: 'agentic.config.ts' };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--check') {
      flags.check = true;
    } else if (arg === '--config' || arg === '--out-root') {
      const value = args[++i];
      if (!value) return `${arg} exige um valor`;
      if (arg === '--config') flags.config = value;
      else flags.outRoot = value;
    } else {
      return `opção desconhecida: ${arg}`;
    }
  }
  return flags;
}

export async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command !== 'compile') {
    console.error(USAGE);
    return 2;
  }
  const flags = parseFlags(rest);
  if (typeof flags === 'string') {
    console.error(`${flags}\n${USAGE}`);
    return 2;
  }
  try {
    const result = await compile({ configPath: flags.config, outRoot: flags.outRoot, mode: flags.check ? 'check' : 'write' });
    for (const error of result.errors) console.error(`${error.source ?? '-'}: ${error.message}`);
    for (const item of result.drift) console.error(`desatualizado (${item.reason}): ${item.path}`);
    for (const warning of result.warnings) console.warn(`aviso: ${warning}`);
    if (!result.ok) {
      if (result.drift.length > 0) console.error('rode `bun run agentic compile` e commite os arquivos gerados');
      return 1;
    }
    console.log(flags.check ? 'agentic-ddd: arquivos gerados estão em dia' : `agentic-ddd: ${result.written.length} arquivo(s) atualizado(s)`);
    return 0;
  } catch (error) {
    console.error(`agentic-ddd: ${(error as Error).message}`);
    return 1;
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
```

- [ ] **Step 5: Rodar e ver passar**

Run: `bun test && bun run typecheck && bun run lint`
Expected: todos passam (incluindo os 4 de `compile.test.ts` e os 4 de `cli.test.ts`).

- [ ] **Step 6: Gerar os arquivos do repositório**

Create `AGENTS.md` (texto manual; o bloco gerado é anexado pelo compilador):

```markdown
# AGENTS.md

Este repositório é o framework `@agentic-ddd` (em `src/`) e o app de exemplo `examples/orders`.

## Desenvolvimento do framework

- Runtime, testes e build: Bun (`bun test`, `bun run typecheck`, `bun run lint`, `bun run build`).
- Design: `docs/superpowers/specs/2026-10-06-agentic-ddd-v0-design.md`; decisões: `docs/adr/ADR-0001.md`; planos: `docs/superpowers/plans/`.
- `examples/**` importa o framework só via `@agentic-ddd/*`; `src/core` só importa `zod`.
- Testes com `bun:test`; snapshots em `__snapshots__/` são revisados como código.
```

Run:

```bash
bun run agentic compile
bun run agentic compile --check
ls -la .claude/skills/
```

Expected: `agentic-ddd: N arquivo(s) atualizado(s)`; o `--check` imprime `arquivos gerados estão em dia`; `.claude/skills/orders-dev -> ../../.agents/skills/orders-dev`. Abrir `.agentic/runtime/order-operator/SKILL.md` e `.agents/skills/orders-dev/SKILL.md` e ler como um agente leria: as três tools, as invariantes, as transições, as dependências e "Como estender" devem estar corretos.

- [ ] **Step 7: Commit**

```bash
git add src/compiler src/cli agentic.config.ts test/fixtures/broken AGENTS.md CLAUDE.md .agents .claude .agentic
git commit -m "feat(compiler): adiciona compile/--check, escrita em disco e gera as skills do exemplo"
```

---

### Task 13: Lint das skills geradas e `--report`

**Files:**
- Create: `src/compiler/lint.ts`, `src/compiler/report.ts`
- Modify: `src/compiler/compile.ts`, `src/compiler/index.ts`, `src/cli/main.ts`
- Test: `src/compiler/lint.test.ts`, `src/cli/cli.test.ts` (novo caso)

**Interfaces:**
- Consumes: `Rendered` (Task 11), `compile` (Task 12).
- Produces:
  - `lint.ts`: `LintFinding { path; severity: 'error' | 'warning'; message }`, `approxTokens(text): number` (`ceil(chars / 4)`), `lintSkill(path, content): LintFinding[]`, `lintRendered(rendered): LintFinding[]`
  - `report.ts`: `formatReport(rendered, findings): string`
  - `CompileResult` ganha `lint: LintFinding[]`; erros de lint entram em `errors` (como `lint: <mensagem>` com `source = caminho`) e tornam `ok = false` nos dois modos (no modo `write` os arquivos são escritos mesmo assim, para inspeção).
  - CLI: flag `--report` imprime o relatório.

- [ ] **Step 1: Escrever o teste que falha**

Create `src/compiler/lint.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { SHOP_MODULE, defineShop } from './__fixtures__/shop.js';
import { analyze } from './analyze.js';
import { approxTokens, lintRendered, lintSkill } from './lint.js';
import { DEFAULT_OUT, renderAll } from './render/index.js';

const ROOT = resolve(import.meta.dir, '../..');

function skill(name: string, description: string, body = 'Corpo.\n'): string {
  return `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\nmetadata:\n  agentic-ddd.generated: "true"\n---\n${body}`;
}

const errorsOf = (path: string, content: string) =>
  lintSkill(path, content).filter((f) => f.severity === 'error').map((f) => f.message);

describe('lintSkill', () => {
  test('skill válida não tem erros', () => {
    expect(errorsOf('x/minha-skill/SKILL.md', skill('minha-skill', 'Faz algo. Use quando precisar.'))).toEqual([]);
  });

  test('name diferente da pasta ou fora do padrão', () => {
    expect(errorsOf('x/outra/SKILL.md', skill('minha-skill', 'D.'))).toEqual(['name "minha-skill" difere da pasta "outra"']);
    expect(errorsOf('x/Minha--Skill/SKILL.md', skill('Minha--Skill', 'D.'))).toContain(
      'name "Minha--Skill" fora do padrão (a-z, 0-9 e hífens simples; até 64)',
    );
  });

  test('description vazia ou acima de 1024 caracteres', () => {
    expect(errorsOf('x/s/SKILL.md', skill('s', ''))).toEqual(['description com 0 caracteres (precisa de 1 a 1024)']);
    expect(errorsOf('x/s/SKILL.md', skill('s', 'a'.repeat(1100)))).toEqual(['description com 1100 caracteres (precisa de 1 a 1024)']);
  });

  test('SKILL.md acima de 500 linhas e referência profunda', () => {
    expect(errorsOf('x/s/SKILL.md', skill('s', 'D.', 'linha\n'.repeat(500)))).toContain('SKILL.md com 507 linhas (máximo 500)');
    expect(errorsOf('x/s/SKILL.md', skill('s', 'D.', '[x](references/a/b.md)\n'))).toEqual([
      'referência references/a/b.md passa de um nível de profundidade',
    ]);
  });

  test('frontmatter ausente', () => {
    expect(errorsOf('x/s/SKILL.md', '# sem frontmatter\n')).toEqual(['frontmatter YAML ausente']);
  });

  test('orçamento de tokens vira aviso', () => {
    const findings = lintSkill('x/s/SKILL.md', skill('s', 'D.', 'x'.repeat(21_000)));
    expect(findings).toEqual([{ path: 'x/s/SKILL.md', severity: 'warning', message: 'corpo com ~5250 tokens (orçamento < 5000)' }]);
    expect(approxTokens('abcd')).toBe(1);
  });

  test('as skills geradas do shop passam no lint', () => {
    const rendered = renderAll(analyze(defineShop(), { root: ROOT, modules: [SHOP_MODULE] }).ir, DEFAULT_OUT);
    expect(lintRendered(rendered).filter((f) => f.severity === 'error')).toEqual([]);
  });
});
```

Append to `src/cli/cli.test.ts` (dentro do `describe`):

```ts
  test('--report imprime tokens por arquivo', () => {
    const result = run('compile', '--report', '--out-root', out);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('| `.agentic/runtime/order-operator/SKILL.md` |');
    expect(result.stdout).toContain('≈tokens');
  });
```

Run: `bun test src/compiler/lint.test.ts src/cli`
Expected: FAIL — `./lint.js` não encontrado; `--report` é opção desconhecida.

- [ ] **Step 2: Implementar lint e report**

`src/compiler/lint.ts`:

```ts
import type { Rendered } from './render/index.js';

export interface LintFinding {
  readonly path: string;
  readonly severity: 'error' | 'warning';
  readonly message: string;
}

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/;

export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function lintSkill(path: string, content: string): LintFinding[] {
  const findings: LintFinding[] = [];
  const add = (severity: LintFinding['severity'], message: string): void => {
    findings.push({ path, severity, message });
  };

  const match = FRONTMATTER.exec(content);
  if (!match) {
    add('error', 'frontmatter YAML ausente');
    return findings;
  }
  const header = match[1]!;
  const body = content.slice(match[0].length);
  const name = /^name: (.*)$/m.exec(header)?.[1] ?? '';
  const rawDescription = /^description: (.*)$/m.exec(header)?.[1] ?? '""';
  let description = '';
  try {
    description = String(JSON.parse(rawDescription));
  } catch {
    add('error', 'description não é uma string válida');
  }
  const dirName = path.split('/').at(-2) ?? '';

  if (!NAME.test(name) || name.length > 64) add('error', `name "${name}" fora do padrão (a-z, 0-9 e hífens simples; até 64)`);
  else if (name !== dirName) add('error', `name "${name}" difere da pasta "${dirName}"`);
  if (description.length === 0 || description.length > 1024) {
    add('error', `description com ${description.length} caracteres (precisa de 1 a 1024)`);
  }
  const lines = content.split('\n').length;
  if (lines > 500) add('error', `SKILL.md com ${lines} linhas (máximo 500)`);
  for (const link of content.matchAll(/\]\((references\/[^)]+)\)/g)) {
    if (link[1]!.split('/').length > 2) add('error', `referência ${link[1]} passa de um nível de profundidade`);
  }
  const metaTokens = approxTokens(`${name} ${description}`);
  if (metaTokens > 100) add('warning', `metadados com ~${metaTokens} tokens (orçamento ~100)`);
  const bodyTokens = approxTokens(body);
  if (bodyTokens > 5000) add('warning', `corpo com ~${bodyTokens} tokens (orçamento < 5000)`);
  return findings;
}

export function lintRendered(rendered: Rendered): LintFinding[] {
  return [...rendered.files].filter(([path]) => path.endsWith('/SKILL.md')).flatMap(([path, content]) => lintSkill(path, content));
}
```

`src/compiler/report.ts`:

```ts
import type { LintFinding } from './lint.js';
import { approxTokens } from './lint.js';
import { code, table } from './render/markdown.js';
import type { Rendered } from './render/index.js';

export function formatReport(rendered: Rendered, findings: readonly LintFinding[]): string {
  const rows = [...rendered.files].map(([path, content]) => [code(path), String(content.split('\n').length), String(approxTokens(content))]);
  const lines = ['# agentic-ddd — relatório', '', table(['Arquivo', 'Linhas', '≈tokens'], rows), ''];
  if (findings.length === 0) lines.push('Lint: nenhum problema.');
  else for (const f of findings) lines.push(`- [${f.severity === 'error' ? 'erro' : 'aviso'}] ${f.path}: ${f.message}`);
  return `${lines.join('\n')}\n`;
}
```

- [ ] **Step 3: Integrar no `compile` e no CLI**

Replace `src/compiler/compile.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultRegistry, type Registry } from '@agentic-ddd/decorators';
import { analyze } from './analyze.js';
import { loadConfig, type ResolvedConfig } from './config.js';
import type { CompileError, IR } from './ir.js';
import { lintRendered, type LintFinding } from './lint.js';
import { importModules } from './load.js';
import { renderAll, type Rendered } from './render/index.js';
import { checkOutputs, writeOutputs, type Drift } from './write.js';

export interface CompileOptions {
  readonly configPath: string;
  readonly outRoot?: string;
  readonly mode: 'write' | 'check';
  readonly registry?: Registry;
}

export interface CompileResult {
  readonly ok: boolean;
  readonly errors: CompileError[];
  readonly drift: Drift[];
  readonly written: string[];
  readonly warnings: string[];
  readonly lint: LintFinding[];
  readonly ir: IR | null;
  readonly rendered: Rendered | null;
  readonly config: ResolvedConfig;
}

async function claudeWarnings(config: ResolvedConfig): Promise<string[]> {
  const content = await readFile(join(config.outRoot, config.out.claudeMd), 'utf8').catch(() => null);
  return content !== null && !content.includes('@AGENTS.md') ? [`${config.out.claudeMd} existe mas não contém @AGENTS.md`] : [];
}

export async function compile(options: CompileOptions): Promise<CompileResult> {
  const config = await loadConfig(options.configPath, { outRoot: options.outRoot });
  await importModules(config);
  const { ir, errors } = analyze(options.registry ?? defaultRegistry, { root: config.root, modules: config.modules });
  if (errors.length > 0) {
    return { ok: false, errors, drift: [], written: [], warnings: [], lint: [], ir, rendered: null, config };
  }
  const rendered = renderAll(ir, config.out);
  const lint = lintRendered(rendered);
  const lintErrors: CompileError[] = lint
    .filter((f) => f.severity === 'error')
    .map((f) => ({ message: `lint: ${f.message}`, source: f.path }));
  const warnings = [...(await claudeWarnings(config)), ...lint.filter((f) => f.severity === 'warning').map((f) => `${f.path}: ${f.message}`)];
  if (options.mode === 'check') {
    const drift = await checkOutputs(config, rendered);
    return { ok: drift.length === 0 && lintErrors.length === 0, errors: lintErrors, drift, written: [], warnings, lint, ir, rendered, config };
  }
  const result = await writeOutputs(config, rendered);
  return {
    ok: lintErrors.length === 0,
    errors: lintErrors,
    drift: [],
    written: result.written,
    warnings: [...warnings, ...result.warnings],
    lint,
    ir,
    rendered,
    config,
  };
}
```

In `src/compiler/index.ts`, add:

```ts
export { approxTokens, lintRendered, lintSkill, type LintFinding } from './lint.js';
export { formatReport } from './report.js';
```

Replace `src/cli/main.ts`:

```ts
import { compile } from '../compiler/compile.js';
import { formatReport } from '../compiler/report.js';

export const USAGE = 'uso: agentic-ddd compile [--check] [--report] [--config <arquivo>] [--out-root <dir>]';

interface Flags {
  check: boolean;
  report: boolean;
  config: string;
  outRoot?: string;
}

function parseFlags(args: readonly string[]): Flags | string {
  const flags: Flags = { check: false, report: false, config: 'agentic.config.ts' };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--check') {
      flags.check = true;
    } else if (arg === '--report') {
      flags.report = true;
    } else if (arg === '--config' || arg === '--out-root') {
      const value = args[++i];
      if (!value) return `${arg} exige um valor`;
      if (arg === '--config') flags.config = value;
      else flags.outRoot = value;
    } else {
      return `opção desconhecida: ${arg}`;
    }
  }
  return flags;
}

export async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command !== 'compile') {
    console.error(USAGE);
    return 2;
  }
  const flags = parseFlags(rest);
  if (typeof flags === 'string') {
    console.error(`${flags}\n${USAGE}`);
    return 2;
  }
  try {
    const result = await compile({ configPath: flags.config, outRoot: flags.outRoot, mode: flags.check ? 'check' : 'write' });
    if (flags.report && result.rendered) console.log(formatReport(result.rendered, result.lint));
    for (const error of result.errors) console.error(`${error.source ?? '-'}: ${error.message}`);
    for (const item of result.drift) console.error(`desatualizado (${item.reason}): ${item.path}`);
    for (const warning of result.warnings) console.warn(`aviso: ${warning}`);
    if (!result.ok) {
      if (result.drift.length > 0) console.error('rode `bun run agentic compile` e commite os arquivos gerados');
      return 1;
    }
    console.log(flags.check ? 'agentic-ddd: arquivos gerados estão em dia' : `agentic-ddd: ${result.written.length} arquivo(s) atualizado(s)`);
    return 0;
  } catch (error) {
    console.error(`agentic-ddd: ${(error as Error).message}`);
    return 1;
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
```

- [ ] **Step 4: Rodar e ver passar**

Run: `bun test && bun run typecheck && bun run lint && bun run agentic compile --check --report`
Expected: todos os testes passam; o relatório lista os arquivos do exemplo com linhas e ≈tokens e `Lint: nenhum problema.` (ou só avisos); `arquivos gerados estão em dia`.

- [ ] **Step 5: Commit**

```bash
git add src/compiler src/cli
git commit -m "feat(compiler): adiciona lint das skills geradas e compile --report"
```

---

### Task 14: Teste de arquitetura, CI, README e CONTRIBUTING

**Files:**
- Create: `test/architecture.test.ts`, `.github/workflows/ci.yml`, `CONTRIBUTING.md`
- Modify: `README.md` (reescrita completa)

**Interfaces:**
- Consumes: estrutura de pastas das Tasks 1–13.
- Produces: verificação automática das regras de dependência da spec §3; CI com typecheck, lint, test, build e `compile --check`.

- [ ] **Step 1: Escrever o teste de arquitetura**

Create `test/architecture.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const IMPORT = /(?:^|\n)\s*(?:import|export)\s(?:[^'"]*?\sfrom\s)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

function filesIn(dir: string, { includeTests = false } = {}): string[] {
  const absolute = resolve(ROOT, dir);
  if (!existsSync(absolute)) return [];
  return [...new Bun.Glob('**/*.ts').scanSync({ cwd: absolute })]
    .map((file) => `${dir}/${file.split(sep).join('/')}`)
    .filter((file) => includeTests || !/\.test\.ts$/.test(file))
    .sort();
}

function importsOf(file: string): string[] {
  const text = readFileSync(resolve(ROOT, file), 'utf8');
  return [...text.matchAll(IMPORT)].map((m) => m[1] ?? m[2]!);
}

function resolvesInto(file: string, specifier: string, dir: string): boolean {
  return specifier.startsWith('.') && resolve(ROOT, dirname(file), specifier).startsWith(`${resolve(ROOT, dir)}${sep}`);
}

function offenders(files: string[], allowed: (file: string, specifier: string) => boolean): string[] {
  return files.flatMap((file) => importsOf(file).filter((s) => !allowed(file, s)).map((s) => `${file} → ${s}`));
}

describe('arquitetura', () => {
  test('o extrator de imports funciona', () => {
    expect(importsOf('src/core/aggregate-root.ts')).toEqual(['./domain-event.js', './entity.js']);
  });

  test('src/core só importa zod e o próprio core', () => {
    expect(offenders(filesIn('src/core'), (f, s) => s === 'zod' || resolvesInto(f, s, 'src/core'))).toEqual([]);
  });

  test('src/decorators só importa core, zod, reflect-metadata e node:*', () => {
    const allowed = (f: string, s: string) =>
      ['zod', 'reflect-metadata', '@agentic-ddd/core'].includes(s) || s.startsWith('node:') || resolvesInto(f, s, 'src/decorators');
    expect(offenders(filesIn('src/decorators'), allowed)).toEqual([]);
  });

  test('domain e application do exemplo não importam Nest nem runtime de LLM', () => {
    const files = [...filesIn('examples/orders/domain'), ...filesIn('examples/orders/application')];
    const forbidden = (s: string) => s.startsWith('@nestjs/') || s === '@agentic-ddd/runtime' || s === '@agentic-ddd/nestjs';
    expect(offenders(files, (_f, s) => !forbidden(s))).toEqual([]);
  });

  test('examples só importa o framework via @agentic-ddd/*', () => {
    expect(offenders(filesIn('examples', { includeTests: true }), (f, s) => !resolvesInto(f, s, 'src'))).toEqual([]);
  });

  test('compiler e runtime não se importam', () => {
    const fromCompiler = offenders(filesIn('src/compiler'), (f, s) => s !== '@agentic-ddd/runtime' && !resolvesInto(f, s, 'src/runtime'));
    const fromRuntime = offenders(filesIn('src/runtime'), (f, s) => s !== '@agentic-ddd/compiler' && !resolvesInto(f, s, 'src/compiler'));
    expect([...fromCompiler, ...fromRuntime]).toEqual([]);
  });

  test('nenhum @Controller no repositório', () => {
    const files = [...filesIn('src', { includeTests: true }), ...filesIn('examples', { includeTests: true })];
    expect(files.filter((f) => readFileSync(resolve(ROOT, f), 'utf8').includes('@Controller('))).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar**

Run: `bun test test/architecture.test.ts`
Expected: `7 pass`. Se algum falhar, corrigir o import infrator no arquivo listado (não relaxar a regra).

- [ ] **Step 3: Criar o CI**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.4.2
      - run: bun install --frozen-lockfile
      - run: bun run typecheck
      - run: bun run lint
      - run: bun test
      - run: bun run build
      - run: bun run agentic compile --check
```

- [ ] **Step 4: Reescrever o README e criar o CONTRIBUTING**

Replace `README.md`:

````markdown
# @agentic-ddd

Framework open-source sobre **NestJS + DDD** em que:

- **use-cases são tools** que um agente de IA pode chamar;
- **operators** (agentes de IA declarativos) substituem os controllers;
- um **compilador** lê entidades, use-cases e operators decorados e gera **skills** (padrão [Agent Skills](https://agentskills.io/specification)) e um **`AGENTS.md`**: skills de *runtime* para o operator executar o domínio e skills de *dev* para agentes de código (Claude Code, Codex, Copilot…) manterem o projeto.

O código decorado é a única fonte de verdade: descrição, regra e implementação não divergem, e o CI falha se a documentação gerada estiver desatualizada.

## Como funciona

```
@AgentEntity / @Invariant / @AgentMethod / @AgentEvent / @AgentUseCase / @Operator
        │  (decorators registram metadados + arquivo:linha)
        ▼
   registry ──▶ IR canônica ──▶ validação ──▶ renderers ──▶ .agents/skills/  .agentic/runtime/  AGENTS.md
```

```ts
@AgentEntity({ description: 'Pedido de compra de um cliente.', states: ['pending', 'confirmed', 'cancelled'] })
@Invariant({ id: 'ao-menos-um-item', text: 'Um pedido precisa ter ao menos um item.' })
export class Order extends AggregateRoot<string> {
  @AgentMethod({ description: 'Confirma um pedido pendente.', transition: { from: ['pending'], to: 'confirmed' }, emits: [OrderConfirmed] })
  confirm(): void { /* … */ }
}
```

O exemplo completo está em [`examples/orders`](examples/orders); as skills geradas a partir dele estão em [`.agentic/runtime/order-operator`](.agentic/runtime/order-operator/SKILL.md) e [`.agents/skills/orders-dev`](.agents/skills/orders-dev/SKILL.md).

## Quickstart

Requer [Bun](https://bun.sh) 1.4.2.

```bash
bun install
bun test                         # testes
bun run agentic compile          # gera skills e o bloco do AGENTS.md
bun run agentic compile --check  # falha se algo gerado estiver desatualizado (usado no CI)
bun run agentic compile --report # tokens por arquivo e lint das skills
```

## Estrutura

| Caminho | Conteúdo |
|---|---|
| `src/core` | building blocks DDD (`AggregateRoot`, `DomainEvent`, `DomainError`, `notImplemented`…) |
| `src/decorators` | decorators autodeclarativos e o registry |
| `src/compiler` | IR, validação, renderers, escrita/verificação |
| `src/testing` | `covers()` e `createTestContext()` |
| `src/cli` | `agentic-ddd compile` |
| `examples/orders` | domínio de exemplo |

## Roadmap

- **v0** (em andamento, ver [`docs/superpowers/plans`](docs/superpowers/plans/2026-10-06-v0-00-index.md)): compilador de documentação → lock, changes e `verify` → estado do projeto e coordenação de agentes → runtime do operator e integração Nest.
- **v0.1**: operators reagindo a eventos (`reactsTo`), testes de contrato gerados, avaliação das skills entre LLMs, canal HTTP, skill do framework.

Design: [`docs/superpowers/specs/2026-10-06-agentic-ddd-v0-design.md`](docs/superpowers/specs/2026-10-06-agentic-ddd-v0-design.md) · Decisões: [`docs/adr/ADR-0001.md`](docs/adr/ADR-0001.md)

## Licença

[MIT](LICENSE)
````

Create `CONTRIBUTING.md`:

```markdown
# Contribuindo

## Ambiente

- [Bun](https://bun.sh) 1.4.2: `bun install`.
- Antes de abrir um PR: `bun run typecheck && bun run lint && bun test && bun run build && bun run agentic compile --check`.

## Como trabalhamos

- **TDD:** escreva o teste que falha, implemente o mínimo, refatore. Testes usam `bun:test`.
- **Snapshots** (`__snapshots__/`) são código: revise o diff deles no PR.
- **Testes de domínio** declaram o que cobrem com `covers([...ids], título)` de `@agentic-ddd/testing`.
- **Arquivos gerados** (`.agents/skills/`, `.claude/skills/`, `.agentic/`, bloco do `AGENTS.md`) nunca são editados à mão: altere o código decorado e rode `bun run agentic compile`.
- **Imports:** relativos com sufixo `.js`; `examples/**` só importa o framework via `@agentic-ddd/*`; tipos em assinaturas de classes decoradas usam `import type`.
- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/pt-br/) em português (`feat(compiler): …`, `fix(core): …`), pequenos e atômicos.

## Design

Mudanças de arquitetura começam pela spec (`docs/superpowers/specs/`) e pelo ADR (`docs/adr/`).
```

- [ ] **Step 5: Rodar a verificação completa**

Run: `bun run typecheck && bun run lint && bun test && bun run build && bun run agentic compile --check`
Expected: tudo verde; `arquivos gerados estão em dia`.

- [ ] **Step 6: Commit**

```bash
git add test/architecture.test.ts .github/workflows/ci.yml README.md CONTRIBUTING.md
git commit -m "chore: adiciona teste de arquitetura, CI, README e CONTRIBUTING"
```
