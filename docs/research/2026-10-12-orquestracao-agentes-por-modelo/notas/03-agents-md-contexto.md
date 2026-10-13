# AGENTS.md / context files and per-task context engineering for coding agents (research as of 2026-10-12)

## Q1. What does the AGENTS.md standard specify, and how do Claude Code, Cursor, Codex, Copilot, Gemini CLI and Kiro handle nested / scoped / on-demand instructions?

### Takeaway
AGENTS.md is deliberately minimal (plain Markdown, no required fields, nearest file wins), and every major tool now reads it. The real differences are in loading behaviour. Always-loaded root files cost tokens every turn. Claude Code, Gemini CLI, Cursor and Copilot offer on-demand or glob-scoped loading. Codex concatenates root-to-cwd up to a 32 KiB cap. A task-scoped design should therefore use thin root files, nested per-directory files, and glob/description-triggered rules.

### Cited Findings
**AGENTS.md open standard**
- Format is plain Markdown at repo root with no required fields or headings. It is described as "a README for agents", holding build steps, test commands and conventions that would clutter a human README. — [agents.md](https://agents.md)
- Nested AGENTS.md: agents read the nearest file in the directory tree and the closest one wins. Explicit user chat prompts override everything. The site cites the main OpenAI repo as having 88 AGENTS.md files. — [agents.md](https://agents.md)
- Suggested (not mandatory) sections: project overview, build/test commands, code style, testing instructions, security considerations, PR guidelines, deployment. Agents will attempt any listed test/check commands and try to fix failures. — [agents.md](https://agents.md)
- Listed as supported: Codex, Jules, Aider, goose, opencode, Zed, Warp, VS Code, Devin, Junie, Amp, Cursor, RooCode, Gemini CLI, Copilot coding agent, Windsurf, Augment. Aider needs `read: AGENTS.md` in `.aider.conf.yml`. Gemini CLI needs `context.fileName` set. — [agents.md](https://agents.md)

**Claude Code**
- Loads CLAUDE.md files in the hierarchy above the working directory at launch. CLAUDE.md files in subdirectories load on demand, once Claude reads/writes/edits a file in that subdirectory. — [Claude Code memory docs](https://code.claude.com/docs/en/memory)
- Official size target: under 200 lines per CLAUDE.md. "Longer files consume more context and reduce adherence." Content relevant only to part of the codebase should go in path-scoped rules (`.claude/rules/*.md` with a `paths` frontmatter field), which load only when Claude works with matching files. — [Claude Code memory docs](https://code.claude.com/docs/en/memory)
- `@path` imports (max 4 hops) are expanded at launch, so they organise a file but "don't reduce its context cost". — [Claude Code memory docs](https://code.claude.com/docs/en/memory)
- AGENTS.md: Claude Code (v2.1.277+) reads AGENTS.md directly only when no CLAUDE.md/CLAUDE.local.md exists in or above the working directory. If both exist, only CLAUDE.md is read unless the setting `claude-md-and-agents-md` is chosen. The documented bridge is a CLAUDE.md containing `@AGENTS.md` (or a symlink). A subdirectory AGENTS.md loads lazily when Claude reads a file there. — [Claude Code memory docs](https://code.claude.com/docs/en/memory)
- Instructions are "context, not enforced configuration". To guarantee behaviour use hooks (PreToolUse etc.). — [Claude Code memory docs](https://code.claude.com/docs/en/memory); [Best practices](https://code.claude.com/docs/en/best-practices)
- Auto memory: first 200 lines or 25 KB of MEMORY.md loaded each session. — [Claude Code memory docs](https://code.claude.com/docs/en/memory)

**Cursor**
- Four rule modes in `.cursor/rules/*.mdc`: Always Apply (`alwaysApply: true`), Apply Intelligently (description only; agent decides), Apply to Specific Files (`globs`), Apply Manually (@-mention). Plain `.md` in rules is ignored. — [Cursor rules](https://cursor.com/docs/context/rules)
- Nested AGENTS.md supported; nested files combine with parents, more specific wins. Guidance: keep rules under 500 lines, split into composable rules, reference files rather than copying content. — [Cursor rules](https://cursor.com/docs/context/rules)

**OpenAI Codex**
- At run start builds a chain: one global file from `~/.codex` (`AGENTS.override.md` first, then `AGENTS.md`), then from project root down to cwd, at most one file per directory (`AGENTS.override.md` > `AGENTS.md` > fallback names). Files are concatenated root-first, so closer files come later and override. Stops adding files once combined size hits `project_doc_max_bytes` (default 32 KiB). The chain is rebuilt each run. — [Codex AGENTS.md guide](https://learn.chatgpt.com/docs/agent-configuration/agents-md)

**GitHub Copilot**
- `.github/copilot-instructions.md` (repo-wide) plus `.github/instructions/*.instructions.md` with `applyTo` globs. When both match, both are used. Path-specific files are currently supported only for cloud agent and code review on GitHub.com. `excludeAgent` can hide a file from "code-review" or "cloud-agent". AGENTS.md anywhere in the repo is supported (nearest wins), and single CLAUDE.md/GEMINI.md at root also work. The page states no size limit. — [GitHub Docs](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions)

**Gemini CLI**
- Three layers concatenated and sent with every prompt: global `~/.gemini/GEMINI.md`, workspace files (workspace dirs and parents), and just-in-time files discovered when a tool touches a file/directory (scans that location and ancestors up to the trusted root). Supports `@file.md` imports; `context.fileName` can list `AGENTS.md`. `/memory show` and `/memory reload` exist. The page notes Gemini CLI was replaced by Antigravity CLI for unpaid-tier/Google One users on 2026-06-18. — [Gemini CLI docs](https://geminicli.com/docs/cli/gemini-md/)

**Kiro**
- Steering files (default `product.md`, `tech.md`, `structure.md`) with inclusion modes `always` (default), `fileMatch`, `manual`, `auto` (matches a `description`). Only CLI V3 supports all four modes; V1/V2 auto-load only `always`. AGENTS.md is also read, always loaded, with no inclusion modes, and can sit in subdirectories. Advice: one domain per file, explain why not just what, include examples, review steering like code. — [Kiro steering](https://kiro.dev/docs/steering/)

### Inferences
- Portable lowest common denominator across all six tools: root AGENTS.md (short) plus nested per-directory AGENTS.md. This is the only mechanism that works the same in Claude Code (lazy), Cursor, Codex (concatenate), Copilot, Gemini and Kiro (always-loaded).
- Glob/description scoping is tool-specific (`.claude/rules` `paths`, Cursor `.mdc` globs, Copilot `applyTo`, Kiro `fileMatch`), so a generator targeting several tools needs one source of truth and per-tool adapters. This is similar to what this repo does with `skills:install` adapters.
- Codex's 32 KiB cap and Claude's "200 lines" target are consistent budgets for always-loaded content. Task-specific content should not live there at all.
- Claude Code's AGENTS.md-vs-CLAUDE.md precedence has changed across versions (v2.1.277, 281, 285 notes). Pin a tested behaviour: the repo's CLAUDE.md containing only `@AGENTS.md` is the documented safe bridge.

### Gaps
- Copilot size limits for repo instructions: the docs page fetched states none. I could not confirm a 4000-character limit for code review, so it is not reported.
- Not verified: exact `paths` glob syntax examples in Claude Code rules (the page confirms `paths` frontmatter exists; example snippets were not read). Cursor behaviour for nested AGENTS.md loading timing (eager vs lazy) was not specified.

---

## Q2. What empirical evidence exists on whether context files help or hurt agents (numbers, conflicts)?

### Takeaway
Evidence is mixed and strongly depends on content and measure. The most rigorous study (ETH Zurich, ICLR 2026) finds LLM-generated context files slightly reduce success (about -0.5 to -3 pp) and raise cost about 20%, while human-written files give about +4 pp on AGENTbench but still raise cost up to 19%. A separate study finds AGENTS.md lowers median runtime 28.6% with comparable completion. Vercel's eval shows a compressed always-on docs index (100%) beating on-demand skills (53% to 79%). Long-context research (context rot, lost-in-the-middle, IFScale) supports keeping always-on context minimal.

### Cited Findings
**Context-file effectiveness studies**
- Gloaguen et al. (ETH Zurich / LogicStar.ai), "Evaluating AGENTS.md" (arXiv 2602.11988, ICLR 2026): AGENTbench has 138 Python tasks from 12 niche repos that all have developer-written context files, plus SWE-bench Lite (300 tasks, 11 repos, none with context files). Agents/models: Claude Code with Sonnet-4.5, Codex with GPT-5.2 and GPT-5.1 mini, Qwen Code with Qwen3-30B. — [arXiv HTML](https://arxiv.org/html/2602.11988v1); [arXiv PDF](https://arxiv.org/pdf/2602.11988)
- Resolution rate: LLM-generated files -0.5% on SWE-bench Lite and -2% on AGENTbench (average). Developer-written files +4% on AGENTbench, improving all agents except Claude Code. An ablation with GPT-5.2-generated files: +2% on SWE-bench Lite but -3% on AGENTbench. — [arXiv HTML](https://arxiv.org/html/2602.11988v1)
- Cost/steps (Table 2, examples): Sonnet-4.5 on AGENTbench steps 40.7 → 46.5 (LLM) / 45.3 (human), cost $1.15 → $1.33 / $1.30. GPT-5.2 on AGENTbench cost $0.38 → $0.57 / $0.54. LLM-generated files add about 2.45 steps (SWE-bench Lite) and 3.92 (AGENTbench), about +20% / +23% cost. Human files add about 3.34 steps and up to +19% cost. — [arXiv HTML](https://arxiv.org/html/2602.11988v1)
- Reasoning tokens rose: LLM-generated +22% (GPT-5.2) and +14% (GPT-5.1 mini) on SWE-bench Lite; +14% / +10% on AGENTbench. — [arXiv HTML](https://arxiv.org/html/2602.11988v1)
- Agents obey the files: `uv` used 1.6 times per instance when mentioned versus under 0.01 when not. Repo-specific tools 2.5 vs under 0.05. More testing, grep, reads and writes occur with context files. Files did not reduce steps before agents first touched a file in the golden patch. — [arXiv HTML](https://arxiv.org/html/2602.11988v1)
- Overviews: 8 of 12 developer files include a codebase overview. LLM-generated files contain overviews in 100% (Sonnet-4.5), 99% (GPT-5.2), 95% (Qwen3-30B), 36% (GPT-5.1 mini) of cases. — [arXiv HTML](https://arxiv.org/html/2602.11988v1)
- Redundancy ablation: when all other docs (.md files, example code, docs/) were removed, LLM-generated files improved performance by 2.7% on average and beat developer files, which suggests they mostly duplicate existing docs. Claude Code excluded for cost. — [arXiv HTML](https://arxiv.org/html/2602.11988v1)
- Authors' recommendations: omit LLM-generated files for now; human-written files should contain only minimal requirements (e.g. specific tooling). Stronger models did not generate better context files, and the generation prompt (Codex vs Claude Code style) had no consistent effect. — [arXiv HTML](https://arxiv.org/html/2602.11988v1)
- Conflict in reporting: the InfoQ write-up says LLM-generated files cut success "by an average of 3%" and names "Claude 3.5 Sonnet" as an agent. The paper HTML text read here says -2% on AGENTbench and Sonnet-4.5. — [InfoQ](https://infoq.com/news/2026/03/agents-context-file-value-review/) vs [arXiv HTML](https://arxiv.org/html/2602.11988v1). Prefer the paper; the abstract also changed between versions (v1: "no improvement"; later: "tend to reduce success"). — [AI Weekly summary](https://aiweekly.co/node/5405)
- Lulla et al. (arXiv 2601.20404, Jan 2026, v2 Mar 2026): 10 repos, 124 PRs, with vs without AGENTS.md using Codex/Claude Code-style agents. 28.64% lower median wall-clock runtime and 16.58% fewer output tokens; task completion "comparable". — [arXiv abs](https://arxiv.org/abs/2601.20404). This conflicts in direction on cost/efficiency with Gloaguen et al. (which finds higher cost). The measured populations and metrics differ (PR-based tasks and runtime vs. unit-test resolution and dollar cost).
- Vercel eval (Next.js 16 APIs): baseline 53%; skill with default behaviour 53%; skill with explicit invocation instructions 79%; AGENTS.md compressed docs index (8 KB, compressed from about 40 KB) 100%. Skill was never invoked in 56% of cases by default. Wording mattered: "invoke the skill first" anchored on docs; "explore the project first, then invoke the skill" worked better. Authors credit passive context: no decision point, always available, no sequencing. This is a vendor blog on one framework, not peer reviewed. — [Vercel](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals)
- Practitioner report (podcast description, weak source): skill invocation hit rate around 10% even with a handful of skills. — [Forward Deployed ep.2 listing](https://podcastaddict.com/forward-deployed/episode/213871593)

**What people actually write**
- Chatlatanagulchai et al. "Agent READMEs" (arXiv 2511.12884): 922 Claude Code, 694 Codex and 687 Copilot context files across 1,925 repos. — [arXiv](https://arxiv.org/pdf/2511.12884). Earlier study of 253 CLAUDE.md files from 242 repos: shallow structure; build/run instructions, implementation details and architecture most common. — [arXiv 2509.14744](https://arxiv.org/html/2509.14744v1)

**Long-context / instruction-density research**
- Context rot (Chroma, July 2025, 18 LLMs incl. GPT-4.1, Claude 4, Gemini 2.5, Qwen3): performance "grows increasingly unreliable as input length grows" even on simple tasks. Lower needle-question similarity hurts faster; distractors compound (1 distractor lowers accuracy, 4 lower further; GPT models hallucinate more, Claude models abstain more); on LongMemEval focused ~300-token prompts beat full ~113k-token prompts, with the largest gap for Claude models (mostly abstentions). Shuffled haystacks beat coherent ones across models. — [Chroma](https://www.trychroma.com/research/context-rot)
- Lost in the Middle (Liu et al. 2023): performance highest when relevant info is at the beginning or end of input and "degrades significantly" when in the middle, even for long-context models. — [arXiv 2307.03172](https://arxiv.org/abs/2307.03172)
- IFScale (Distyl AI, NeurIPS 2025): 500 keyword-inclusion instructions; best frontier models reach only 68% accuracy at max density; three degradation patterns; bias toward earlier instructions. — [arXiv 2507.11538](https://arxiv.org/abs/2507.11538); [NeurIPS page](https://neurips.cc/virtual/2025/122417). Counter-evidence: a follow-up found no consistent relation between instruction position and following rate for a 10-instruction list, i.e. lost-in-the-middle does not straightforwardly explain density decline. — [arXiv 2510.14842](https://arxiv.org/pdf/2510.14842)
- Anthropic: "Claude's context window fills up fast, and performance degrades as it fills"; "Bloated CLAUDE.md files cause Claude to ignore your actual instructions"; for each line ask "Would removing this cause Claude to make mistakes?" — [Claude Code best practices](https://code.claude.com/docs/en/best-practices)
- Drew Breunig's context failure modes, as cited by LangChain: poisoning, distraction, confusion, clash. — [LangChain blog](https://www.langchain.com/blog/context-engineering-for-agents). Claude Code docs warn that contradictory instructions across CLAUDE.md/rules make Claude "pick one arbitrarily". — [Claude Code memory docs](https://code.claude.com/docs/en/memory)

### Inferences
- Reconciling the conflict: files that restate what the repo/docs already say (overviews, directory trees, LLM-generated summaries) add cost with no localisation benefit. Files that carry non-inferable specifics (tool choice such as `uv`, custom commands, constraints) change behaviour and help modestly. Vercel's win came from a dense index of non-inferable, post-training-cutoff API facts, which fits the same rule.
- Obedience cuts both ways: because agents follow instructions literally (extra tests, extra exploration), every always-on instruction taxes every task. This argues for per-task scoping of test/verification instructions so only relevant ones are loaded.
- Passive (always-loaded) vs on-demand is a real tradeoff: Vercel shows on-demand skills fail when the agent doesn't trigger them (56% never invoked), while ETH/Chroma show always-on bloat hurts. Resolution: keep always-on content tiny and high-signal, make the lazy-load pointer explicit and unconditional ("before editing X, read Y"), or have the orchestrator inject the task packet so no trigger decision is needed.
- Evidence on the models: Sonnet-4.5, GPT-5.x and Qwen3-30B were all tested by the ETH paper; no result showed that larger models benefit more from context files. Not a clean small-vs-large comparison.

### Gaps
- Per-agent resolution-rate numbers (paper Figure 3) were not extractable from the text; only averages are reported.
- No study found that evaluates task-scoped (per-task) generated instruction files head-to-head against repo-level files. This is the key empirical gap for the user's design.
- Agent READMEs content-category percentages and Galster et al. (2602.14690, 2,853 repos) were not verified from primary text.
- No peer-reviewed replication of Vercel's skills-vs-AGENTS.md result; single framework, single vendor.

---

## Q3. Context engineering guidance: what goes in a minimal task-scoped file vs referenced lazily?

### Takeaway
Primary sources converge on: smallest set of high-signal tokens, include only what the model cannot infer, load detail just-in-time via lightweight references, use skills/progressive disclosure for occasional knowledge, isolate noisy exploration in sub-agents that return condensed summaries, and prefer deterministic hooks/tests to prose for must-never-fail rules. A counter-view (Cognition) warns that sub-agents lose decisions unless they get full traces or compact summaries.

### Cited Findings
- Anthropic: context is a finite resource with an "attention budget"; "Every new token introduced depletes this budget". Goal is "the smallest possible set of high-signal tokens". Start minimal, add instructions from observed failures. — [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- Anthropic: just-in-time retrieval (keep lightweight references such as paths/queries, load at runtime); hybrid often best; progressive disclosure; compaction (maximise recall first, then precision; clearing old tool results is the lightest form); structured note-taking outside context; sub-agents in clean windows that return "only a condensed, distilled summary". — [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- Claude Code include/exclude table: include commands Claude can't guess, style rules differing from defaults, test runners, repo etiquette, project-specific architectural decisions, env quirks, non-obvious gotchas. Exclude anything derivable from code, standard conventions, detailed API docs (link instead), frequently changing info, long tutorials, file-by-file codebase descriptions, self-evident advice. "For domain knowledge or workflows that are only relevant sometimes, use skills." Emphasis ("IMPORTANT") only on one or two lines, else nothing stands out. — [Claude Code best practices](https://code.claude.com/docs/en/best-practices)
- Skills (progressive disclosure): only name+description preloaded; SKILL.md read when relevant; further files read only as needed. Keep SKILL.md body under 500 lines, references one level deep (nested references lead to partial `head -100` reads), add a table of contents to reference files over 100 lines, prefer scripts that are executed rather than read (only output consumes tokens), write descriptions in third person with what + when, build evaluations before writing docs and write "just enough content to address the gaps". — [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- Same doc: "set appropriate degrees of freedom" (low freedom/exact commands for fragile operations; high freedom for context-dependent ones); avoid offering many options, give a default with an escape hatch; use validate-fix-repeat loops and plan-validate-execute for risky batches. — [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- Manus: KV-cache hit rate is the key metric (cached tokens $0.30/MTok vs $3/MTok uncached on Claude Sonnet, about 10x; about 100:1 input:output ratio). Keep prompt prefix stable (no timestamps), append-only context, deterministic serialisation. Mask tools instead of removing them mid-task. Use the file system as restorable memory (drop page content, keep URL/path). Recite goals (todo.md) at the end of context; about 50 tool calls per task. Keep errors in context. Avoid few-shot ruts by adding controlled variation. — [Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)
- LangChain taxonomy: write / select / compress / isolate. Tool-selection via RAG over tool descriptions reported about 3x better selection accuracy (cited from papers). — [LangChain](https://www.langchain.com/blog/context-engineering-for-agents)
- Cognition ("Don't Build Multi-Agents"): principle "share full agent traces"; sub-agents given only a message produce inconsistent, conflicting work (Flappy Bird example); recommends summarisation at handoffs, with Cognition using a fine-tuned model for it. — [Cognition](https://cognition.ai/blog/dont-build-multi-agents) (details via search summary and [LangChain](https://www.langchain.com/blog/context-engineering-for-agents))
- Anthropic multi-agent research system: orchestrator-workers (Opus 4 lead, Sonnet 4 subagents) beat single Opus 4 by 90.2% on an internal research eval; agents use about 4x chat tokens, multi-agent about 15x; on BrowseComp three factors explain 95% of variance, token usage alone 80%. Rewriting flawed tool descriptions cut task time 40%. Effort-scaling rules embedded in prompts (1 agent/3-10 calls for simple facts; 2-4 subagents for comparisons; 10+ for complex). — [Anthropic](https://www.anthropic.com/engineering/multi-agent-research-system)
- Conflict: Cognition advises against multi-agent for coding because of context fragmentation; Anthropic reports large gains for breadth-first research. Anthropic's own sub-agent delegation lesson is consistent with Cognition's point: vague delegations led to duplicated work. Note the different task type (read-heavy parallel research vs. write-heavy coupled coding). — [Anthropic](https://www.anthropic.com/engineering/multi-agent-research-system) vs [Cognition](https://cognition.ai/blog/dont-build-multi-agents)
- Claude Code: use subagents for investigation so exploration stays out of the main context; fresh-context reviewer subagent sees "only the diff and the criteria you give it"; warns reviewers prompted to find gaps will over-report and cause over-engineering, so instruct them to flag only correctness/requirement gaps. After two failed corrections, `/clear` and restart with a better prompt. Customise compaction in CLAUDE.md (e.g. preserve modified-file list and test commands). — [Claude Code best practices](https://code.claude.com/docs/en/best-practices)

### Inferences
- Minimal always-loaded layer: build/test/typecheck commands, non-inferable constraints, pointers (paths) to lazy material, and rules that must hold in every task. Everything domain-specific, per-module, or per-task goes in nested AGENTS.md, path-scoped rules, skills, or a task packet.
- Lazy-referenced layer: API/contract details, long invariant catalogues, examples, generated schemas, historical decisions. Reference by stable ID/path plus a one-line "when to read".
- Deterministic enforcement beats prose for hard constraints (files allowed, forbidden imports): hooks, lint rules, `compile --check`-style CI gates. Prose is advisory per Anthropic.
- Stable-prefix discipline (Manus) implies generated per-task files should be appended after a static shared prefix (not interleaved) so caching works across tasks. This is an engineering inference; the Manus data come from a general agent, not a coding harness with provider-side cache controls.
- When using a manager/executor split, Cognition's critique implies the executor packet must include the decisions made upstream (not just the goal), or the executor should be able to read the manager's trace summary.

### Gaps
- No quantitative source comparing "inline in packet" vs "reference path" for coding-agent success. The tradeoff is argued qualitatively.
- Cognition's full post was only seen via search summary, not read in full.
- Anthropic "skills" engineering blog post and invocation-rate data were not retrieved; only docs and third-party reports.

---

## Q4. Patterns for generating per-task instruction files automatically; fields in a good task brief

### Takeaway
Spec-driven tools (spec-kit, OpenSpec, Kiro) share a pipeline: intent, requirements/acceptance scenarios, design/contracts, ordered tasks with parallel markers, execute, verify/archive. Anthropic's guidance states the highest-leverage brief ingredients: verification the agent can run, named files/interfaces, explicit out-of-scope, and an end-to-end check. No primary source gives a canonical "task packet schema"; the field list below is synthesised.

### Cited Findings
- Anthropic: "The most useful specs are self-contained: they name the files and interfaces involved, state what is out of scope, and end with an end-to-end verification step that proves the feature works." Start a fresh session to execute the spec for clean context. — [Claude Code best practices](https://code.claude.com/docs/en/best-practices)
- Anthropic: "Give Claude a way to verify its work" (tests, build exit code, linter, screenshot) is the top-ranked practice. Include example test cases in the prompt; address root causes, not symptoms. — [Claude Code best practices](https://code.claude.com/docs/en/best-practices)
- Anthropic subagent brief: objective, output format, guidance on tools/sources, clear task boundaries. Vague delegations led to misread tasks and duplicated searches. — [Anthropic multi-agent](https://www.anthropic.com/engineering/multi-agent-research-system)
- Spec Kit: constitution (`memory/constitution.md`, nine articles of project-wide principles) then `spec.md` (what/why, no tech stack) then `plan.md` plus `research.md`, `data-model.md`, `contracts/`, `quickstart.md` then `tasks.md`. Tasks derive from contracts, entities and scenarios; independent tasks marked `[P]`; ambiguities marked `[NEEDS CLARIFICATION: ...]` rather than guessed; checklist self-review; phase gates with a "Complexity Tracking" justification; test order contracts, then tests, then code; every feature must trace to a user story (anti-speculation). — [spec-kit spec-driven.md](https://github.com/github/spec-kit/blob/main/spec-driven.md)
- OpenSpec: per-change folder `openspec/changes/<name>/` with `proposal.md` (why/what), `specs/` (delta requirements, e.g. `## ADDED Requirements`, each `### Requirement:` with SHALL statement and `#### Scenario:` WHEN/THEN bullets), `design.md`, `tasks.md` (checklist). Archive moves the change to `changes/archive/<date>-<name>/` and updates live `openspec/specs/`. Philosophy: agree before you build; fluid not rigid; brownfield-friendly. — [OpenSpec](https://github.com/Fission-AI/OpenSpec) (only ADDED syntax confirmed on page; MODIFIED/REMOVED not verified here)
- Kiro: `requirements.md` (user stories + acceptance criteria; `bugfix.md` for bugs with current/expected/unchanged behaviour), `design.md` (architecture, sequence diagrams, data flow, error handling, testing strategy), `tasks.md` (discrete tasks with clear outcome and status; Kiro builds a dependency graph and runs independent tasks concurrently in waves). — [Kiro specs](https://kiro.dev/docs/specs/)
- Skill-level workflow patterns usable inside a packet: checklists to copy and tick; validate-then-execute loops; plan file validated by a script before applying. — [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- Claude Code: reference existing patterns ("HotDogWidget.php is a good example"), scope the task (which file, scenario, testing preference), describe symptom + likely location + what "fixed" looks like. — [Claude Code best practices](https://code.claude.com/docs/en/best-practices)
- Evaluation-first authoring: build at least three evaluations covering observed gaps and measure against a no-skill baseline before writing extensive docs. — [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)

### Inferences (synthesised brief schema; not from a single source)
Minimal task packet fields, in a stable order, each backed by the sources above:
1. Goal (one sentence, outcome not method) and item ID.
2. Contract: exact signatures/types/ports to implement or call (inline, since Gloaguen et al. show agents do not infer these cheaply and Anthropic recommends naming interfaces).
3. Invariants/rules: only the stable-ID rules this task touches, each with its text (OpenSpec "SHALL + WHEN/THEN" is a compact model). Reference the rest by ID.
4. Files: allowed to edit / read-only context / forbidden. Enforce deterministically with hooks or lint where possible.
5. Tests/acceptance: exact commands and which test IDs must cover which invariants; example cases.
6. Definition of done: the command whose pass/fail result closes the task (e.g. a verify command with a spec hash), plus required evidence.
7. Anti-goals/out of scope: explicit "do not" list (spec-kit anti-speculation, Anthropic "state what is out of scope").
8. Open questions: explicit `[NEEDS CLARIFICATION]` markers and the instruction to stop and ask instead of guessing.
9. Lazy pointers: paths for deeper material with a one-line "read when ...".
10. Output format for the executor's report (Anthropic subagent brief; keeps manager context small).
- The repo's existing flow (`agentic packet <item>`, `verify --item --spec-hash`, `compile`) already matches this pattern. The research suggests packets should be generated from decorated code and always re-derived (not hand-edited), consistent with spec-kit's "regenerate affected plans and tasks" claim.
- Generated files need a staleness guard (spec hash) because the ETH result shows redundant or outdated content is where LLM-generated files lose value.

### Gaps
- No empirical study found comparing brief formats (e.g. with vs without "files allowed" or anti-goals) on agent success. Field recommendations are practitioner guidance plus synthesis.
- Kiro's EARS notation could not be confirmed from the fetched page. Spec-kit task-field details (file paths, dependencies) not on the page read.
- Search did not surface "context pack" as an established term with a primary source.

---

## Q5. Prompt differences for small vs large models

### Takeaway
Direct evidence is thin. Anthropic's only explicit guidance is to test instructions across Haiku/Sonnet/Opus: smaller models need more guidance, larger ones risk over-explanation. One 2026 study shows step-by-step (CoT) prompting can hurt small instruct code models. Treat "small models need more scaffolding" as a hypothesis to evaluate per task, not a rule.

### Cited Findings
- Anthropic: "Claude Haiku: Does the Skill provide enough guidance? Sonnet: Is it clear and efficient? Opus: Does it avoid over-explaining? What works perfectly for Opus might need more detail for Haiku." If used across models, aim for instructions that work for all. — [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- Anthropic: degrees of freedom should match task fragility (exact commands for fragile steps; heuristics when many routes work). Examples convey style and detail "more clearly than descriptions alone"; provide a default instead of many options. — [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- ACL 2026 SRW, "Think Less, Code Better": on Qwen2.5-Coder, CoT effect at 1.5B base +13.4 pp but 1.5B instruct -15.2 pp (p<0.001); 7B instruct -0.6 pp; 14B instruct +2.4 pp; base-model CoT benefit grows with scale (+13.4 to +28.7 pp). Cause: CoT lengthens outputs and pushes many small-model generations into truncation. DeepSeek-Coder-1.3B was insensitive. Benchmarks: HumanEval, MBPP, LiveCodeBench (function-level, not agentic). — [ACL Anthology](https://aclanthology.org/2026.acl-srw.13/)
- OpenAI GPT-4.1 prompting guide (via search summary): inducing an explicit step-by-step plan raised SWE-bench pass rate by about 4% for a larger model. — [search summary only; see Scribd copy of cookbook](https://www.scribd.com/document/918973944/cookbook-openai-com-examples-gpt4-1-prompting-guide)
- ETH study includes small/cheap models (GPT-5.1 mini, Qwen3-30B) whose cost rose less in absolute terms but whose steps rose similarly (e.g. GPT-5.1 mini 40.6 to 46.9 steps). Context files raised steps for all tested models. — [arXiv HTML](https://arxiv.org/html/2602.11988v1)
- Chroma: Claude models abstain more under long-context distraction, GPT models hallucinate more, i.e. failure modes under bloat differ by model family. — [Chroma](https://www.trychroma.com/research/context-rot)
- Manus: repeated identical action patterns in context cause few-shot "ruts"; vary serialisation. Relevant when giving several examples to a weaker model. — [Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)

### Inferences
- Plausible differentiation for a manager/executor split (hypotheses, untested here): for a small executor, inline the contract and a worked example, give a single path (default plus escape hatch), keep the packet short with required output schema, and offload verification to scripts. For a large executor, give goal, constraints and verification command and let it explore; avoid prescribing steps.
- Because extra explicit steps can hurt small instruct models (CoT result at 1.5B) and verbose context raises cost for all models, "more explicit" should mean more precise contract/examples, not longer reasoning instructions.
- Run the same packet on both tiers with a baseline (Anthropic's evaluation-first advice) and keep per-tier variants only if the delta is measurable.

### Gaps
- No source found directly comparing context/brief verbosity effects between small and large models on agentic coding tasks (SWE-bench style). The CoT study is function-level code generation on 1.5B-14B models and may not transfer to agentic coding with frontier small models (Haiku-class).
- No data located on structured-output adherence for small models in coding agents.
- GPT-4.1 guide figure was seen only via a secondary/search summary.
