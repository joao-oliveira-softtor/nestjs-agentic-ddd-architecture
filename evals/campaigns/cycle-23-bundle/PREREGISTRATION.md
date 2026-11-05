# Pre-registration: bundle measurement (#122, ADR-0007 D14)

Version: 0.2.0 (draft for owner sign-off)
Date: 2026-11-04
Status: PROPOSED. Pending owner sign-off on the thresholds and the budget.

This file is versioned **before any real run**. The campaign produces a **measurement**; the decision is the owner's. The offline rehearsal (scripted adapter, zero inference cost) is the only run allowed in Phase 3. Its code is `test/evals-bundle-rehearsal.test.ts` and `scripts/evals/bundle-rehearsal.ts`; the manifests come in a later wave. This file mirrors the structure of `evals/campaigns/cycle-21-pilot/PREREGISTRATION.md` and `evals/campaigns/cycle-22-control/PREREGISTRATION.md`.

Change log:
- 0.2.0 (2026-11-04): the offline rehearsal exists; the Offline rehearsal section says what it covers and what is still to come. Thresholds, arms, budget and campaign id are unchanged.
- 0.1.1 (2026-11-03): cite the A0 cost source exactly (`aggregate.json`, not `aggregate.md`) and fix T2 to ≤ US$ 0.0488 (50% of 0.0976).
- 0.1 (2026-11-03): first draft. Arms, items, metrics, proposed thresholds, stopping rules.

## Question

Can a low-cost model (Haiku) work from the compiled bundle alone (D10) and reach the same acceptance as the cycle-21 A0 baseline (Sonnet medium), at lower cost per accepted item? A third arm checks whether the neutral layer alone, in another language (Python), is enough.

## Arms

All arms: `benchmark: tasks` (the cycle-21 item set, see Items), `maxCorrectionsPerItem: 1`, `skillDatasets: []`, `authentication: oauth-token`, `repetitions: 2` (r1 and r2), `concurrency: 1`, `sourceRef` set at authorization (drafted against `origin/main` f00dda1).

| Arm | Configuration | Input given to the model | Model | Effort |
|---|---|---|---|---|
| B0 | `b0-haiku-bundle` | **Only** the compiled bundle, `nestjs-ts` target (BUNDLE.md, neutral layer, nestjs-ts target section). No repository, no skills, no packet. | `claude-haiku-5-5` | none (CLI default, as the A3 Haiku rung) |
| A0 | `a0-sonnet-medium` (baseline, not re-run) | cycle-21 A0 numbers, `promptMode: brief`, same as the pilot | `claude-sonnet-5-5` | `medium` |
| P0 | `p0-haiku-python-neutral` | **Only** the neutral layer (no TypeScript, no `nestjs-ts` target). Implements in Python against the tests this pre-registration writes from the acceptance examples. | `claude-haiku-5-5` | none |

- The A0 arm is the baseline already measured in cycle-21 (`docs/superpowers/validation/2026-10-22-cycle-21/RESULTADO.md`). It is **not** run again. Its numbers are the reference for every threshold below.
- Comprehension (Part a of D14): arm B0 also answers the comprehension questions of issue #18 (`evals/skills/orders.extended.yaml`, 20 cases), answered from the bundle only, scored offline as in #18. Scoring is strict and offline; no model judges another model's answer.

## Items

The same five items as the cycle-21 `tasks` benchmark, so B0 and P0 are compared to A0 item by item:

1. `entity:Task`
2. `method:Task.complete`
3. `usecase:create_task`
4. `usecase:complete_task`
5. `operator:task-operator`

Source of the cycle-21 item list: `docs/superpowers/validation/2026-10-22-cycle-21/real/aggregate/aggregate.json` (per-run `attempts`).

## Sample size and runs

- 5 items × 2 repetitions = **10 item-runs per arm**, the same size as A0. Two repetitions give N = 10 per arm. This is small: the rule only recommends, and no statistical test is run.
- Invocation cap: **10 per arm** for B0 and P0, counted as the cycle-21 pilot counts A0 (`Tetos e ordem`). Corrections count against the cap. The rehearsal wave must confirm this counting before any real run.
- Comprehension questions (B0 only): the number of questions asked in the real run is fixed by the owner at authorization; the offline rehearsal uses the scripted adapter.
- **Total**: 20 implementation invocations plus the comprehension calls. Each real run needs a new budget authorization.
- Timeouts: `implementationTimeoutMs` 600000 (10 min), `skillTimeoutMs` 120000, `totalTimeoutMs` = cap × 10 min + 60 min slack.
- Order: r1 of B0 and P0, then r2 in the same order. Sequential execution.

## Metrics

Pairing: per item and per repetition, B0 and P0 are compared with A0 on the same item and repetition (as `controlMetrics` in `scripts/evals/aggregate.ts`).

**Primary** (as in the cycle-21 aggregate, `aggregate.md` table and `RESULTADO.md`):
1. **Final acceptance**: items accepted after corrections (`configurations[].final`, `aggregate.json`). A0: 10 of 10.
2. **Cost per accepted item**: derived cost (`evals/pricing.json`, labelled `derived`) summed over the 2 repetitions, divided by final acceptance. A0: US$ 0.0976 (`aggregate.json`, `configurations[configuration="a0-sonnet-medium"].cost.perAcceptedItem.withoutReview.cheap` = 0.09764292; `total.cheap` = 0.9764292 over 10 accepted items). `aggregate.md` marks the A0 cost as unavailable (`incomplete_or_incompatible_costs`); the per-accepted figure comes from `aggregate.json`'s cost block, and the owner must confirm at sign-off that this figure is an acceptable baseline (otherwise T2 is descriptive only). Unavailable cost is never estimated; it makes the run inconclusive.

**Secondary** (descriptive, as in `aggregate.json`):
3. Initial acceptance (first attempt, `configurations[].initial`). A0: 9 of 10.
4. Corrections (`corrections`). A0: 1.
5. Certified runs (`certifiedRuns`, `done` from `agentic verify`). A0: 2 of 2.
6. Timeouts (`timeouts`). A0: 0.
7. Tokens: input, cached input, output (`evidence_usage_sum`). A0: input 1,286,639; cached input 1,136,292; output 26,174.
8. Comprehension accuracy for B0 (correct answers over the questions asked; no cycle-21 baseline exists).

Protocol and behavior failures, and infrastructure failures, are reported per arm as in `aggregate.md` (`Falhas ...` lines).

## Proposed thresholds

Status: PROPOSED — pending owner sign-off; no real run may start before the owner fixes these values.

Derived from the cycle-21 A0 numbers above. Each threshold is a proposal with its baseline in brackets.

| # | Metric (arm B0 unless noted) | Proposed threshold | Baseline (cycle-21 A0) |
|---|---|---|---|
| T1 | Final acceptance, out of 10 | ≥ 9 | 10 |
| T2 | Cost per accepted item | ≤ US$ 0.0488 (50% of A0) | US$ 0.0976 |
| T3 | Initial acceptance, out of 10 | ≥ 8 | 9 |
| T4 | Corrections | ≤ 2 | 1 |
| T5 | Certified runs, out of 2 | = 2 | 2 |
| T6 | Timeouts, out of 10 item-runs | ≤ 1 | 0 |
| T7 | Comprehension accuracy (#18 questions, B0) | ≥ 80% | none; proposed without baseline, owner to validate |
| T8 | P0 final acceptance, out of 10 (descriptive vs A0 and B0; not a gate) | ≥ 8 | none; proposed without baseline |

Rationale: T1 allows one item below A0 with N = 10. T2 asks Haiku to cost at most half of A0 per accepted item, which is the saving that makes the bundle worth shipping. T3 to T6 keep the quality signal close to A0. T7 and T8 have no baseline and are proposals only.

Reading rule (mirrors the cycle-21 I/S/P/M shape, simplified):

1. **Inconclusive**: any run `infra_error`, a run not `completed` (budget exhausted, timeout, cancellation), a slot `not_run` or missing, or unavailable cost. Recommendation: no change; the owner decides whether to authorize a re-run.
2. **Recommend the bundle for Haiku** (a recommendation only): T1, T2, T4 and T5 all met. A next pre-registration and budget would then be proposed.
3. **No change** otherwise: the owner chooses between a further measurement and closing #122.

T7 and T8 are reported but do not enter rule 2. No result of this campaign changes the default model or the bundle by itself.

## Stopping rules

- Each arm stops at its invocation cap. No extra retries beyond `maxCorrectionsPerItem: 1`.
- The campaign stops at the first `infra_error` and is marked inconclusive. A re-run needs a new, separate authorization, decided without looking at the other arms (as in the cycle-21 refazimento policy).
- The campaign stops at budget exhaustion or an authentication mismatch. Every invocation checks `apiKeySource`; API key variables are removed from `env` in oauth mode.
- The request for authorization carries the arm and the reason only, never the results of other arms.

## Analysis method

- Aggregation with `bun run evals:aggregate --campaign <index.json> --out <new directory>`, as in cycle-21 and cycle-22.
- Pairing per item and repetition against A0. Values per item and per repetition are published with the aggregate.
- No statistical test. Medians and p90 are descriptive only.
- Cost is the derived cost from `evals/pricing.json`, summed over 2 repetitions. The TTL sensitivity rule of cycle-21 applies (`floor` field).
- Reports stay outside the repository until the results PR. Evidence goes to a tar archive with its SHA-256, as in cycle-21.

## Offline rehearsal (Phase 3, zero inference cost)

- Scripted adapter only. The rehearsal is meant to run the whole pipeline end to end: arms, manifests, aggregation, the reading rule, and the check that this text matches the manifests (as `test/evals-control-rehearsal.test.ts` does). Only the first part exists in 0.2.0; see "Done" and "Still to come" below.
- The P0 tests (written from the acceptance examples) are created in the rehearsal wave, frozen, and their hashes recorded in this file before any real run.
- No real inference is allowed in Phase 3.

Done in 0.2.0 (`test/evals-bundle-rehearsal.test.ts`, in the evals suite, Linux with bubblewrap): the pipeline from `compileBundle` to `verify 0001` returning `done`, with the scripted adapter standing in for the executor on each item in wave order, and the per-run record (`bundleRunSchema` in `scripts/evals/bundle-rehearsal.ts`) carrying initial and final acceptance, corrections, certified runs and timeouts, as in the cycle-21 aggregate. Offline proof: the scripted adapter's executor process runs under bubblewrap with no network and an empty environment, and the test checks both with planted sentinels; the `agentic` children get an environment without variables named like credentials (a denylist, not a network restriction), and the harness's own git and tar helpers still inherit the test's environment. The executor is a fixed solution per item, written by the adapter's `before` callback in the test process from the item, not from the packet: the rehearsal shows the pipeline works with a correct executor, not that a packet is enough for a model. The per-run record counts like the cycle-21 aggregate: rates over the planned items, and a run is certified only with every planned item accepted, `verify NNNN` `done` and the origin unchanged.

Still to come before any real run, none of it covered by 0.2.0: the manifests and arms above, aggregation and the reading rule, the B0 comprehension questions, the P0 tests and their hashes, token usage and cost in the record, the same configuration across stages, and an `unscored` outcome when a judge fails.

## Deviations (declared)

- Haiku arms run without `--effort`, as the Haiku rung of cycle-21 A3 did. A0 is Sonnet medium. The model and effort differ by design; that is the comparison.
- B0 and P0 use the same Haiku model. They differ only in the input (bundle with nestjs-ts target vs neutral layer, Python). This keeps the Python arm from measuring the model.
- The P0 tests are the pre-registration's own, so P0 is judged against tests written by the same people as the rehearsal. The tests are frozen before any run.

## Real execution

Requires two separate, explicit authorizations from the owner:
1. The thresholds in this file (sign-off on the Proposed thresholds).
2. A **separately authorized budget** for real inference: **amount TBD by owner**. The budget covers the 20 implementation invocations, the comprehension calls and any authorized re-run.

Before the first slot: write the manifests, and a test that checks this text against them as `test/evals-control-rehearsal.test.ts` does for cycle-22 (neither exists in 0.2.0), then set `sourceRef` in the manifests and in this text to the merge SHA. Credential: `claude setup-token`, run by the owner, exported as `CLAUDE_CODE_OAUTH_TOKEN` only in the run's shell session, never in a file.
