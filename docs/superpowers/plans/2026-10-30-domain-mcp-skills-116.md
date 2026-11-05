# Plan: authoring skill, dev skills and team rules over the Domain MCP (#116)

- Issue: #116 (epic #105). Decisions: `docs/adr/ADR-0007.md` D4, D7, D13. Client research: `docs/research/2026-10-27-mcp-client-support/report.md` (recommendation section).
- Branch/worktree: `feat/domain-mcp-skills-116` in `.claude/worktrees/feat-domain-mcp-skills-116`, from `origin/main` (`4f6e26b`).
- Language: new code, comments, test titles and docs in English. Commit with `git -c user.name="João Victor" -c user.email="joao.oliveira@softtor.com.br" commit` and the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Global constraints

- Resources and the `authoring_guide` tool return the same bytes from one source; a test pins this.
- Scope `skill:read[:module]` is parsed by `moduleAccess(scopes, 'skill:read')` from `src/auth/scopes.ts` (no new parser). Stdio (local) sees everything. A remote caller with no grant sees nothing (fail closed).
- Out-of-scope modules are absent: the index and the resource list omit them, a direct lookup returns the same refusal as an unknown document (`mcp.element-unknown`-style code, no existence oracle).
- Runtime skills (`.agentic/runtime`) are never exposed.
- No absolute path and no source code in any output, local or remote.
- Dev skills are rendered with `renderDevSkill` from the **scoped** IR (not read from disk, so the published lock works too). For `access === 'all'` the output equals the generated `.agents/skills/<m>-dev/**` files (a test compares against the repo's generated orders skill). Pass `irHash(fullLock.ir)` as the hash. Conventions: `DEFAULT_CONVENTIONS` (the lock does not carry them).
- Team rules: only rules with `file !== null`. `paths === null` rules go to any `skill:read` holder. Path-bound rules go to a scoped token only if a glob matches a source file of a readable module; their globs are narrowed to the matching ones (see `narrowRulePaths` in `src/mcp/scope.ts`).
- Tool descriptions and server `instructions` carry: "Reply to the user in the user's language. Never translate identifiers, invariant ids or business text."
- URIs: `skill://agentic-ddd/SKILL.md`, `skill://agentic-ddd/references/<file>.md`, `skill://<module>-dev/SKILL.md`, `skill://<module>-dev/references/<file>.md` (markdown only), `skill://agentic-ddd/rules/<rule key>.md`. Mime `text/markdown`.
- New test files outside `evals-*` go into `verify.test` in `agentic.config.ts`. CHANGELOG entry under "[Não lançado]" in English. Never hand-edit generated files (`.agents/`, `.agentic/`, the AGENTS.md block).
- Gate: `bun run typecheck`, `bun run lint`, `bun test --path-ignore-patterns='test/evals-*'`, `bun run agentic verify 0001` (done), `bun run build`, `bun run test:package`, `bun run agentic compile --check`, `bun run skills:install --check`.

## Task 1: document catalogue (`src/mcp/skills.ts`, pure, no MCP SDK)

Create `src/mcp/skills.ts` and `src/mcp/skills.test.ts`.

- `loadAuthoringDocs(dir: string)`: reads `SKILL.md` and `references/*.md` of the authoring skill directory (not `assets/`), returns `{ path, content }[]` sorted by path.
- `catalogue({ authoring, lock, fullLock, rules, skillAccess }): SkillDoc[]` with `SkillDoc = { uri, title, purpose, content }`. `title` is the first heading or the frontmatter `name`; `purpose` is the frontmatter `description` for SKILL.md files, otherwise the first non-empty paragraph, cut to 160 chars.
- `skillAccess` is a `ModuleAccess` (`'all'` or a set); an empty set yields `[]`. Dev-skill docs only for modules in the set. Rules per the global constraints (use `rulesFor` for the match against the module sources; the `source` of an IR item may end in `:<line>`, strip it as `dev-skill.ts` does).
- `findDoc(docs, ref)`: `ref` is a full URI or a short name (`SKILL.md`, `authoring`, `orders-dev`); returns the doc or undefined. Short name matches the path after `skill://<skill>/` with or without `.md`, and a bare skill name maps to its `SKILL.md`; ambiguous short names return undefined.
- `index(docs)`: the markdown index text: one paragraph (what the skill is, read it before any proposal), the language rule, the read order (SKILL.md, references/authoring.md, the dev skill of the module being changed), then a table uri | title | purpose | bytes.
- Tests: scoped vs all (dev skill of a hidden module absent, rule bound to a hidden module's glob absent and a visible rule's globs narrowed), runtime skills absent, equality with `.agents/skills/orders-dev/SKILL.md` for `'all'` on the repo's own lock, no absolute path in any content, `findDoc` short names.

## Task 2: wire MCP (resources, `authoring_guide`, instructions, scope)

Edit `src/mcp/index.ts`, `src/auth/resource-server.ts` (+ its tests), `src/contracts/codes.ts`, add tests in `src/mcp/` (`skills-wiring.test.ts`).

- `guarded` takes the capability it checks (`domain:read` for the existing tools, `skill:read` for the new one) and computes `access` with `moduleAccess` for that capability; existing behaviour for `domain:read` tools is unchanged (existing tests stay green).
- `authoring_guide({ doc?: string })`: `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false`. No `doc` returns `index(docs)`; with `doc` returns that document's bytes verbatim; unknown or out-of-scope returns `mcp.doc-unknown` (new code in `codes.ts`, same message either way).
- Resources: one per `SkillDoc`, registered so that `resources/list` and `resources/read` honour the caller's `skill:read` access per request (the HTTP server is stateless: check how the SDK passes request context to resource callbacks and register accordingly). Stdio lists everything.
- Server `instructions` (<= 500 chars, critical text first): serves a domain contract; before proposing a change call `authoring_guide`; the language rule.
- HTTP gate: add an optional `anyOfScopes?: readonly string[]` to the resource server options (token must grant at least one; `scopes_supported` lists the union with `requiredScopes`); `startMcpHttpServer` passes `['domain:read', 'skill:read']`. A token granting neither is still refused with `auth.scope-missing`; a token with only `skill:read` reaches `authoring_guide` and sees no domain data.
- Source of the authoring dir: `new URL('../../skills/agentic-ddd', import.meta.url)` resolves from both `src/mcp` and `dist/mcp`.
- Tests (in-process client over the SDK, as `tools.test.ts` does): resource read equals tool output for every doc; `skill:read:orders` sees orders-dev only; no grant sees nothing; direct lookup of a hidden doc equals unknown; published mode serves the same docs; descriptions contain the language rule.

## Task 3: packaging, docs, changelog

- Add `skills/agentic-ddd` (SKILL.md and references, no assets) to `package.json` `files`; check `scripts/package-audit.ts`, `scripts/package-smoke.ts` and `scripts/build-package.ts`; extend the smoke test to call `authoring_guide` and read one resource from the packed tarball.
- Document the scope, URIs and tool in `README.md`/`docs/` where the MCP tools are documented; CHANGELOG entry; GLOSSARY term only if a new domain term appears.
- Register new test files in `agentic.config.ts` `verify.test`.

## Task 4: gate

Run the full gate in the worktree; fix what breaks; report outputs.
