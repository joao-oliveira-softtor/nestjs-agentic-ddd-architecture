# Claude Code / Agent SDK: subagents, per-subagent model selection, dynamic workflows, and context for multi-agent orchestration (as of 2026-10-12)

Source notes. All Claude Code docs pages below are LIVE documentation fetched on 2026-10-12 and carry no publication date; they cite Claude Code versions (v2.1.2xx) and the docs change frequently. Anthropic engineering posts have fixed dates (given per item). Two pages (sub-agents, skills) were truncated at ~100k characters when fetched, so a few late sections (fork details) are only partly covered. Anything not fetched directly is flagged "secondary" or listed under Gaps.

IMPORTANT CORRECTION to the premise in the brief: "subagents cannot spawn subagents" is OUTDATED. Current docs state that nesting is allowed by default up to 3 layers (details in Q5).

---

## 1. How Claude Code subagents work: `.claude/agents/*.md` frontmatter, model choice (alias / full id / inherit), context isolation, what returns to the parent

### Takeaway
A subagent is a Markdown file (YAML frontmatter + body = system prompt) or a JSON/SDK `AgentDefinition`; only `name` and `description` are required. `model` accepts `sonnet | opus | haiku | fable`, a full model ID, or `inherit`, and resolves through a 4-step precedence order. Each non-fork subagent starts in a fresh context window (own system prompt + the parent's delegation message + CLAUDE.md + git status + preloaded skills) and returns only its final message to the parent.

### Cited Findings

**File format, fields, locations**
- Subagents are Markdown files with YAML frontmatter; "Only `name` and `description` are required. Unrecognized fields are silently ignored." — [Claude Code: Create custom subagents](https://code.claude.com/docs/en/sub-agents)
- Frontmatter fields documented: `name` (unique id, max 256 chars, no `:`), `description` ("When Claude should delegate to this subagent"; combined descriptions above 15,000 tokens trigger a startup warning), `tools` (allowlist; inherits all if omitted), `disallowedTools` (denylist, applied before `tools`), `model`, `permissionMode` (`default`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions`, `plan`), `maxTurns` (output returned marked partial and resumable at the limit), `skills` (full content injected at startup), `mcpServers`, `hooks`, `memory` (`user|project|local`), `background`, `omitClaudeMd`, `effort` (`low|medium|high|xhigh|max`), `isolation: worktree`, `color`, `initialPrompt`, `experimental` — [sub-agents](https://code.claude.com/docs/en/sub-agents)
- Scope/priority (highest to lowest): managed settings; `--agents` CLI flag (session only, JSON; in non-interactive mode also accepts a JSON file path, v2.1.281+); `.claude/agents/` (project); `~/.claude/agents/` (user); plugin `agents/` directory. Directories scanned recursively; identity comes from `name`, not file path. — [sub-agents](https://code.claude.com/docs/en/sub-agents)
- Plugin subagents ignore `hooks`, `mcpServers` and `permissionMode`. — [sub-agents](https://code.claude.com/docs/en/sub-agents)
- Custom agents can be hot-loaded: Claude Code watches `~/.claude/agents/` and `.claude/agents/` and picks up new/edited files within seconds, but only for directories that existed at session start (a brand new `agents` directory needs a restart). — [Agent SDK: Subagents](https://code.claude.com/docs/en/agent-sdk/subagents)
- Best-practice tips from docs: "Design focused subagents: each subagent should excel at one specific task"; write descriptions that single out one subagent; "use proactively" in the description encourages automatic delegation; limit tool access; check project subagents into version control. — [sub-agents](https://code.claude.com/docs/en/sub-agents)
- Explicit invocation patterns: natural language, @-mention (`@"code-reviewer (agent)" ...`, guarantees that subagent runs, but Claude still writes the task prompt), or run the whole session as the subagent with `claude --agent <name>` (main thread takes that subagent's tool restrictions and model). — [sub-agents](https://code.claude.com/docs/en/sub-agents)
- Persistent per-subagent memory: `memory: user|project|local` gives the subagent a directory (`~/.claude/agent-memory/<name>/`, `.claude/agent-memory/<name>/`, `.claude/agent-memory-local/<name>/`); first 200 lines or 25KB of `MEMORY.md` go into its system prompt; `project` is the recommended default. — [sub-agents](https://code.claude.com/docs/en/sub-agents)

**Model selection**
- `model` options: alias `sonnet`, `opus`, `haiku`, `fable`; a full model ID such as `claude-opus-5-5` or `claude-sonnet-5` ("Accepts the same values as the `--model` flag"); or `inherit`. — [sub-agents, "Choose a model"](https://code.claude.com/docs/en/sub-agents)
- Resolution order: (1) per-invocation `model` parameter Claude passes on the Agent call, (2) definition's `model` frontmatter (`inherit` = main conversation's model), (3) `CLAUDE_CODE_SUBAGENT_MODEL` env var (alias or ID), (4) main conversation's model. Before v2.1.251 the env var ranked first and overrode frontmatter. — [sub-agents](https://code.claude.com/docs/en/sub-agents)
- To force one model on every subagent (v2.1.257+): set `CLAUDE_CODE_SUBAGENT_MODEL` plus `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` in settings `env`. — [sub-agents](https://code.claude.com/docs/en/sub-agents)
- Org allowlist (`availableModels`): a blocked family alias (e.g. `opus`) is substituted by the newest permitted version of that family (since v2.1.222); any other blocked value falls back to the inherited model; interactive sessions show a warning naming requested vs actual model. — [sub-agents](https://code.claude.com/docs/en/sub-agents)
- Built-in agents' models: Explore runs on the Opus model "in most setups" (Haiku possible via user/project override), Plan inherits, general-purpose inherits, claude-code-guide uses Haiku. NOTE: this differs from older docs where Explore was Haiku; re-check before relying on it. — [sub-agents](https://code.claude.com/docs/en/sub-agents)
- Docs example agents: `code-reviewer` uses `model: inherit`; `data-scientist` uses `model: sonnet`. Cost guidance: "Control costs by routing tasks to faster, lower-cost models like Haiku"; "For simple subagent tasks, specify `model: haiku` in your subagent configuration"; "Sonnet handles most coding tasks well and costs less than Opus. Reserve Opus for complex architectural decisions or multi-step reasoning." — [sub-agents](https://code.claude.com/docs/en/sub-agents); [Manage costs](https://code.claude.com/docs/en/costs)
- Agent SDK equivalent: `AgentDefinition { description (req), prompt (req), tools, disallowedTools, model, mcpServers, skills, initialPrompt, maxTurns, background, omitClaudeMd, memory, effort, permissionMode }`; `model` "Accepts an alias such as 'fable', 'opus', 'sonnet', 'haiku', 'inherit', or a full model ID". Programmatic agents take precedence over filesystem agents of the same name. `omitClaudeMd` requires TS SDK v0.3.271+ and is absent in the Python `AgentDefinition`. — [Agent SDK: Subagents](https://code.claude.com/docs/en/agent-sdk/subagents); [Agent SDK TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript)
- Docs show a "dynamic agent factory" pattern: a function builds an `AgentDefinition` at query time, e.g. `model = "opus" if strict else "sonnet"` ("use a more capable model for high-stakes reviews"). — [Agent SDK: Subagents](https://code.claude.com/docs/en/agent-sdk/subagents)
- Subagent invocation tool is `Agent` in `tool_use` blocks but `Task` in the `system:init` tools list (pre-v2.1.63 `Task` everywhere); detect both. Messages from inside a subagent carry `parent_tool_use_id`. — [Agent SDK: Subagents](https://code.claude.com/docs/en/agent-sdk/subagents)
- Subagents inherit the main session's extended-thinking configuration; `effort` can be set per subagent. — [Agent SDK: Subagents](https://code.claude.com/docs/en/agent-sdk/subagents); [sub-agents](https://code.claude.com/docs/en/sub-agents)

**Context isolation and what returns**
- "Each subagent runs in its own context window with a custom system prompt, specific tool access, and independent permissions." It "doesn't see your conversation history, the skills you've already invoked, or the files Claude has already read." — [sub-agents](https://code.claude.com/docs/en/sub-agents)
- A non-fork subagent's initial context: its system prompt (NOT the Claude Code system prompt; plus basic environment details like cwd), the delegation/task message Claude writes, CLAUDE.md files (Explore and Plan skip them), git status snapshot, full content of preloaded `skills`, and (if it has SendMessage) a sibling roster. `omitClaudeMd: true` skips user/project/local CLAUDE.md (managed policy files still load). — [sub-agents, "What loads at startup"](https://code.claude.com/docs/en/sub-agents); [Agent SDK: Subagents](https://code.claude.com/docs/en/agent-sdk/subagents)
- "The only content you pass from parent to subagent is the Agent tool's prompt string, so include any file paths, error messages, or decisions the subagent needs directly in that prompt." — [Agent SDK: Subagents](https://code.claude.com/docs/en/agent-sdk/subagents)
- Return path: "intermediate tool calls and results stay inside the subagent; only its final message returns to the parent." The parent may summarize it; to preserve verbatim output, say so in the prompt. — [Agent SDK: Subagents](https://code.claude.com/docs/en/agent-sdk/subagents)
- Since v2.1.210 Claude Code scans each subagent's final report for instruction-shaped patterns (neutralizes `<system-reminder>`-style tags, escapes `Human:`/`Assistant:` turn markers, prepends a `[harness: ...]` marker); it never removes or rewords text and "isn't a substitute for restricting what a subagent can reach". — [sub-agents](https://code.claude.com/docs/en/sub-agents)
- Fork: a "subagent that inherits the entire conversation so far instead of starting fresh" (same system prompt, tools, model, history); only its final result returns. Use when "any other subagent would need too much background"; fork mode is on by default in interactive sessions, off by default in the Agent SDK (enable with `CLAUDE_CODE_FORK_SUBAGENT=1`). — [sub-agents](https://code.claude.com/docs/en/sub-agents)
- Resume: each invocation creates a new instance; to continue use `SendMessage` with agentId/name; resumed subagents keep full history; transcripts at `~/.claude/projects/{project}/{sessionId}/subagents/agent-{agentId}.jsonl`, deleted after `cleanupPeriodDays` (30 default). Explore and Plan are one-shot (no agentId). In the SDK you must `resume: sessionId` and pass the same `agents` definitions. — [sub-agents](https://code.claude.com/docs/en/sub-agents); [Agent SDK: Subagents](https://code.claude.com/docs/en/agent-sdk/subagents)
- Background default: with fork mode on (interactive default) Claude Code always runs subagents in the background; Ctrl+B backgrounds a running task; `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` forces foreground. Background subagents get a smaller built-in tool set. — [sub-agents](https://code.claude.com/docs/en/sub-agents); [Agent SDK: Subagents](https://code.claude.com/docs/en/agent-sdk/subagents)
- When to use subagents vs main conversation (docs): use main conversation for back-and-forth, phases sharing significant context, quick targeted changes, latency-sensitive work ("A subagent that isn't a fork starts fresh and may need time to gather context"); use subagents when output is verbose, you need tool restrictions, or "the work is self-contained and can return a summary." — [sub-agents](https://code.claude.com/docs/en/sub-agents)

### Inferences
- For a framework that wants Haiku/Sonnet/Opus tiers each in a clean context, the cleanest primitives are: one `.claude/agents/<role>.md` per role with an explicit `model:` alias (alias keeps working across model releases; full ID pins) and a narrow `tools:` list; or SDK `agents={...}` built programmatically per task (the "factory" pattern is documented). Per-invocation `model` (precedence 1) lets the orchestrator override upward/downward per task without editing files.
- Because the parent-to-child channel is only the prompt string (+ CLAUDE.md + preloaded skills), a "task-specific agent instruction file" must be self-contained; any file the orchestrator generates should be referenced by path in the prompt or injected as a preloaded skill/system prompt.
- Do not set `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` if you want per-role model tiers; it overrides frontmatter and per-invocation values.

### Gaps
- Did not read the full "Agent tool behavior" table (exact input parameters such as `subagent_type`, `model`, `isolation`, `run_in_background`, `name`) from tools-reference; only the tool list rows were confirmed. The Agent SDK TypeScript fetch was truncated before the Agent/Workflow tool input schemas.
- The exact list of tools removed for subagents and the "Available tools" section were only summarized (see Q5).
- Model IDs in docs examples (`claude-opus-5-5`, `claude-sonnet-5`) are doc examples; I did not verify the current model lineup/pricing independently. Docs also mention a `fable` alias whose tier/position I did not verify.

---

## 2. The Workflow tool / dynamic workflows / scripted orchestration (pipeline, parallel, agent() with schema, resume), documented patterns, size and cost guidance

### Takeaway
"Dynamic workflows" are an official Claude Code feature (research preview at launch; now documented as available on all paid plans, API, Bedrock, Google Cloud Agent Platform, Microsoft Foundry): Claude writes (or you save/edit) a JavaScript script using `agent()`, `pipeline()`, `parallel()`, `phase()`, `log()` and `args`; a runtime executes it in the background with intermediate results held in script variables, so the main context sees only the final answer. Limits: 16 concurrent agents (configurable 1-256), 1,000 agents per run, 4,096 items per `parallel()`/`pipeline()`.

### Cited Findings

**What it is**
- "A dynamic workflow is a JavaScript script that orchestrates many subagents at once. Claude writes the script for the task you describe, and a runtime executes it in the background while your session stays responsive." — [Dynamic workflows docs](https://code.claude.com/docs/en/workflows)
- Who holds the plan: subagents/skills/agent teams = Claude decides turn by turn and results live in context; workflows = "A script the runtime executes", intermediate results live in "Script variables", scale "Dozens to hundreds of agents per run", repeatable "The orchestration itself", "Resumable in the same session". — [Dynamic workflows docs](https://code.claude.com/docs/en/workflows)
- "A workflow moves the plan into code... Claude's context holds only the final answer." Enables repeatable quality patterns: independent agents adversarially reviewing each other's findings; drafting a plan from several angles and weighing them. — [Dynamic workflows docs](https://code.claude.com/docs/en/workflows)
- Availability: all paid plans, Anthropic API, Bedrock, Google Cloud Agent Platform, Microsoft Foundry; Pro users enable via `/config`. Surfaces: CLI, Desktop, IDE extensions, `claude -p`, Agent SDK. `Workflow` tool in TypeScript Agent SDK v0.3.149+; add `Workflow` to `allowedTools` to auto-approve. — [Dynamic workflows docs](https://code.claude.com/docs/en/workflows); [Agent SDK: Subagents](https://code.claude.com/docs/en/agent-sdk/subagents)
- The `Workflow` tool is one of the tools always removed from subagents (so a workflow's agents cannot launch workflows). — [sub-agents](https://code.claude.com/docs/en/sub-agents)

**Script API (verbatim example from docs)**
```javascript
export const meta = {
  name: 'audit-routes',
  description: 'Audit every route handler for missing auth checks',
}
const found = await agent('List every .ts file under src/routes/.', {
  schema: { type: 'object', required: ['files'], properties: { files: { type: 'array', items: { type: 'string' } } } },
})
const audits = await pipeline(found.files, file =>
  agent(`Audit ${file} for missing authentication checks.`, { label: file }),
)
return audits.filter(Boolean)
```
— [Dynamic workflows docs](https://code.claude.com/docs/en/workflows)
- "`agent()` spawns one subagent, `pipeline()` runs one per item in a list, and `parallel()` runs a set of agent tasks at the same time and waits for all of them." Also `phase(title)` (groups agents in the progress view), `log()`, and global `args` (structured input to saved workflows). `agent()` resolves to `null` if stopped or on unrecoverable API error; `pipeline()` keeps `null`s (hence `.filter(Boolean)`). — [Dynamic workflows docs](https://code.claude.com/docs/en/workflows)
- `schema` option: subagent returns JSON matching the schema instead of prose; the schema is checked before the agent starts (provably self-contradictory schemas fail fast); output failing validation after 5 attempts fails the call (`MAX_STRUCTURED_OUTPUT_RETRIES` changes the count). Other `agent()` options seen in docs: `label`, `stallMs`. — [Dynamic workflows docs](https://code.claude.com/docs/en/workflows)
- Script rules: `export const meta` must be first statement and a plain literal (`name`, `description`, optional `phases`); `Date.now()`, `Math.random()`, no-arg `new Date()` throw (so relaunch is deterministic); `import()` fails before the run starts; no direct filesystem/shell access from the script itself (agents do the I/O); no mid-run user input. — [Dynamic workflows docs](https://code.claude.com/docs/en/workflows)
- Per-agent model: "A model the script names for a stage counts as the per-invocation model" in the same precedence order as subagents (so a script can assign Haiku/Sonnet/Opus per stage); "When nothing else assigns one, the agent runs on your session's model." The docs do not show the exact option key for the model in the snippet I read; the `/workflow-authoring` skill is the reference for full API. — [Dynamic workflows docs, "Cost"](https://code.claude.com/docs/en/workflows#cost)
- Reference for writing scripts: bundled `/workflow-authoring` skill (v2.1.248+) and the Workflow tool entry in the Agent SDK TypeScript reference (not retrieved). — [Dynamic workflows docs](https://code.claude.com/docs/en/workflows)

**Triggering and saving**
- Triggers: ask in prose ("use a workflow"), include keyword `ultracode` in a human-typed prompt, or `/effort ultracode` (v2.1.203+; plans a workflow for every substantive task; also sets effort `xhigh` at launch; uses more tokens, disables the Large workflow warning and concurrent subagent limit). Keyword does NOT trigger from `-p`, unstamped SDK prompts, scheduled prompts, webhooks or PR comments (since v2.1.210). — [Dynamic workflows docs](https://code.claude.com/docs/en/workflows)
- Bundled workflow: `/deep-research <question>` fans out web searches across angles, fetches and cross-checks sources, votes on each claim, returns a cited report with unverified claims flagged. — [Dynamic workflows docs](https://code.claude.com/docs/en/workflows)
- Save: in `/workflows` press `s` to save a run's script as a command to `.claude/workflows/` (project, shared) or `~/.claude/workflows/` (personal); runs as `/<name>`; project beats personal on name clash; nested `.claude/workflows/` in monorepos (closest wins). Plugins can ship a `workflows/` dir, namespaced `/plugin:name`. Each run's script is written under `~/.claude/projects/<session>/` and can be edited and relaunched. — [Dynamic workflows docs](https://code.claude.com/docs/en/workflows)
- Permissions: CLI shows a plan-approval prompt per mode (Auto: first launch only; Manual/acceptEdits: every run; bypass: none). In `claude -p`/SDK there is no prompt: use `Workflow` / `Workflow(<name>)` allow rules, auto mode, bypass, a PreToolUse hook, `--permission-prompt-tool` or `canUseTool`. Workflow subagents use the session's permission rules; in auto mode, script-computed prompts are not treated as user requests by the classifier. — [Dynamic workflows docs](https://code.claude.com/docs/en/workflows)

**Limits (documented table)**
- Up to 16 concurrent agents by default (fewer if CPUs are limited); `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS` 1-256 (v2.1.269+). Up to 4,096 items per `parallel()`/`pipeline()` call. 1,000 agents total per run ("Prevents runaway loops"). — [Dynamic workflows docs](https://code.claude.com/docs/en/workflows)
- Note the contrast: ordinary Agent-tool subagents are capped at 20 concurrent (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`). — [sub-agents](https://code.claude.com/docs/en/sub-agents)

**Resume**
- The runtime tracks each agent's result, so a run can be paused/resumed in the same session, replayed in order of agent start: completed agents return saved results; the first agent whose prompt differs (edited script or different earlier output) reruns AND every agent after it; failed agents rerun along with all later-started agents (so a failure mid-fan-out reruns finished work). Running agents at stop time start over. — [Dynamic workflows docs](https://code.claude.com/docs/en/workflows)
- Across sessions: backgrounded sessions continue; `claude --resume` sessions can replay saved results from `~/.claude/projects/`; cloud sessions persist results with conversation history; otherwise `nothing to resume` error. — [Dynamic workflows docs](https://code.claude.com/docs/en/workflows)
- Usage-limit handling (v2.1.271+): the run pauses instead of failing agents (interactive claude.ai subscription only; resets within 24h; max two waits). Stalled agents auto-restart up to 5 times (6 attempts) with `stallMs` override. — [Dynamic workflows docs](https://code.claude.com/docs/en/workflows)

**Size and cost guidance**
- "A single run can use meaningfully more tokens than working through the same task in conversation"; try a small slice first. "Large workflow" advisory warning appears when more than 25 agents are scheduled or projected tokens pass 1.5 million (advisory only). — [Dynamic workflows docs, Cost](https://code.claude.com/docs/en/workflows#cost)
- Size guideline setting `workflowSizeGuideline` (v2.1.202+; settings-file key v2.1.219+): `small` <5 agents, `medium` <10, `large` <50, `unrestricted`. Default `medium`, or `small` on Pro with v2.1.271+. It is advice to Claude, not a cap; runtime caps always apply. — [Dynamic workflows docs](https://code.claude.com/docs/en/workflows#set-a-size-guideline)
- Model-cost advice in the workflow docs: check `/model` before large runs; "Ask Claude to use a smaller model for stages that don't need the strongest one when you describe the task." — [Dynamic workflows docs](https://code.claude.com/docs/en/workflows#cost)
- Prompt-cache sharing in fan-outs: agents with the same model, effort, agent type, tools, output schema and cwd share a cache prefix; Claude Code staggers matching agents (default hold up to 5000 ms, `CLAUDE_CODE_WORKFLOW_PREFIX_STAGGER_MS`) so later ones read the first's cache; workflow-agent cache TTL defaults to 5 minutes (set `subagentPromptCacheTtl` to `1h`; 1h cache writes cost more). Implication: mixing models across stages breaks cache sharing across those stages. — [Dynamic workflows docs](https://code.claude.com/docs/en/workflows)
- Example prompts in docs: audit many files; keep fixing until a check passes (loop with no-progress stop); migrate many files in parallel in isolated copies; per-file review then one ranked merge; research across many sources; find issues until the list stops growing. — [Dynamic workflows docs](https://code.claude.com/docs/en/workflows)
- Compare other parallel mechanisms: `/batch` is a bundled skill that splits one large change into 5 to 30 worktree-isolated subagents; agent teams are experimental; "Running several sessions or subagents at once multiplies token usage." — [Run agents in parallel](https://code.claude.com/docs/en/agents)

**Secondary sources (not primary; only search-result snippets, not fetched; treat with caution)**
- Blog coverage (laiso.substack.com, mer.vin, inventivehq.com, pasqualepillitteri.it, tylerfolkman.substack.com) says the research preview shipped late May 2026, describes runtime-generated "harnesses", up to 1,000 agents and 16 concurrent. The 1,000/16 numbers match the official docs; launch date is only from secondary snippets. — [pasqualepillitteri.it summary](https://pasqualepillitteri.it/en/news/3663/claude-code-dynamic-workflows-anthropic-research-preview) (secondary)

### Inferences
- A repo-owned `.claude/workflows/<name>.js` (checked in) is the officially supported way to make a "manager" orchestration deterministic and rerunnable, with a different model per stage (e.g. Haiku for file discovery/schema extraction, Sonnet for implementation, Opus for review/synthesis). Intermediate results never enter the parent context, which fits the "clean context per agent" goal.
- Because a workflow script cannot read files or run shell commands itself, task-specific instruction files must be produced by an agent (or passed in via `args`) and referenced in the next agent's prompt by path.
- Because resume replays by agent start order and invalidates later agents when an earlier prompt changes, put stable, deterministic prompts early in a script, and keep agent prompts free of timestamps/randomness.
- Fan-out cost control: use `workflowSizeGuideline`, run on a slice first, and consider whether homogenous model/effort/tools per fan-out stage is worth the cache sharing.

### Gaps
- The exact `agent()` options list (e.g. the key for model/effort/tools/isolation) and the `Workflow` tool input/output schema were not retrieved (page truncated; `/workflow-authoring` skill and SDK TS reference not read). Do not invent option names; verify in `/workflow-authoring`.
- No independent measurement/benchmark of workflow token cost found; Anthropic gives only thresholds (25 agents / 1.5M tokens).
- The workflows doc itself notes feature gating (`disableWorkflows`, org toggle); research-preview status wording may have changed since launch.

---

## 3. Anthropic's guidance: orchestrator-worker, prompt chaining, routing, parallelization, evaluator-optimizer; multi-agent research system; context engineering; writing effective tools; quantitative claims

### Takeaway
Anthropic's guidance: use the simplest pattern that works; orchestrator-workers when subtasks cannot be predefined; route easy queries to smaller models (Haiku) and hard ones to larger (Sonnet); multi-agent research (Opus lead + Sonnet subagents) beat single-agent Opus by 90.2% on an internal eval but at about 15x chat tokens; token usage alone explained 80% of performance variance on BrowseComp.

### Cited Findings

**Building Effective Agents (Dec 19, 2024; page notes that tooling/models have since changed, with model names updated to Haiku 4.5 / Sonnet 4.5)** — [Anthropic](https://www.anthropic.com/engineering/building-effective-agents)
- Prompt chaining: "decomposes a task into a sequence of steps", each call processes the previous output, optional programmatic gates between steps; trades latency for accuracy.
- Routing: classifies an input and directs it to a specialized follow-up; example "Routing easy/common questions to smaller, cost-efficient models like Claude Haiku 4.5" and hard ones to larger models like Sonnet 4.5.
- Parallelization: sectioning (independent subtasks) and voting ("Running the same task multiple times to get diverse outputs").
- Orchestrator-workers: "a central LLM dynamically breaks down tasks, delegates them to worker LLMs, and synthesizes their results"; differs from parallelization because subtasks are not predefined.
- Evaluator-optimizer: "one LLM call generates a response while another provides evaluation and feedback in a loop"; works best with clear evaluation criteria.
- Simplicity: "we recommend finding the simplest solution possible, and only increasing complexity when needed"; "add multi-step agentic systems only when simpler solutions fall short". Frameworks: "We suggest that developers start by using LLM APIs directly" because abstraction hides prompts/responses.

**How we built our multi-agent research system (Jun 13, 2025)** — [Anthropic](https://www.anthropic.com/engineering/multi-agent-research-system)
- Architecture: orchestrator-worker; lead agent plans, spawns parallel subagents, synthesizes, decides if more research is needed; the lead saves its plan to memory so it survives context truncation (context beyond 200,000 tokens gets truncated); a separate CitationAgent attributes sources at the end.
- Model mix and result: "multi-agent system (Claude Opus 4 lead, Claude Sonnet 4 subagents) beat a single Opus 4 agent by 90.2%" on Anthropic's internal research eval.
- Cost: agents use about 4x the tokens of chat; multi-agent systems about 15x the tokens of chat.
- Variance: three factors explained 95% of BrowseComp performance variance; token usage alone explained 80%; the others were number of tool calls and model choice. Upgrading to Sonnet 4 gave a larger gain than doubling the token budget on Sonnet 3.7.
- Effort-scaling rules embedded in prompts: simple fact-finding = 1 agent, 3-10 tool calls; direct comparisons = 2-4 subagents, 10-15 calls each; complex research = more than 10 subagents with divided responsibilities.
- Parallelism: lead spawns 3-5 subagents in parallel; each subagent uses 3+ tools in parallel; research time reduced by up to 90% on complex queries. Tool-description rewriting by a tool-testing agent cut task completion time by 40%.
- Delegation lessons: each subagent needs an objective, output format, tool/source guidance and clear task boundaries; vague instructions caused duplicated work. Prefer heuristics over rigid rules; use extended thinking as planning scratchpad; LLM-judge rubric with a single prompt scoring 0.0-1.0 was most consistent; start evals with about 20 queries; judge end-state not exact path.
- Handoffs/limits: subagents can write outputs to external storage (filesystem) and pass lightweight references back to avoid information loss and token overhead; long conversations use phase summaries and fresh subagents with clean contexts and careful handoffs; resumable from checkpoints; lead waits synchronously for subagent batches, which bottlenecks steering (async is future work).

**Effective context engineering for AI agents (Sep 29, 2025)** — [Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- Context engineering = "strategies for curating and maintaining the optimal set of tokens"; context rot: recall decreases as context grows.
- Just-in-time retrieval: keep lightweight identifiers (file paths, queries, links) and load at runtime; progressive disclosure lets agents "incrementally discover relevant context".
- Compaction and structured note-taking (notes persisted outside context).
- Sub-agent architectures: specialized sub-agents "can handle focused tasks with clean context windows"; each returns "a condensed, distilled summary of its work (often 1,000-2,000 tokens)".
- System prompt "right altitude": between brittle hardcoded logic and vague guidance.

**Writing effective tools for agents (Sep 11, 2025)** — [Anthropic](https://www.anthropic.com/engineering/writing-tools-for-agents)
- Build a few purpose-built tools for high-impact workflows instead of wrapping every endpoint ("More tools don't always lead to better outcomes"); namespace related tools; return high-signal info (names over opaque IDs); optimize token efficiency (pagination, filtering, truncation; "For Claude Code, we restrict tool responses to 25,000 tokens by default"); `response_format` concise vs detailed (206 vs 72 tokens in a Slack example, about one-third); write descriptions like onboarding a new hire with unambiguous parameter names.
- Evaluation-driven loop: prototype, create realistic eval tasks with verifiable outcomes, run simple agentic loops, analyze transcripts, have an agent refine tools, validate on held-out set.

**Claude Code's own multi-agent cost numbers**
- Agent teams "use approximately 7x more tokens than standard sessions when teammates run in plan mode"; guidance: use Sonnet for teammates, keep teams small (start with 3-5 teammates; 5-6 tasks per teammate), keep spawn prompts focused. — [Manage costs](https://code.claude.com/docs/en/costs); [Agent teams](https://code.claude.com/docs/en/agent-teams)
- Subagents' own requests "count toward the same usage limits as your main conversation"; many subagents returning detailed results "can consume significant context". — [sub-agents](https://code.claude.com/docs/en/sub-agents)
- Anthropic's Opus 5 prompting guide: Opus 5 "coordinates teams of subagents well, with effective writer-verifier patterns and few cases of agents overwriting each other's work", but "delegates to subagents more readily than prior models... it multiplies cost and time when applied to small tasks". Recommended instruction: delegate only for large, genuinely independent, parallelizable tasks; "do not use subagents to verify or double-check your own work"; Opus 5 verifies itself, so remove explicit verification instructions/subagent verifiers ("cause over-verification"). Deterministic caps: `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`, `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`, `maxBudgetUsd` (Claude Code 2.1.217+). With the `claude_code` system-prompt preset on Opus 5, Claude Code adds a "don't call Agent tool unless asked" line; with a custom/omitted system prompt it does not. — [Prompting Claude Opus 5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5); [Agent SDK: Subagents](https://code.claude.com/docs/en/agent-sdk/subagents)
- The Opus 5 guide also says `low` and `medium` effort "produce strong quality at a fraction of the tokens and latency" and recommends effort as a primary cost control; Opus 5 has a 1M-token context window as default and maximum. — [Prompting Claude Opus 5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5)

### Inferences
- The 90.2% result is for breadth-first research tasks; Anthropic's own post says (not captured verbatim here) that multi-agent suits parallelizable work and fits poorly where agents share a lot of context or have many dependencies (e.g. most coding). This claim was NOT verified in my fetch of the post (summary did not include it) so treat as unverified; the Claude Code docs say something analogous for agent teams ("For sequential tasks, same-file edits, or work with many dependencies, a single session or subagents are more effective").
- Mapping to this repo's manager/executor idea: manager = orchestrator-worker; per-executor model choice = routing; spec-hash verify loops = evaluator-optimizer; prompt chaining = ordered waves/items; parallelization = independent items in the same wave.
- The post's model mix (strongest model as lead, mid-tier workers) is the only quantified Anthropic data point I found for tiered models; no source found quantifying Haiku-as-worker gains or Opus-for-review gains.

### Gaps
- Building Effective Agents page was fetched via summarizer; the "publication date Dec 19, 2024" is as displayed, but the content has been revised (Haiku 4.5/Sonnet 4.5 names), so exact current wording may differ from the original.
- Did not fetch the Anthropic cookbook or the claude-code GitHub repo (CHANGELOG/issues) for subagent/workflow history; no data on when subagent nesting was introduced beyond docs' version notes.
- No quantitative cost benchmark comparing Haiku/Sonnet/Opus subagent mixes inside Claude Code was found.

---

## 4. How Agent Skills, AGENTS.md/CLAUDE.md and subagent definitions interact for per-task context (progressive disclosure, skill loading, nested/scoped instruction files)

### Takeaway
Three loading regimes exist: always-on (CLAUDE.md/AGENTS.md at launch, skill descriptions), on-demand (skill bodies, subdirectory CLAUDE.md/AGENTS.md, path-scoped `.claude/rules`, nested `.claude/skills`), and explicit injection (subagent `skills:` preload). Subagents get CLAUDE.md/AGENTS.md automatically (unless `omitClaudeMd`) and only the skills you list in `skills:` as full content.

### Cited Findings

**Agent Skills / progressive disclosure**
- Three levels (Oct 16, 2025; update Dec 18, 2025: Agent Skills published as an open standard): Level 1 name+description preloaded into the system prompt; Level 2 SKILL.md body read when relevant; Level 3+ linked files opened only when needed. Authoring guidance: start with evaluation, split unwieldy SKILL.md into referenced files, think from Claude's perspective (name/description drive triggering); install only trusted skills. — [Anthropic: Equipping agents with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- Claude Code behavior: "skill descriptions are loaded into context so Claude knows what's available, but full skill content only loads when invoked"; "a skill's body loads only when it's used, so long reference material costs almost nothing until you need it." Keep SKILL.md under 500 lines; description + `when_to_use` truncated at 1,536 chars in the listing; after compaction the most recent invocation of each skill is re-attached (first 5,000 tokens each, combined 25,000). — [Claude Code: Skills](https://code.claude.com/docs/en/skills)
- Frontmatter relevant to orchestration: `model` (override for the current turn when the skill is active), `context: fork` (run in a forked subagent context), `agent` (which subagent type for fork), `background`, `allowed-tools`, `disable-model-invocation` (also prevents preloading into subagents), `user-invocable`, `effort`, `paths`, `hooks`. For claude.ai uploads/Skills API only `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` are allowed (others hard error). — [Claude Code: Skills](https://code.claude.com/docs/en/skills)
- Skill + subagent, two directions: (a) skill with `context: fork` — system prompt from the agent type, task = SKILL.md content, CLAUDE.md also loaded; (b) subagent with `skills:` field — subagent's markdown body is the system prompt, task is Claude's delegation message, preloaded skills + CLAUDE.md. A forked skill "doesn't run in a fork of the current conversation... The subagent doesn't see your conversation history, so the skill's instructions have to stand on their own." — [Claude Code: Skills](https://code.claude.com/docs/en/skills)
- Preloaded skills are injected in full at subagent startup (unlike regular sessions); unlisted skills remain invocable via the Skill tool in the SDK. Built-in agents don't preload skills. — [Claude Code: Skills](https://code.claude.com/docs/en/skills); [Agent SDK: Subagents](https://code.claude.com/docs/en/agent-sdk/subagents)
- Agent teams: a teammate spawned from a subagent definition does NOT get the definition's `skills` (it loads skills from project/user settings); body is appended (in-process) or replaces the system prompt (split-pane). — [Agent teams](https://code.claude.com/docs/en/agent-teams)
- Nested/scoped skills: project skills load from `.claude/skills/` in the start directory and every parent up to repo root; skills in subdirectories below the start dir load lazily the first time Claude reads/edits a file there (or sooner with `/add-dir`, v2.1.257+); name clashes resolved via `/apps/web:deploy`; enterprise over personal over project precedence. — [Claude Code: Skills](https://code.claude.com/docs/en/skills)

**CLAUDE.md / AGENTS.md**
- Each session begins with a fresh context window; CLAUDE.md files (and, since v2.1.277, AGENTS.md) provide persistent instructions; "Claude treats them as context, not enforced configuration. To block an action regardless of what Claude decides, use a PreToolUse hook." — [Claude Code: Memory](https://code.claude.com/docs/en/memory)
- Loading: CLAUDE.md/CLAUDE.local.md in the directory hierarchy above the working directory load at launch; subdirectory files load on demand. `@path` imports are expanded at launch (do not reduce context cost). Size: "target under 200 lines per CLAUDE.md file"; move part-of-codebase or multi-step procedures to skills or path-scoped `.claude/rules/*.md` (`paths:` frontmatter, load only when matching files are touched). `claudeMdExcludes` skips files by glob. — [Claude Code: Memory](https://code.claude.com/docs/en/memory); [Manage costs](https://code.claude.com/docs/en/costs)
- AGENTS.md rules (default `claude-md-or-agents-md`): Claude reads AGENTS.md only if there is NO CLAUDE.md/.claude/CLAUDE.md/CLAUDE.local.md in the working directory or above; if both exist, only CLAUDE.md is read unless CLAUDE.md imports AGENTS.md (`@AGENTS.md`) or you set `claude-md-and-agents-md`. A subdirectory AGENTS.md loads when Claude opens a file there via Read and that subdirectory has none of the CLAUDE.md variants. Subagents that skip project instructions skip AGENTS.md too. — [Claude Code: Memory](https://code.claude.com/docs/en/memory). (This repo already uses `CLAUDE.md` containing `@AGENTS.md`, which matches the documented import route.)
- Cost guidance: "Move instructions from CLAUDE.md to skills" because skills load on demand; a "codebase-overview" skill gives context immediately instead of spending tokens reading files. — [Manage costs](https://code.claude.com/docs/en/costs)
- Subagents get CLAUDE.md automatically (Explore and Plan skip it); agent-team teammates also load CLAUDE.md, MCP servers and skills; `omitClaudeMd: true` makes a subagent skip user/project/local CLAUDE.md (managed policy still loads), which saves tokens for narrow roles. — [sub-agents](https://code.claude.com/docs/en/sub-agents); [Agent teams](https://code.claude.com/docs/en/agent-teams)
- Hooks as context filters: PreToolUse hooks can preprocess output (e.g. grep errors from a 10,000-line log) so only hundreds of tokens reach context. — [Manage costs](https://code.claude.com/docs/en/costs)

### Inferences
- Per-task context stack for an executor in a clean context: (1) subagent file body = stable role instructions; (2) `skills: [<module>-dev]` = domain skill preloaded in full (only way to guarantee it is present in a fresh context); (3) project CLAUDE.md/AGENTS.md is auto-included (keep it short, or set `omitClaudeMd: true` for roles that should not see it); (4) task-specific instructions (packet) go in the delegation prompt or a file path the agent reads. This mirrors the repo's `agentic packet <item>` concept.
- A "generated task-specific agent instruction file" has three official homes: a `.claude/agents/<task>.md` (hot-reloaded when the directory already exists), an SDK `agents={}` / `--agents` JSON entry (session-only, highest non-managed precedence, no file needed), or a generated skill preloaded via `skills:`. The `--agents` JSON / SDK route avoids writing to disk and avoids the "new directory needs restart" limitation.
- Because AGENTS.md is skipped when any CLAUDE.md exists, repos serving multiple tools (Cursor, Codex, Claude) should keep CLAUDE.md as a one-line `@AGENTS.md` import (as this repo does) so Claude reads the shared file.
- Subdirectory-scoped AGENTS.md/CLAUDE.md/skills are lazy, so nested per-module instruction files (e.g. `examples/orders/AGENTS.md`) load only if the executor reads a file in that directory: good for scoping, but not guaranteed for a fresh subagent unless it touches that path.

### Gaps
- Did not read the Skills page's final ~7k chars or the `large-codebases` monorepo page; the `skills` precedence nuance when an agent file and a skill share a name was not checked.
- Not verified whether a subagent's lazily loaded subdirectory CLAUDE.md/AGENTS.md behave identically to the main thread (docs say AGENTS.md loads "as Claude works in subdirectories"; applicability to subagents not stated).
- Claude Code docs do not quantify a recommended SKILL.md/description token budget beyond 500 lines / 1,536 chars / 15,000 tokens for combined subagent descriptions.

---

## 5. Known limitations: nesting, permission inheritance, cost of fresh context, handoff loss

### Takeaway
Nesting is now allowed (default depth 3), contrary to older docs; Workflow, AskUserQuestion and plan-mode tools are never available to subagents; permission mode inherits from the parent in auto/acceptEdits/bypass modes (overriding frontmatter); the biggest practical costs are re-gathering context in every fresh subagent, summary-only returns (lossy handoff), and multi-agent token multipliers (about 15x chat in Anthropic's research system; about 7x for agent teams).

### Cited Findings

**Nesting and concurrency**
- "By default, a subagent can spawn subagents of its own, up to three layers below the main conversation." At the depth limit the `Agent` tool is withheld from subagents (except forks) so they do the work themselves. `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` changes the depth; `1` turns nesting off. — [sub-agents](https://code.claude.com/docs/en/sub-agents); [Agent SDK: Subagents](https://code.claude.com/docs/en/agent-sdk/subagents)
- Concurrency: 20 subagents by default (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`); beyond that: `Concurrent subagent limit reached`; not enforced with ultracode on. Spend cap: `maxBudgetUsd`/`max_budget_usd` refuses new spawns (`Budget limit reached`), stops background subagents and ends the query with `error_max_budget_usd`. — [Agent SDK: Subagents](https://code.claude.com/docs/en/agent-sdk/subagents)
- Agent teams: "No nested teams: teammates cannot spawn their own teammates"; one team per session; lead fixed; no session resumption of in-process teammates; teammates' subagents run in foreground; experimental and disabled by default. — [Agent teams](https://code.claude.com/docs/en/agent-teams)
- Tools always removed from subagents: `AskUserQuestion`, `EnterPlanMode`, `ExitPlanMode` (unless `permissionMode: plan`), `ScheduleWakeup`, `WaitForMcpServers`, and `Workflow`. Background subagents get a smaller built-in tool set. — [sub-agents](https://code.claude.com/docs/en/sub-agents)

**Permission inheritance**
- If the main conversation is in `bypassPermissions`, `acceptEdits` or auto mode, the subagent runs in that mode and its own `permissionMode` is ignored; in `default`, `dontAsk` or `plan` it uses its own `permissionMode`, with exceptions (`bypassPermissions` falls back to the parent's mode; `auto` falls back when unavailable). Background subagents surface permission prompts in the main session and name the subagent. — [sub-agents](https://code.claude.com/docs/en/sub-agents)
- Workflow subagents use the session's permission rules; to avoid prompts on long runs, add the needed tools to allow rules before starting. In `-p`/SDK the Workflow launch is governed by allow/deny rules, auto-mode classifier, bypass, hook or `canUseTool`. — [Dynamic workflows docs](https://code.claude.com/docs/en/workflows)
- Agent-team teammates start with the lead's permission mode (except `dontAsk`); teammate prompts bubble up to the lead; messages between agents are treated as coming from another Claude session, not the user, so a teammate cannot supply consent. — [Agent teams](https://code.claude.com/docs/en/agent-teams)
- Tool restriction semantics: a tool left out via `tools` "isn't in the subagent's session at all"; hooks (e.g. PreToolUse validators) are the documented way to constrain tools like Bash for a subagent. — [Agent SDK: Subagents](https://code.claude.com/docs/en/agent-sdk/subagents); [sub-agents](https://code.claude.com/docs/en/sub-agents)

**Cost of fresh context / latency / handoff loss**
- "A subagent that isn't a fork starts fresh and may need time to gather context" (latency); each subagent "spends tokens of its own"; many detailed returns consume parent context. — [sub-agents](https://code.claude.com/docs/en/sub-agents)
- Parent receives only the final message; it may paraphrase; to keep verbatim output, instruct it. A subagent stopped by `maxTurns` returns output marked partial and can be resumed. API errors that end a subagent are never delivered as its result. — [Agent SDK: Subagents](https://code.claude.com/docs/en/agent-sdk/subagents)
- Anthropic's research system: multi-agent about 15x chat tokens; token usage explains 80% of variance; subagent outputs to filesystem with lightweight references to avoid "information loss"; lead's synchronous wait for subagents is a bottleneck. — [Anthropic multi-agent research](https://www.anthropic.com/engineering/multi-agent-research-system)
- Context-engineering guidance: sub-agents return condensed summaries of 1,000-2,000 tokens. — [Anthropic context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- Prompt-cache effects: subagent/workflow-agent/teammate requests sit outside the main conversation's cache TTL bucket (5 minutes default, 1h via `subagentPromptCacheTtl`, higher write cost); the `Prompt cache (main)` stat in `/usage` covers only the main conversation, not subagents. — [Dynamic workflows docs](https://code.claude.com/docs/en/workflows); [Manage costs](https://code.claude.com/docs/en/costs)
- Opus 5 delegates more readily and can over-verify; Anthropic suggests explicit delegation guidance and deterministic caps. — [Prompting Claude Opus 5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5)
- Workflow limits specific to resume: failure mid-fan-out reruns finished later agents; no mid-run user input (stage sign-off = separate workflows); scripts cannot import modules or touch files directly. — [Dynamic workflows docs](https://code.claude.com/docs/en/workflows)
- Parallel file edits: subagents can use `isolation: worktree`; agent teams do not isolate (partition files per teammate); `/batch` uses worktree-isolated subagents. — [Run agents in parallel](https://code.claude.com/docs/en/agents); [sub-agents](https://code.claude.com/docs/en/sub-agents)

### Inferences
- "Handoff loss" mitigations supported by sources: write executor results to files (research-system pattern) and return paths + short structured summaries (workflow `schema` gives enforced structure); keep the task packet self-contained; use `maxTurns` + resume for long executors; prefer forks only when background is large (they inherit the parent's context, so cost more).
- Setting `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1` is the documented way to enforce a flat manager -> executor topology (the older "subagents cannot spawn subagents" behavior), and it plus `maxBudgetUsd` bounds runaway cost.
- Mixed models in one fan-out forgo cross-agent prompt-cache sharing, a hidden cost of per-role model tiers; offset by cheaper tokens on Haiku/Sonnet.

### Gaps
- No quantitative measurement found for overhead of a fresh Claude Code subagent (system prompt + tool defs + CLAUDE.md tokens per spawn); only qualitative statements.
- Could not confirm from primary sources whether the "Explore runs on Opus" default (docs now) vs older Haiku default is stable; flag as possibly outdated either way.
- Version-specific behaviors cited (v2.1.2xx) change fast; all findings reflect docs as fetched 2026-10-12 and should be re-verified against the installed `claude --version`.

---

## Source list (primary unless marked)
- https://code.claude.com/docs/en/sub-agents (live docs, fetched 2026-10-12; truncated at 100k chars)
- https://code.claude.com/docs/en/agent-sdk/subagents (live)
- https://code.claude.com/docs/en/agent-sdk/typescript (live; truncated, Workflow/Agent tool schemas not read)
- https://code.claude.com/docs/en/workflows (live; "dynamic workflows")
- https://code.claude.com/docs/en/agents (live; comparison of parallel approaches)
- https://code.claude.com/docs/en/agent-teams (live; experimental)
- https://code.claude.com/docs/en/skills (live; truncated at 100k chars)
- https://code.claude.com/docs/en/memory (live; read via fetch + grep of saved output)
- https://code.claude.com/docs/en/costs (live)
- https://code.claude.com/docs/en/tools-reference (live; only tool list rows grepped)
- https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5 (live)
- https://www.anthropic.com/engineering/building-effective-agents (Dec 19, 2024)
- https://www.anthropic.com/engineering/multi-agent-research-system (Jun 13, 2025)
- https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents (Sep 29, 2025)
- https://www.anthropic.com/engineering/writing-tools-for-agents (Sep 11, 2025)
- https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills (Oct 16, 2025; updated Dec 18, 2025)
- SECONDARY (search snippets only): https://pasqualepillitteri.it/en/news/3663/claude-code-dynamic-workflows-anthropic-research-preview ; laiso.substack.com ; mer.vin ; inventivehq.com
- Note: WebFetch returns model-summarized page content, so quotes marked verbatim are as relayed by the fetcher; high-stakes quotes should be re-checked against the live page.
