# Orchestration by layer and model

A sequential driver that spreads the graph's items across model tiers. It is an experiment tool, not the default: the #36 pilot showed that a single model (Sonnet medium) matches routing on acceptance at equal or lower cost, so the default is the `inherit` model with brief and gates (ADR-0003, experiment result). The driver's default mode executes nothing.

```
bun scripts/orchestrate.ts [--static] [--change NNNN] [--tier domain=sonnet] [--ladder sonnet,opus]
bun scripts/orchestrate.ts --real --max-invocations 20 [--max-tokens N] [--review]
```

- **Plan (default):** lists, per wave, each item's tier, model and brief size. Calls no model. `--static` avoids running the tests, but then no item counts as `done` and all of them enter the plan.
- **Routing:** `domain` starts on Haiku; `application`, `operators` and `infrastructure` (adapters) on Sonnet, with the infrastructure executor role. `--tier` and `--ladder` build the experiment's controls (for example, everything on Sonnet).
- **Brief:** rendered from the packet (`scripts/agent-briefs.ts`), without an LLM. On retry, the failure output goes into its own section, outside the `specHash`.
- **Acceptance:** items are accepted by the driver's gates, never by the executor's report: whole-worktree scope (only the item's source file and `*.test.ts` may change), imports per layer, only the assigned body in `method:` items, only the class (bodies and `#private` members, same lines, no signature change) in `valueobject:`/`adapter:` items, and `verify --item` with the packet hash (which includes gate T in `entity:`/`valueobject:` items of a project with tactical elements). The baseline is taken once per item, before the first attempt, and holds for the retries.
- **Escalation:** 1 retry on the same tier with the failure output; then the next tier up (the worktree goes back to the item's baseline); when the ladder is exhausted, `needs-human`. `blocked` moves up without a retry. Dependents of a `needs-human` item are skipped.
- **Review (`--review`):** one Opus pass in a clean context, after every item passes the gates; the diff it receives includes new files (tests created by the executor). The report is validated by `scripts/reviewer-report.ts`; `changes_requested` or an invalid answer never completes silently. There is no automatic re-run per finding (ADR-0003 D12 is still deferred).
- **Real run:** requires `--real`, `--max-invocations`, `ANTHROPIC_API_KEY` and the `claude` CLI. Each invocation uses `claude --bare` (no `CLAUDE.md`, hooks or user configuration), `--max-turns`, `--max-budget-usd` and `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1`; `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` is never passed through. `--max-tokens` uses measured tokens; unavailable usage with that ceiling active stops new runs.
- **Telemetry:** `.agentic-tasks/runs/<id>/telemetry.jsonl`, one line per attempt (tier, model, gate, decision, tokens, time), one per review and one for closing. Dollar cost is not computed.

## Review benchmark

Measures what the reviewer catches beyond the gates (ADR-0003 D12). The 19 planted regressions of the evals-19 cycle (`scripts/evals/review-defects.ts`) pass I1–I5 by construction, because the test was swapped for green shallow coverage; only the review detects them. Each item of the `tasks` workspace also gets a clean control, where the reviewer must approve (24 cases).

```
bun scripts/evals/review-benchmark.ts [--only defect:normalization,clean:entity:Task]
bun scripts/evals/review-benchmark.ts --real --max-invocations 48 [--cycles 2] [--arms clean,authored] [--model <id>]
```

- **Default:** builds the cases (one workspace per case, earlier items done) and shows the brief size. Calls no model.
- **Isolation:** the real reviewer runs with no tools (`--tools=`) in an empty directory, seeing only packet, diff and gates. `defect`, `kind` and `expected` stay in the case and never enter the brief; so the reference solution and the private oracles never reach the model.
- **Arms:** `clean` (packet, diff and gates) and `authored` (adds the executor's optimistic report, to measure authorship bias). The `authored` arm uses the reviewer core without the two sentences that forbid the report and the history; otherwise the only difference between the arms would contradict the instruction and measure disobedience. A reviewer from another model family joins as another arm when there is an adapter; today there is only Claude.
- **Metrics** (per cycle and aggregated; `null` when the denominator is zero): `recall` (defect flagged with the expected ID), `weakRecall` (accepts `I4`, the shallow test), `precision` (`changes_requested` reviews that flag the defect or `I4`), false greens (defect approved), clean controls flagged and spurious findings (outside the expected; in the clean control, all of them). `not_run` cases stay out of the denominators and are counted apart.
- **Budget:** `--real` requires `--max-invocations` (an integer: the ceiling on paid calls); `--max-tokens` uses measured tokens and unavailable usage stops the run. Results in `<work>/results/<id>/{scores.jsonl,summary.json}`.
