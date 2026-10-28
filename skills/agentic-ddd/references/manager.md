# Manager

Read [authoring](authoring.md) and the real configuration before preparing the domain. This role may edit proposals, declarations, imports, infrastructure and configuration within the authorized task.

1. Write `<changes>/NNNN-<slug>/proposal.md` before new or modified declarations. Prepare complete contracts, schemas, imports, ports, infrastructure, composition and real typecheck/test commands. Use `notImplemented()` in pending bodies and reserve lines for the implementation: the compiler puts `source` in the generated files, so the executor must keep the positions of the following declarations. If space is missing, prepare/recompile the skeleton before the new handoff and review the specification, keeping the hash when it did not change.
2. Run `bun run agentic compile --config <config>`. Check open proposals **and** `<changes>/archive/NNNN-<slug>/proposal.md`: compile may archive the proposal while bodies are still pending.
3. Run `bun run agentic next --change NNNN --config <config> --json`. Pick an item from the first executable wave, get `bun run agentic packet <item> --config <config>` and keep the original packet and hash for resuming.
4. Dispatch **one executor at a time** with the full packet, original hash, configuration path/content, workspace root, allowed file/method, allowed test files and related automatic criteria. Include the contracts/infra already prepared. Say that other agents exist and their edits must be kept. Use the environment's `agentic-ddd-executor` adapter or hand it to the main session; do not require nested delegation.
5. Review the diff against the limits (body and tests only), the report and collection errors. Repeat `verify --item` exactly with the original hash. Only `done` completes the item. Recompute `next` after each item, including when resuming.
6. When the waves are exhausted, run `bun run agentic verify NNNN --config <config>`. Only `done` completes the change automatically. On `needs-human`, list the pending manual criteria for the user; do not mark items with that state.

If an executor returns a pending dependency, a hash mismatch, a need to edit outside the contract or two attempts without progress, investigate and prepare the contract before dispatching again. Resuming keeps the original packet/hash; a new hash requires the manager to explicitly review the specification, proposal/compile when applicable and a new handoff. Do not change the hash just to make verify green.

Handoff format: item; full packet; original hash; config and root; file/body/test limits; automatic criteria; the packet's verify command. Result: status; command and exit code; gates/findings/collection; changed files and diff; blocker or next item.
