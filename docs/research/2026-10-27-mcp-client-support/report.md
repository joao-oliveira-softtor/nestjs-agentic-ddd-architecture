# MCP client support for remote servers, resources and prompts

Research for issue [#115](https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/issues/115), epic [#105](https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/issues/105). Feeds [ADR-0007](../../adr/ADR-0007.md) D7 (phase 2) and is useful to phase 1 (remote OAuth). All sources were read on 2026-10-27. Only primary sources were used: the MCP specification and extension pages at modelcontextprotocol.io, each vendor's official documentation and changelog, and, for Codex, the vendor's own source repository.

**Summary.** Tools are the only server primitive that every client in scope documents as supported over a remote connector. Claude Code and Cursor document resources and prompts. Claude's hosted apps (web, Desktop) list them as things a server can expose, but do not document how a user or the model reaches them. Codex reads resources through model-facing tools in its source code but documents neither primitive. ChatGPT documents neither. Server `instructions` are documented by Claude Code, Codex and ChatGPT. The MCP Skills extension (`io.modelcontextprotocol/skills`, SEP-2640, Final since 2026-09-13) has no confirmed support in any of the five clients. So the `authoring_guide` tool is the one path that reaches every client, and resources, prompts and instructions are additions on top of it.

## Limitations

- The ChatGPT Help Center article on developer mode (<https://help.openai.com/en/articles/12584461>) returned HTTP 403 to every fetch, so plan availability and the developer-mode feature list for ChatGPT are **unconfirmed**.
- None of the vendor pages shows a publication or "last updated" date, except the Claude Help Center ("Updated over a week ago") and the Cursor 1.6 changelog (2025-09-12). Each row below records the date it was read, not the date it was published.
- Nothing was tested against a live client. "Supported" means the vendor documents it (or, for Codex resources, that the vendor's source implements it). How a host behaves in practice still has to be checked once the phase-1 server exists.

## Specification baseline

| Fact | Source (read 2026-10-27) |
|---|---|
| The current revision is **2026-07-28**. It is stateless: there is no `initialize` handshake, every request carries version, client info and capabilities in `_meta`, and servers **MUST** implement `server/discover`. Revisions 2025-11-25 and earlier are "legacy" (handshake-based). A legacy client cannot talk to a modern-only server ("Legacy clients have no fall-forward mechanism"). A dual-era server **MAY** serve both. | <https://modelcontextprotocol.io/specification/latest>, <https://modelcontextprotocol.io/specification/2026-07-28/basic/lifecycle> (versioning page) |
| Server features: **Resources** ("Context and data, for the user or the AI model to use"), **Prompts** ("Templated messages and workflows for users"), **Tools** ("Functions for the AI model to execute"). | <https://modelcontextprotocol.io/specification/latest> |
| Prompts are **user-controlled**: "Typically, prompts would be triggered through user-initiated commands in the user interface… For example, as slash commands", and the protocol "does not mandate any specific user interaction model". Prompt messages may carry `resource_link` or embedded `resource` content. | <https://modelcontextprotocol.io/specification/2026-07-28/server/prompts> |
| **Server instructions**: in 2026-07-28, `DiscoverResult.instructions` is "Optional natural-language guidance for LLMs on how to use this server effectively". In 2025-11-25 it is the `instructions` field of the `initialize` result. | <https://modelcontextprotocol.io/specification/2026-07-28/server/discover>, <https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle> |
| **Skills extension** `io.modelcontextprotocol/skills` ([SEP-2640](https://modelcontextprotocol.io/seps/2640-skills-extension.md), Final, merged 2026-09-13). A server declares `resources` plus the extension in `server/discover`, implements `skills/list` and `skills/get`, and serves the files through `resources/read`. Each skill entry carries a manifest (URI, SHA-256 and size per file). Servers **SHOULD** use the `skill://<name>/SKILL.md` scheme. `SKILL.md` **MUST** start with `name`/`description` frontmatter, and its parent directory **MUST** match `name`. The limit is 512 files or 16 MiB per skill. The host verifies digests and asks the user for approval before loading. The examples assume revision 2026-07-28 or later. | <https://modelcontextprotocol.io/extensions/skills/overview.md>, <https://modelcontextprotocol.io/community/working-groups/skills-over-mcp.md> |
| Extension client matrix: Claude (web), Claude Desktop and Cursor have no Skills entry. ChatGPT is marked "Partial", linking to `developers.openai.com/plugins/build/mcp-server#import-skills-from-the-mcp-server`, but that section is not on the page today (see ChatGPT below). Claude Code and Codex are not listed. The page notes that the matrix "is maintained by the community". | <https://modelcontextprotocol.io/extensions/client-matrix.md> |

## Support matrix

Legend: **Yes** = documented by the vendor; **Partial** = supported with a documented restriction, or implemented in source but undocumented; **Unconfirmed** = no primary source says either way; **No** = the vendor says it is not supported. "Remote OAuth" means the MCP authorization flow (protected resource metadata, PKCE, client registration).

| Client | Remote transport | Remote OAuth | Tools | Resources | Prompts | Server `instructions` | Skills extension |
|---|---|---|---|---|---|---|---|
| Claude web / Desktop (custom connectors) | Streamable HTTP; legacy HTTP+SSE "being deprecated" | Yes: DCR, CIMD, Anthropic-held client; authorization specs 2025-03-26, 2025-06-18, 2025-11-25 | Yes | Yes, server may expose them (text and binary); how they are used is **unconfirmed** | Yes, server may expose them; how they are used is **unconfirmed** | Unconfirmed | Unconfirmed (blank in matrix) |
| ChatGPT (plugins / custom MCP servers) | Streamable HTTP at `/mcp` | Yes: CIMD preferred, DCR supported; PKCE S256; links the 2025-11-25 authorization spec | Yes | Partial: only MCP Apps UI resources are documented; general resources **unconfirmed** | Unconfirmed | Yes ("first 512 characters") | Unconfirmed (matrix says Partial; linked section absent) |
| Claude Code | `http` (Streamable HTTP); `sse` deprecated; `ws` | Yes: DCR, CIMD (auto-discovered), `--client-id`/`--client-secret`, loopback callback | Yes | Yes: `@server:proto://path` mentions plus model-facing list/read tools | Yes: `/server:prompt (MCP)` or `/mcp__server__prompt args` | Yes: loaded at session start, cut at 4,096 chars | Unconfirmed (not documented) |
| OpenAI Codex (CLI, IDE extension, ChatGPT desktop app) | stdio; Streamable HTTP | Yes: CIMD or DCR (`auto`), `codex mcp login`, configurable scopes and callback | Yes | Partial: model-facing `list_mcp_resources`, `list_mcp_resource_templates` and `read_mcp_resource` tools in source; not in the docs | Unconfirmed (not in the docs; no `prompts/list` client call found in source) | Yes | Unconfirmed |
| Cursor | stdio; SSE; Streamable HTTP | Yes: PKCE, RFC 9728 + RFC 8707, DCR as public client, or static client id/secret | Yes | Yes (since 1.6, 2025-09-12); how a user attaches them is **unconfirmed** | Yes; how a user invokes them is **unconfirmed** | Unconfirmed (not in the support table) | Unconfirmed (blank in matrix) |

## Per client

### Claude web and Claude Desktop (custom connectors)

| Fact | Source (read 2026-10-27) |
|---|---|
| Claude reaches the server "from claude.ai, Claude Desktop, Claude mobile, Cowork, and Claude Code, and the same connector infrastructure backs all of them". Remote connectors are called "from Anthropic's cloud infrastructure… across every Claude client". | <https://claude.com/docs/connectors/building>, <https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp> |
| Transport: "Use Streamable HTTP… Claude also supports the legacy HTTP+SSE transport, which is being deprecated". | <https://claude.com/docs/connectors/building> |
| Exposable features: "Tools, prompts, and resources", text and image tool results, text and binary resources. Not supported: "Resource subscriptions", "Sampling", "Advanced or draft capabilities". | <https://claude.com/docs/connectors/building> |
| How a user reaches a resource or prompt in the chat UI is not documented. The connectors help article covers only the "+" or "/" menu toggle per conversation and tool use ("Claude will now be able to use these services when relevant"). | <https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities> |
| Server `instructions`: no hosted-app page mentions them. **Unconfirmed.** | — |
| OAuth: "Claude follows the 2025-03-26, 2025-06-18, and 2025-11-25 authorization specifications". Supported types: `oauth_dcr`, `oauth_cimd` (only when the authorization server metadata advertises both `client_id_metadata_document_supported: true` and `none` in `token_endpoint_auth_methods_supported`, otherwise DCR), `oauth_anthropic_creds`, `none`, and `static_headers` (beta). PKCE S256 on every request. A `401` with `WWW-Authenticate: Bearer resource_metadata=…` is required. Only the first `authorization_servers` entry is used. The `resource` must equal the URL the user enters. The redirect is `https://claude.ai/api/mcp/auth_callback` for the hosted apps. `client_credentials` is not supported. Endpoints have a 10 s timeout (30 s for refresh). | <https://claude.com/docs/connectors/building/authentication.md> |
| Limits: tool results up to ~150,000 characters and 240 s per tool call. | <https://claude.com/docs/connectors/building> |
| Plans: Free, Pro, Max, Team and Enterprise; "Free users are limited to one custom connector"; on Team/Enterprise only Owners (or certain admins) add org connectors. | <https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp> |
| Every tool must declare `readOnlyHint` and `destructiveHint`. | <https://claude.com/docs/connectors/building/mcp.md> |

### ChatGPT

| Fact | Source (read 2026-10-27) |
|---|---|
| Custom MCP servers are added as plugins: "open ChatGPT Plugins, choose the plus control, and pick the option to add a custom MCP server". "Account and workspace policies apply". | <https://developers.openai.com/plugins/deploy/connect-chatgpt> |
| Transport: the server exposes a "streamable HTTP endpoint, typically at `/mcp`". The older API page still shows an SSE example for deep research (`search`/`fetch` tools). | <https://developers.openai.com/plugins/build/mcp-server>, <https://developers.openai.com/api/docs/mcp/> |
| Tools: "The server defines the tools available to ChatGPT and Codex". "Plugins primarily use tools". | <https://developers.openai.com/plugins/build/mcp-server>, <https://developers.openai.com/apps-sdk/concepts/mcp-server> |
| Server instructions: "ChatGPT and Codex use these instructions alongside tool metadata"; keep the most important details in the first 512 characters. | <https://developers.openai.com/plugins/build/mcp-server> |
| Resources: the only documented use is an optional UI resource for MCP Apps. Nothing says general resources are read or ignored. **Unconfirmed.** | <https://developers.openai.com/apps-sdk/concepts/mcp-server> |
| Prompts: not mentioned on any OpenAI page read. **Unconfirmed.** | — |
| Skills: plugin skills are bundled files ("A skill complements your MCP server by teaching ChatGPT and Codex how to use its tools"), declared in `agents/openai.yaml`. They are not served over MCP. The "import skills from the MCP server" section that the MCP client matrix links to is not on the page. **Unconfirmed.** | <https://developers.openai.com/plugins/build/skills>, <https://developers.openai.com/plugins/build/mcp-server> |
| OAuth: RFC 9728 metadata; authorization server metadata **must** advertise `S256` ("MCP servers are unsupported when their authorization server metadata omits this field"). CIMD is "the preferred client registration method" (`none` or `private_key_jwt`). DCR "registers once per MCP server connection". `resource` is sent on the authorize and token requests and should become `aud`. RFC 9207 `iss` is optional. The redirect is `https://chatgpt.com/connector_platform_oauth_redirect` (or `https://chatgpt.com/connector/oauth/{callback_id}` without issuer identification). OIDC scopes are requested by default when advertised. | <https://developers.openai.com/plugins/build/auth> |
| Developer mode, plan availability and write-action limits: the Help Center article returned 403. **Unconfirmed.** | <https://help.openai.com/en/articles/12584461> |

### Claude Code

| Fact | Source (read 2026-10-27) |
|---|---|
| Transports: `--transport http` (recommended), `sse` ("deprecated"), `ws`, `stdio`. | <https://code.claude.com/docs/en/mcp> |
| OAuth: "supports OAuth 2.0"; DCR; "also supports servers that use a Client ID Metadata Document (CIMD)… and discovers these automatically"; `--client-id`, `--client-secret`, `--callback-port`. The loopback redirect is on an ephemeral port, and both `localhost` and `127.0.0.1` must match without the port. | <https://code.claude.com/docs/en/mcp>, <https://claude.com/docs/connectors/building/authentication.md> |
| Resources: "Type `@`… Resources appear alongside files". Format `@server:protocol://resource/path`. "Resources are automatically fetched and included as attachments when referenced"; "Claude Code automatically provides tools to list and read MCP resources when servers support them". | <https://code.claude.com/docs/en/mcp> |
| Prompts: "Claude Code lists each MCP prompt as `/servername:promptname (MCP)`. Typing `/mcp__servername__promptname` also runs it". Arguments are split on whitespace. "Prompt results are injected directly into the conversation". The server name `anthropic-skills` is reserved, and its prompts are hidden. | <https://code.claude.com/docs/en/mcp>, <https://code.claude.com/docs/en/skills> |
| Server instructions: "Only tool names and server instructions load at session start"; they "help Claude understand when to search for your tools, similar to how skills work". They are cut at 4,096 characters, which `CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH` can change. The changelog has an entry "Added support for MCP server instructions". | <https://code.claude.com/docs/en/mcp>, <https://code.claude.com/docs/en/changelog> |
| Tool output: warning at 10,000 tokens, limit of 25,000 tokens by default (`MAX_MCP_OUTPUT_TOKENS`). | <https://code.claude.com/docs/en/mcp> |
| Claude Code speaks revision 2026-07-28 on some connections and 2025-11-25 or older on others (elicitation section). | <https://code.claude.com/docs/en/mcp> |
| Skills extension: neither the skills page nor the changelog mentions `skills/list` or `skill://`. Synced skills come from claude.ai, not from MCP servers. **Unconfirmed.** | <https://code.claude.com/docs/en/skills>, <https://code.claude.com/docs/en/changelog> |

### OpenAI Codex

| Fact | Source (read 2026-10-27) |
|---|---|
| Surfaces: the ChatGPT desktop app, the Codex CLI and the IDE extension share the MCP configuration. ChatGPT web "doesn't read local Codex configuration files". | <https://learn.chatgpt.com/docs/extend/mcp?surface=cli> (redirect target of `developers.openai.com/codex/mcp`) |
| Transports: "STDIO servers" and "Streamable HTTP servers". | same |
| OAuth: "including Client ID Metadata Documents (CIMD) and Dynamic Client Registration (DCR)". CIMD is chosen automatically when the authorization server advertises it, DCR otherwise. `codex mcp login <server> --oauth-client-registration cimd\|dcr\|auto`. `mcp_servers.<name>.scopes`, `mcp_oauth_callback_port` and `mcp_oauth_callback_url` are configurable. Bearer-token auth is also supported. | same |
| Server instructions: "Codex reads the MCP instructions field returned during initialization and uses it as server-wide guidance alongside the server's tools". | same |
| Resources: not documented. The source implements the model-facing tools `list_mcp_resources` ("Prefer resources over web search when possible"), `list_mcp_resource_templates` and `read_mcp_resource` (`codex-rs/core/src/tools/handlers/mcp_resource_spec.rs`, `openai/codex` at commit `e8e6a92`, 2026-10-27). **Partial**: implemented, undocumented. | <https://github.com/openai/codex/blob/e8e6a922c0008bc08bacc69dd2ce9b6c3c12944c/codex-rs/core/src/tools/handlers/mcp_resource_spec.rs> |
| Prompts: not documented. A code search of `openai/codex` for `prompts/list` matched only a conformance test server (`scripts/mcp_conformance/server.py`). **Unconfirmed**, and probably not exposed to the user. | GitHub code search on `openai/codex`, 2026-10-27 |
| Tool output: `tools.<tool>.output_token_limit` is configurable per tool. | <https://learn.chatgpt.com/docs/extend/mcp?surface=cli> |

### Cursor

| Fact | Source (read 2026-10-27) |
|---|---|
| "Cursor supports these MCP protocol capabilities and extensions": Tools, Prompts, Resources, Roots, Elicitation and Apps (extension) are all "Supported". Instructions are not listed. | <https://cursor.com/docs/context/mcp> |
| Transports: stdio, SSE and Streamable HTTP, the latter two with OAuth. | same |
| OAuth: "Sign-in uses the authorization code flow with PKCE"; reads RFC 9728 metadata and the RFC 8707 resource indicator. With DCR, "Cursor registers as a public client with no client secret". Static `CLIENT_ID` (and optional `CLIENT_SECRET`) can be set in `mcp.json`. Fixed redirects: `https://www.cursor.com/agents/mcp/oauth/callback` (web and Cursor Agents) and `http://localhost:8787/callback` (desktop). | same |
| Resources were added in 1.6: "We've added support for MCP Resources". | <https://cursor.com/changelog/1-6> (2025-09-12) |
| How a user attaches a resource or runs a prompt is not described. The chat section covers tools only. **Unconfirmed.** | <https://cursor.com/docs/context/mcp> |

## Recommendation for ADR-0007 D7

D7 stands: expose the authoring skill as resources **and** a mirror tool. The research changes which of the two carries the guarantee. **The `authoring_guide` tool is the primary path**, because tools are the only primitive confirmed in all five clients. Resources, a prompt and server instructions are additions for the clients that use them.

1. **`authoring_guide` tool (required, primary).** Read-only, with `readOnlyHint: true` and `destructiveHint: false` (Claude requires both), under the `domain:read` scope.
   - Called with no arguments, it returns an index: one paragraph on what the skill is and when to read it (before any proposal), the list of documents with URI, title, one-line purpose and size, and the order to read them in (`SKILL.md`, then `references/authoring.md`, then the dev skill of the module being changed).
   - Called with `{ doc }` (a URI or short name from the index), it returns that one document verbatim.
   - One document per call keeps each result well under the smallest documented limit (25,000 tokens in Claude Code; today the largest file, `authoring.md`, is ~13 KB).
   - The tool returns exactly the bytes the resource returns. The content comes from one source, and a test pins this.
2. **Server `instructions` (required, short).** At most ~500 characters, with the critical text first (ChatGPT advises 512, Claude Code cuts at 4,096). They say: this server serves a domain contract; before proposing a change, call `authoring_guide` (or read `skill://agentic-ddd/SKILL.md`); reply in the user's language; never translate identifiers, invariant ids or business text (D13). This reaches Claude Code, Codex and ChatGPT for certain. Claude hosted and Cursor are unconfirmed, which is why the tool must not depend on instructions.
3. **Resources (required, same content).** One `text/markdown` resource per file, laid out like the Skills extension so adding the extension later only adds methods:
   - `skill://agentic-ddd/SKILL.md`, `skill://agentic-ddd/references/<file>.md`;
   - `skill://<module>-dev/SKILL.md` for each generated dev skill, filtered by module scope (`domain:read:<module>`);
   - the team rules from `.ai/rules` (user story 19) as `skill://agentic-ddd/rules/<file>.md`, also listed in the tool index.
   Keep the `name`/`description` frontmatter and make directory names match `name`, as SEP-2640 requires. Claude Code (`@` mentions and resource tools), Codex (resource tools) and Cursor benefit. Runtime skills stay out, as D7 says.
4. **One prompt (optional, cheap).** For example `propose_change(module?)`, user-controlled, returning a user message that embeds `SKILL.md` and `authoring.md` as `resource` content and asks the model to draft `proposal.md` and the delta. It becomes a slash command in Claude Code, and Cursor documents prompt support. Do not rely on it anywhere else.
5. **Skills extension (defer).** No client in scope has confirmed support, and the extension is defined on revision 2026-07-28 (`server/discover`). Open a follow-up to declare `io.modelcontextprotocol/skills` (`skills/list`, `skills/get`, SHA-256 manifests) once the server speaks 2026-07-28 and a target host supports it. Step 3's URI layout makes that additive.

**What the tools-only fallback must contain.** A client that only sees tools must get everything a resource-capable client gets:

- the index (purpose, read order, document list with sizes);
- the full `skills/agentic-ddd/SKILL.md` and every reference file it links to that bears on authoring a proposal (at least `authoring.md`; the role references can be listed but marked as not needed for proposals);
- the generated dev skill of each module the token's scope allows;
- the `.ai/rules` files;
- the language rule of D13;
- from phase 3, a pointer to the proposal and delta format (the zod schema) so the guide is enough to write a valid proposal.

It must enforce the same scopes as the resources and must not return source code, absolute paths or secrets (user story 12).

### Consequences for phase 1 (remote OAuth)

Not part of D7, but found here and cheap to apply now:

- **Serve legacy 2025-11-25 (`initialize`) as well as, or before, 2026-07-28.** Claude's hosted apps document authorization specs only up to 2025-11-25, and a modern-only server breaks legacy clients with no fallback. A dual-era server is allowed by the spec.
- **The authorization server should advertise both CIMD and DCR.** CIMD needs `client_id_metadata_document_supported: true` and `none` in `token_endpoint_auth_methods_supported` (Claude); ChatGPT and Codex prefer CIMD. DCR needs a `registration_endpoint` (Cursor documents only DCR or a static client). It must also advertise `code_challenge_methods_supported: ["S256"]`, which ChatGPT requires.
- **On missing or invalid tokens, answer `401` with `WWW-Authenticate: Bearer resource_metadata=…`.** Make `resource` equal to the exact public URL, list the issuer first in `authorization_servers`, and validate `aud` against the `resource` parameter.
- **Redirect URIs to allow:** `https://claude.ai/api/mcp/auth_callback`; loopback on any port for `localhost` and `127.0.0.1` (Claude Code, and Codex unless its callback is fixed); `https://chatgpt.com/connector_platform_oauth_redirect`; `https://www.cursor.com/agents/mcp/oauth/callback`; `http://localhost:8787/callback`.

## Unconfirmed

- How Claude web/Desktop users or the model use connector resources and prompts, and whether these apps use server `instructions`.
- Whether ChatGPT reads general (non-UI) resources, prompts or MCP-served skills; plans and limits of developer mode (Help Center 403).
- Whether Codex exposes MCP prompts at all, and whether its resource tools are a supported, stable feature (they exist in source, not in docs).
- How Cursor surfaces resources and prompts to the user, and whether it uses server `instructions`.
- Any client's support for the Skills extension, or for protocol revision 2026-07-28 except Claude Code.
