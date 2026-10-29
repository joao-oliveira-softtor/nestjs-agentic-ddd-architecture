# Should compiled agent documents use XML tags instead of Markdown?

Question: should `@agentic-ddd`'s compiled outputs (packets, executor/reviewer briefs, generated skills, the `AGENTS.md` block), Markdown today, switch to XML-tagged sections, and which other prompt-structure changes are well supported? All sources were read on 2026-10-29, primary sources only. Nothing was run against a model. Each claim is marked **recommendation** (vendor advice, no data shown), **anecdote** (one named customer) or **measured** (a number, method unpublished).

**Summary.** Anthropic recommends XML tags for prompts that mix instructions, context, examples and inputs, and says nothing against Markdown. OpenAI says to start with Markdown and treats XML as a wrapper for precise section boundaries. Google says XML or Markdown both work and asks for consistency. The spec frameworks that document their format (Spec Kit, Kiro, OpenSpec) use Markdown, with Given/When/Then, EARS or RFC 2119 wording inside. Our outputs are Markdown plus a JSON block, read by four vendors' agents and measured by snapshots, the review benchmark and cycle-21. Verdict: keep Markdown; the one XML change worth testing is narrow (recommendation 2).

## Limitations

- BMAD and Tessl public docs exposed no task or spec format (the BMAD template URL returned 404; Tessl's pages describe context management only).
- Anthropic's "use XML tags" page now redirects into the general best-practices page, so claims cite that page.
- Vendor guides are written for the vendor's own models. Nothing tests Haiku-class models reading our briefs.

## Comparison

| Source | Format the agent receives | Stated rationale |
|---|---|---|
| Anthropic | Tags recommended (`<instructions>`, `<context>`, `<input>`, `<example>`, `<document>`) | Less misinterpretation when content types mix |
| OpenAI GPT-4.1 / GPT-5 | Markdown first; XML or JSON optional | XML wraps a section with a start and end; JSON poor on big document sets |
| Gemini | XML tags or Markdown headings | Separates instructions, context, tasks; be consistent |
| AGENTS.md | Plain Markdown, any headings | No required structure |
| Claude Skills | Markdown body plus YAML frontmatter; no XML in `name`/`description` | Concise, progressive disclosure |
| Spec Kit | Markdown; Given/When/Then, `FR-001 System MUST`, `[NEEDS CLARIFICATION]`, `- [ ] T001 [P] [US1] path` | Independently testable stories |
| Kiro | `requirements.md` in EARS, plus `design.md` and `tasks.md` | Clarity, testability, traceability, completeness (vendor-stated) |
| OpenSpec | Markdown Requirement/Scenario blocks, GIVEN/WHEN/THEN, SHALL/MUST, delta sections | Behavior contract; deltas ease review |
| BMAD, Tessl | Not documented in reachable pages | n/a |
| agentic-ddd | Markdown plus JSON block; Given/When/Then | ADR-0003, ADR-0007 D10/D14 |

## Claims

| # | Claim | Kind | Source |
|---|---|---|---|
| 1 | XML tags "help Claude parse complex prompts unambiguously, especially when your prompt mixes instructions, context, examples, and variable inputs"; use consistent names and nest | Recommendation | <https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices> |
| 2 | Long data at the top and the query at the end gives "up to 30 percent" better results in tests, "especially with complex, multidocument inputs" | Measured, method unpublished | same page |
| 3 | Removing Markdown from the prompt reduces Markdown in the output | Recommendation | same page |
| 4 | Explaining why an instruction exists lets Claude generalize | Recommendation | same page |
| 5 | IMPORTANT or ALL CAPS makes current Claude over-apply; keep `CLAUDE.md` short; a rule with no exceptions belongs in a hook | Recommendation | <https://code.claude.com/docs/en/best-practices> |
| 6 | Skill `name`/`description` cannot contain XML tags; body under 500 lines; test with Haiku, Sonnet and Opus; validator loops "greatly improve output quality" | Recommendation | <https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices> |
| 7 | GPT-4.1: start with Markdown; XML wraps a section precisely; JSON "performed particularly poorly" on large document sets; put instructions at both ends of long context | Recommendation | <https://developers.openai.com/cookbook/examples/gpt4-1_prompting_guide> |
| 8 | GPT-5: Cursor found XML specs "improved instruction adherence on their prompts"; contradictory instructions are "more damaging" | Anecdote; recommendation | <https://developers.openai.com/cookbook/examples/gpt-5/gpt-5_prompting_guide> |
| 9 | Gemini: XML or Markdown, "Choose one format and use it consistently"; context first, questions last | Recommendation | <https://ai.google.dev/gemini-api/docs/prompting-strategies> |
| 10 | AGENTS.md is "just standard Markdown" | Spec statement | <https://agents.md> |
| 11 | Spec Kit templates are Markdown with Given/When/Then, `System MUST`, task IDs and `[P]` markers | Template content | <https://raw.githubusercontent.com/github/spec-kit/main/templates/spec-template.md>, <https://raw.githubusercontent.com/github/spec-kit/main/templates/tasks-template.md> |
| 12 | Kiro requirements use EARS (`WHEN ... THE SYSTEM SHALL ...`) | Vendor-stated, no data | <https://kiro.dev/docs/specs/feature-specs/> |
| 13 | Kiro groups independent tasks into dependency waves | Doc statement | <https://kiro.dev/docs/specs/> |
| 14 | OpenSpec: Requirement/Scenario blocks, RFC 2119 keywords, "a behavior contract, not an implementation plan" | Doc statement | <https://raw.githubusercontent.com/Fission-AI/OpenSpec/main/docs/concepts.md> |

The only number is claim 2, and it does not isolate XML. Claims 1, 7 and 8 are the case for XML, and claim 8 is one customer's report. Claim 3 is a risk for us because briefs demand a JSON-only final answer.

## Recommendations (ranked by evidence, then cost)

1. **Keep Markdown headings in `src/compiler/packet.ts`, `scripts/agent-briefs.ts` and the generated skills; do not wrap sections in XML.** Evidence: claims 7, 9, 10, 11, 14. No cost; baselines unchanged; every non-Claude consumer reads Markdown natively. Skills must stay Markdown anyway (claim 6).
2. **Test wrapping the embedded packet as `<packet>...</packet>` in `scripts/agent-briefs.ts`, or demoting its headings.** The packet's `# Identification` is an H1 inside the brief's `## Packet`, which is ambiguous, and claim 1 targets exactly this "instructions plus embedded input" case. Evidence: weak to moderate. Cost: a few tokens and one `agent-briefs` snapshot update. `specHash` is computed from the structured `ItemSpecification` (`src/compiler/item-spec.ts`), not from the rendered packet, so it does not change. Rerun the review benchmark and cycle-21 before and after; adopt only if Haiku does not regress. Tags are harmless to non-Claude agents.
3. **Remove the duplicated executor rules.** The brief core and the packet's `## Executor rules` both say to change only the item's body and tests and not to touch decorators, proposals or generated files. Duplicates risk contradiction (claim 8) and spend ADR-0003 ceiling tokens. Evidence: moderate (claims 5, 6, 8). It edits the `ROLE_CORES` lines pinned by `classScopeCore` and the review benchmark, plus the packet snapshot. ADR-0003 D11 already defers packet trimming, so fold it into that decision.
4. **Keep the order: role core first, data in the middle, verification command last.** Matches claims 2, 7 and 9. If the "Final answer" JSON format moves, put it after the packet and test with Haiku first. Evidence: moderate; cost: none.
5. **Add a one-line reason to a rule only where a benchmark failure shows it is skipped** (claim 4). Evidence: moderate; costs ceiling tokens.

## What we would not adopt

- **XML for all sections.** No measured gain, more tokens in every brief, and it breaks comparability with the baselines. The only coding-agent XML evidence is one anecdote (claim 8).
- **EARS or RFC 2119 `SHALL` wording** (claims 12, 14). Our criteria are already Given/When/Then, as in Spec Kit and OpenSpec, and each maps to a `covers` obligation. The EARS rationale is untested, and rewriting criteria would change `specHash` for every item.
- **IMPORTANT or capitals emphasis** (claim 5). Hard rules already live in gates.
- **Whole-packet JSON** (claim 7). JSON did worst on large document sets, so it stays only for the declaration.
- **Spec Kit's `[NEEDS CLARIFICATION]` markers and checklists.** Our manager/executor flow already returns items with missing data and plans with `status`/`next` waves (claim 13).

Not checked: the BMAD and Tessl formats (pages unreachable).
