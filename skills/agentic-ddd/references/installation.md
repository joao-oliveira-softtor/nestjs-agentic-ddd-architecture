# Installation

In the framework checkout, run `bun install --frozen-lockfile` and:

```bash
bun run skills:install                                     # current project, all targets
bun run skills:install --root /path/to/project --target codex
bun run skills:install --scope user --target all            # explicit global install
bun run skills:install --scope user --root /path/to/home --check
bun run skills:install --check                              # no writes, 0 when intact
```

`--scope` accepts project/user and `--target` cursor/codex/claude/all. `--root` is the project or user root; without a root, project uses cwd and user uses the home directory. An invalid option exits 2, a conflict/drift exits 1. Check never creates directories. The preflight refuses conflicts before any write; installing again keeps identical artifacts. A manually edited adapter is also a conflict: review/remove only its files before reinstalling.

Cursor/Codex use the link `.agents/skills/agentic-ddd`; Claude uses the link `.claude/skills/agentic-ddd`, both pointing to the checkout's `skills/agentic-ddd`. Adapters: `.cursor/agents/agentic-ddd-{manager,executor,reviewer}.md`, `.codex/agents/agentic-ddd-{manager,executor,reviewer}.toml`, `.claude/agents/agentic-ddd-{manager,executor,reviewer}.md`. The same layout is created under home for scope user. Nothing changes in config.toml, settings, permissions or the global model. Codex omits model/effort; Cursor/Claude use inherit. Claude preloads the skill in the skills field.

The source must stay in the original checkout, including for a global install. When moving/deleting that checkout, review the links/adapters and reinstall; there is no npm distribution in this delivery. Automatic discovery stays enabled. Reopen the session to reload skills/agents when needed.

The adapters point to each role's shared instructions. Invoke `agentic-ddd-manager` to prepare a proposal/contracts, `agentic-ddd-executor` with the packet and limits, or `agentic-ddd-reviewer` with the diff, the packets and the gate results (the reviewer does not edit files). The main session can play a role, without requiring a subagent inside a subagent.

Official formats: [Cursor](https://cursor.com/docs/subagents), [Codex](https://learn.chatgpt.com/docs/agent-configuration/subagents), [Claude Code](https://code.claude.com/docs/en/sub-agents). Old releases may not discover TOML automatically; update the client without the installer changing global settings.
