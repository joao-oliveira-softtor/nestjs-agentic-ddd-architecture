# Tasks tutorial

Prerequisites: Bun and a permanent checkout of the framework. The install uses that checkout's aliases and dependencies; it is not an npm distribution smoke test.

```bash
# In the framework checkout:
bun install --frozen-lockfile
bun run skills:example --root ../agentic-tasks
cd ../agentic-tasks
bun run typecheck
bun run agentic compile
bun run agentic status --json
bun run agentic next --change 0001 --json
bun run agentic packet entity:Task > ../task-packet.md
```

Pick a destination that does not exist: the generator refuses existing folders, even empty ones. It writes the proposal before the declarations and prepares imports/infra/config, bodies with `notImplemented()` and no tests. Compile applies and archives the proposal into `changes/archive/0001-tasks/proposal.md` before the bodies are implemented: check the criteria there. Do not edit the archived file. The workspace also has the team rule `.ai/rules/testes.md`: after compile it appears in the per-path index of the AGENTS.md block, in the `tasks-dev` skill and in the briefs of the items under `app/`.

Without tests, status/next/packet work and do not certify done. The initial order is `entity:Task` → `method:Task.complete`/`usecase:create_task` → `usecase:complete_task` → `operator:task-operator`. The manager hands over one packet at a time with the original hash, configuration, limits and criteria. The executor fills only the matching body and the `app/test/*.test.ts` tests; every needed import is already prepared. Use the empty lines reserved in the bodies and keep their count: `source` in the generated files depends on the position of the following decorators. If space is missing, return the item to the manager to prepare/recompile the skeleton; do not reformat the whole file. The factory includes the title rule and TaskCreated; completion includes the transition/repeat error and TaskCompleted; use-cases persist and publish; the operator gets only a test that runs its tools, for example with OperatorRuntime and FakeLlm.

```bash
# Copy the packet's real hash; keep it when resuming:
bun run agentic verify --item entity:Task --spec-hash <original-hash> --config agentic.config.ts --json
bun run agentic next --change 0001 --json
# Repeat packet → body/tests → verify for the next item of the first wave.
bun run agentic compile --check
bun run agentic verify 0001
```

Use `test(covers([...packet-ids], 'observed behaviour'), ...)` from `@agentic-ddd/testing`, including the automatic criteria handed over by the manager as `criterion:0001/<id>`. After the proposal is archived, the current packet may omit those criteria; the manager must hand them over by reading the archive. Each item requires done dependencies, an implemented body, the original hash, passing obligations and a real typecheck. After the five items, verify 0001 must return done. Body/tests keep the hash, lock and skills when the declarations' coordinates are kept; a rule/decorator change fails the old hash and requires going back to the manager.

Failures and resuming: a pending body fails I2; a relation or field that violates T1/T2/T3 (only in an `entity:`/`valueobject:` item of a project with tactical elements) fails T; missing/failing tests fail I4; a pending dependency fails I1; a changed contract fails I3; typecheck fails I5. A JUnit import/collection error can end the command without a gate report: record stderr and return the finding. Keep the original packet/hash. After two corrections without progress, return the item to the manager. Static never certifies done. The manager reviews the diff, repeats the individual verify and recomputes next; needs-human is only manual acceptance of the change.

For a real smoke test, create a fresh copy for each environment, initialize Git and capture a baseline after compile. Hand over the full packet and the executor instructions in the main session or in the native adapter. Keep the version, effective model (session metadata), original hash, diff and an independent verify report. If authentication/tooling is missing, record it as pending; do not replace the smoke test with simulated answers. Claude is validated statically in this delivery.

## Matriculas tutorial

`bun run skills:example --root <non-existent-destination> --tutorial matriculas` generates the tactical workspace, with 7 items: the entities `Aluno`, `Turma` and `Matricula`; the value objects `AlunoId` and `TurmaId`; the use-case `matricular_aluno` (with ports); and the adapter `InMemoryMatriculaRepository`. The commands are the same as for `tasks`. The "class has a free seat" rule has a known race: two simultaneous enrolments can both pass, and real locking is up to each domain (ADR-0006). The tutorial's business text stays in Portuguese, as its author wrote it.
