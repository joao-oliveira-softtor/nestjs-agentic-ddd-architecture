# Executor

For a `domain` item received as a brief, follow [executor-domain.md](executor-domain.md): it does without the module skill and keeps the executor free of other layers' context.

Receive the full packet, original hash, configuration, root, file/body limits and automatic criteria. Read the module's generated skill and the contracts referenced in the packet. If necessary information is missing, return the item to the manager with the missing data.

- Change only the assigned body and the allowed test files. Keep imports, signatures, decorators, schemas, IDs, proposals (open or archived), configuration, infrastructure (except in an `adapter:` item, which is the infrastructure itself) and generated files. Do not implement dependencies or other items. Keep other agents' edits in the workspace.
- The current compiler puts source coordinates in the generated files. Keep the body's line count so the following declarations do not shift; use the space prepared in the skeleton and keep the remaining empty lines. Do not reformat the whole file. If the space is not enough, return the item to the manager to prepare/recompile the skeleton before dispatching again. Body-only can keep the hash and still shift `source`: that fails `compile --check` and can make the runtime skill stale.
- Class item (`valueobject:`/`adapter:`): the scope is the item's class (bodies and `#private` members, same line count), without changing `extends`/`implements` or the public signature.
- A declarative operator is already implemented; add only tests that exercise its tools and contracts. Do not invent a body for it.
- Write `bun:test` tests with `covers([...ids], title)` from `@agentic-ddd/testing` for the packet's obligations and automatic criteria. Test positive behaviour and the relevant rules and invalid transitions. Implement the body keeping the specification.
- Keep identifiers, rule IDs and business text exactly as written; never translate them.
- Run the packet's **exact** `verify --item <item> --spec-hash <original-hash>` command (including `--config`). Never replace the hash. Record stdout/stderr, exit code, gates/findings and JUnit import/collection errors; missing collection does not mean success.
- Pending dependency, hash mismatch or a need for imports/declarations/infra/config outside the contract return the item to the manager. After two consecutive corrections without progress on the findings, end this run and return a diagnosis. Do not work around failures by removing rules or coverage.
- Only the result `done` completes the item. `needs-human` belongs to the change and is handled by the manager.

Return the item, original hash, command and exit code, status, changed files/diff and findings (including collection), with the blocker when there is one. Resume with the original packet/hash. A new hash requires the manager to review the specification. As executor, do not run compile to regenerate contracts.

## Tactical elements (v0.5)

- The port is a contract: the executor of an `adapter:` item implements it and never changes it.
- Gate T runs in `verify --item` for `entity:` and `valueobject:` items (details in [authoring.md](authoring.md), "Gate T"); it does not run on `adapter:`.
- Only in a `valueobject:` item may the executor change the type of a `#private` member it created. Anything that is a declaration (field, parameter property, `contains`/`references`, value object props, port) goes back to the manager: proposal and compile when the IR changes, a new packet when the specHash changes.
- An executor guided only by a brief learns T from the `verify` findings: each one carries the `fix`.
