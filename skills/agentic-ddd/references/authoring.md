# Domain authoring

Read the configuration in use: `modules[].path` sets the module root; `out.devSkills`, `out.runtimeSkills`, `mirrors`, `changes` and `verify` can override the defaults. Check `AGENTS.md` and the generated skill `<module>-dev/SKILL.md` in those paths. Do not assume `examples/orders` in consumers.

Create entities, events, value objects and ports in `<module>/domain`, use-cases in `<module>/application`, operators in `<module>/operators` and adapters in `<module>/infrastructure` (its own layer, see "Adapters"); composition follows the project. Import building blocks from `@agentic-ddd/core`, decorators from `@agentic-ddd/decorators`, tests from `@agentic-ddd/testing` and schemas from `zod`.

- `@AgentEntity({ description, states })` declares an entity and its states. Each rule is `@Invariant({ id, text })`, on the class or method; keep kebab-case IDs, which produce the obligations `invariant:Entity/id`.
- Every public business method has `@AgentMethod({ description, emits, transition })`; helpers use `#private`. A static `create` factory sets construction (`entity:Entity`); methods are `method:Entity.name`. State getters and methods inherited from the building blocks follow the existing conventions.
- `@AgentEvent({ description, payload: z.object(...) })` on classes that extend `DomainEvent<Payload>` declares events; aggregates use `record`/`pullEvents`. Keep `emits` consistent in methods and use-cases. A use-case's `emits` covers everything the methods in `uses` emit (compile fails on anything missing), and the runtime refuses an event published outside it.
- `@AgentUseCase({ name, description, whenToUse, whenNotToUse, input, output, uses, emits, ports })` uses explicit Zod schemas and `z.infer` types. `uses` lists real IDs such as `method:Task.create` and `method:Task.complete`; it defines dependencies. `ports` is optional (see "Ports"). Implement `UseCase<In, Out>` and `execute(input, ctx)`, inject the repository port and publish events through `ctx.publish`.
- `@Operator({ name, description, instructions, useCases, requiresApproval })` references use-case classes; it is declarative, with no mandatory execute body. Prepare the run/test infrastructure before dispatching.
- A still pending body: `return notImplemented();` imported from core. Only the literal call is recognized; an empty body counts as implemented. Do not replace it with a generic throw or a wrapper.

Business text (`text`, `description`, `instructions`, the proposal) is written in the author's language and never translated by the framework or by agents.

Before changing a rule, write a proposal in the configured directory. The `## Motivo` heading is required by the compiler and the proposal is only applied when it is filled in:

```yaml
---
id: '0001'
title: Criar tarefas
status: proposed
origin: proposal-first
delta:
  added:
    ['entity:Task', 'method:Task.create', 'invariant:Task/titulo-obrigatorio']
  modified: []
  removed: []
acceptance:
  - id: titulo-invalido
    covers: ['invariant:Task/titulo-obrigatorio']
    given: título vazio
    when: criar uma tarefa
    then: rejeita com TASK_TITLE_REQUIRED
---
## Motivo

O usuário precisa de tarefas identificadas com um título válido.
```

Fill in the complete delta (events/use-cases/operators and the `valueobject:`/`port:`/`adapter:` ids too; changing a port requires a proposal) and automatic Given/When/Then criteria or `manual: true`. Then declare and run `bun run agentic compile --config <config>`. If the code already changed, `compile --draft-change <slug>` only generates a draft; fill in the reason and criteria before compiling. Compare the generated lock/skills and do not edit them.

Tests: `test(covers(['method:Task.create', 'invariant:Task/titulo-obrigatorio', 'criterion:0001/titulo-invalido'], 'rejects an empty title'), () => { ... });`. The packet's IDs set the obligations; do not use coverage without real assertions.

## Value objects

A value object (defined by its values, with no identity of its own) uses `@AgentValueObject({ description })` on a class that extends `ValueObject` from `@agentic-ddd/core`. It becomes the item `valueobject:<Name>` of the `domain` layer.

- It accepts `@Invariant` on the class (`invariant:<Name>/<id>`); on a method it is an error.
- Obligations: the `valueobject:<Name>` itself and each invariant, covered by `covers([...])` in the tests.
- Skeleton: the literal call `notImplemented()` in any body of the class (constructor, `#private` or method).
- Do not instantiate a skeleton value object at module top level (e.g. `static ZERO = new Dinheiro(...)`): `compile` imports the file and throws.
- The value object's file must be imported by the application, like an entity's; the runtime's `irHash` includes value objects.

```ts
@AgentValueObject({ description: 'Valor monetário em centavos.' })
@Invariant({ id: 'nao-negativo', text: 'Dinheiro não é negativo.' })
export class Dinheiro extends ValueObject<{ centavos: number; moeda: string }> {
  // body with notImplemented() while pending
}
```

## Relations between aggregates

`@AgentEntity({ contains: () => [...], references: () => [...] })` declares the relations, always on the owner and always through a function (which imports the class after it is loaded).

- `contains`: a value object or child entity of the same aggregate. Contained items enter the entity's `dependsOn`, so they come before it in the waves.
- `references`: entities only (root of another aggregate). Citing a value object is an error. It creates no edge, so aggregates may reference each other in a cycle; the packet carries the contract of the id and of the referenced root.
- Root: it is derived. The entity no `contains` cites is a root.
- Errors: a child entity in more than one `contains`; a child entity from another module (a value object from another module is accepted); a `contains` cycle between entities; a `contains`/`references` function that throws or returns a class without a decorator (compile error, with the owner's `source`).
- A value object can be in several `contains`; a child entity, in only one.
- Warning, not error: a root that does not extend `AggregateRoot`, or a child that does.
- What the field holds is checked by "Gate T" (T1 and T3).

```ts
@AgentEntity({
  description: 'Matrícula de um aluno numa turma.',
  states: ['ativa', 'cancelada'],
  contains: () => [AlunoId, TurmaId],
  references: () => [Aluno, Turma],
})
export class Matricula extends AggregateRoot<string> {}
```

## Invariant on a use-case

`@Invariant({ id, text })` also works on `@AgentUseCase`, for a rule that crosses aggregates (such as "active student"). The id is `invariant:<use-case>/<id>` (`matricular_aluno/aluno-ativo`), with `on: null`, and it is an obligation of the use-case item: cover it with `covers([...])` in its test.

## Ports

A port (the repository contract the domain uses) is an `abstract` class with `@AgentPort({ description, root: () => Root, methods: { name: 'description' } })`. It becomes the element `port:<Name>`, with no item of its own: whoever implements it is the adapter (see "Adapters").

- `root` must be an aggregate root.
- Every abstract method of the class is in `methods`, and every method in `methods` is abstract in the class; a difference is a compile error.
- The methods enter the `specHash`, so changing a port requires a proposal.
- The use-case declares `ports: () => [Port]` and its packet carries the methods. This creates no `dependsOn`; the order comes from `uses`.
- A port without methods leaves the adapter in error, because it would have no obligations.

## Gate T

Gate T checks, in `entity:` and `valueobject:`, what a field holds. T1: a field or constructor parameter whose type names the root of another aggregate (hold the id, such as `AlunoId`). T2: a field or value object prop that names an entity. T3: an entity field that names a value object outside its `contains`, or a child entity of another aggregate; children of the same aggregate are allowed.

T runs only in `verify --item` of an `entity:` or `valueobject:` item in a project with tactical elements (value object, `contains`/`references`, port or adapter). `status` and `verify <NNNN>` do not see it, and a use-case or operator that edits the entity's file is not re-checked.

Who fixes it: the executor only changes the type of a `#private` it created in a value object. A declared field, parameter property, `contains`/`references` and value object props are declarations, and the manager adjusts them: proposal and compile when the IR changes, a new packet when the specHash changes.

False negatives that T does not see: type aliases and renamed imports; inferred types without annotation; value object props in a named interface or alias (`ValueObject<Props>`); function types, `typeof`, `keyof`, indexed access (`Aluno['id']`) and user generic arguments (`Partial<Aluno>`); `Promise`, `WeakMap`, `WeakSet` and `WeakRef` are not opened; inherited fields are not read; the id type in `extends AggregateRoot<X>` is not checked.

Inherited limit: a class expression or a decorator through an alias falls into fail-closed, which fails with "class not found" instead of passing.

## Team rules

Team rules live in `.ai/rules/*.md` (folder changeable through `rules.dir`); each file is a rule and its key is the path without `.md`, such as `testes` for `.ai/rules/testes.md`. An optional frontmatter with only `paths:` (globs relative to the root) limits the rule: without it, the rule goes whole into the AGENTS.md conventions; with it, it goes into the per-path rule index and into the team rules section of the dev skills whose files match. The body is a `- ` list, with no `#` heading. A file with the same key as a core rule (`core/...`) replaces that rule, and `rules.exclude` removes one; executor and reviewer briefs receive the team rules that apply to the item's file (not the core ones; your replacement of one, including a coordination rule such as `core/coordination`, reaches the executor), up to `rules.briefMaxTokens` (default 2000), and above the limit the brief fails instead of truncating. Gates (verify, specHash, boundaries, `covers`) always beat a rule. After editing, recompile: `compile --check` fails on a rule changed without recompiling.

## Layout conventions

By default, the layers are `domain`, `application` and `operators` inside each module; `infrastructure` (adapters) has its folders in `conventions.infrastructure` (default `['infrastructure', 'infra']`), not in `conventions.layers`. To change folder names, suffixes or forbidden imports, use `conventions` in `agentic.config.ts`:

```ts
export default defineConfig({
  modules: [{ name: 'shop', path: 'src/shop/core' }],
  conventions: {
    layers: { domain: 'model' },
    suffixes: { events: '.evt.ts' },
  },
});
```

Here, entities and events live in `src/shop/core/model`, with events in `.evt.ts`; `application` and `operators` follow the default.

- `domain`, `application` and `operators` are each the name of a single folder inside the module; `infrastructure` accepts a list of folders. A nested layout, such as `src/<bc>/core/domain`, is done through `modules[].path`; layers under different parents are not supported.
- An item's layer still comes from the decorator, not from the folder.
- `forbiddenImports` says what `domain` and `application` may not import. A list replaces the default, it does not add to it; declaring one layer keeps the other's default. `[]` turns off the folder rule for that layer, but the barrier to `@nestjs/*` and to the runtime stays. `operators` has no import rule.
- `suffixes` only changes the text of the "how to extend" table; no gate checks file names by suffix.
- These conventions apply to the "how to extend" table of the dev skill, to the layer text in the AGENTS.md block and to the import gate of `orchestrate`.
- A team rule with the key `core/layers` changes only the text; the gate stays the same.
- The CLI `bun scripts/boundary-gates.ts imports` uses only the default; it does not read `agentic.config.ts`.

## Adapters

An adapter (the implementation of a port, the repository contract the domain uses) uses `@AgentAdapter({ description, implements: () => Port })` on a class that extends the port, declared as an abstract class with `@AgentPort`. It lives in `<module>/infrastructure` (the accepted folders are in `conventions.infrastructure`; default `infrastructure` or `infra`) and becomes the item `adapter:<Name>` of the `infrastructure` layer, which depends on the port's root.

- Obligations: one id `port:<Port>.<method>` per port method, each covered by `covers([...])` in the adapter's test.
- One adapter per port in v0.5; a second adapter for the same port is an error.
- Class scope: the executor changes bodies and `#private` members, but not the decorators, `extends`/`implements` or the public signature.
- Imports and `#private` fields already come in the skeleton.
- The file must have no side effect on import (`compile` imports every `.ts` in the module): connections go in the constructor or a factory.

```ts
@AgentAdapter({
  description: 'Matrículas em memória.',
  implements: () => MatriculaRepository,
})
export class InMemoryMatriculaRepository extends MatriculaRepository {
  #itens = new Map<string, Matricula>();

  async save(matricula: Matricula): Promise<void> {
    return notImplemented();
  }
  async contarPorTurma(turma: TurmaId): Promise<number> {
    return notImplemented();
  }
}
```
