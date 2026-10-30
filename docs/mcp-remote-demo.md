# Domain MCP: published lock and remote demo

The Domain MCP answers questions about the domain (`domain_source`, `domain_overview`, `domain_element`, `domain_changes`, `rules_for_path`). The server also serves the authoring skill, the dev skills and the team rules (tool `authoring_guide`, resources `skill://…`), behind `skill:read[:<module>]`; see `docs/distribution.md`. This page covers where those answers come from: the compiled working copy, or a **published lock**, a fixed snapshot of the domain that you can serve, pin and hand to a remote client.

## What a published lock is

A published lock is one JSON file made from the compiled working copy:

```json
{
  "publishedLockVersion": 1,
  "version": "v0.5.0",
  "digest": "<64 lowercase hex characters>",
  "lock": {},
  "rules": [],
  "conventions": {}
}
```

The example is abridged: `lock` is the whole domain lock as compile writes it, `rules` is the list of team rules that apply to paths and `conventions` is the project's resolved layout conventions (folder names, event and operator suffixes, forbidden imports); all three are shown empty here.

- `version` is a label you choose: 1 to 64 characters, no control characters.
- `digest` is the SHA-256 of the canonical JSON of `{ version, lock, rules, conventions }`. When the file is read, the server recomputes it and refuses the file if the content does not match (`published.digest-mismatch`). This only detects corruption; it does not stop tampering (see Security: only `--expect-digest` does). A file without `conventions` is refused as `published.malformed`.
- The file is limited to 32 MiB. A `publishedLockVersion` the installed package does not know is refused (`published.version-unsupported`).

## Creating it: `publish-lock`

```bash
bun run agentic compile
./node_modules/.bin/agentic-ddd publish-lock --version v0.5.0 --out dist/domain.published.json [--root <dir>]
```

`publish-lock` reads the compile snapshot (`.agentic/mcp/snapshot.json`), checks it exactly as the MCP does, writes the file and prints `published lock <version> digest <sha256>`. If the snapshot is missing or stale it exits 1 and asks you to run `compile` again.

## Serving it

Over stdio (a local client starts the process):

```bash
./node_modules/.bin/agentic-ddd mcp --published dist/domain.published.json
```

Over Streamable HTTP (see `docs/distribution.md` for the OAuth settings):

```bash
./node_modules/.bin/agentic-ddd mcp --published dist/domain.published.json --http --port 3333
```

`--expect-digest <sha256>` makes the server refuse any file whose digest is not the one you give (`published.digest-unexpected`). It needs `--published` (`cli.expect-digest-requires-published` otherwise).

At startup the server prints the version and the first 12 digest characters on stderr:

```
agentic-ddd serving published lock v0.5.0 (digest 3f2a9c1b7d4e)
```

and, with `--http`, the listening address as well.

## Working copy versus published lock

|                                        | Working copy (default)                                                                              | Published lock (`--published`)                                            |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Source                                 | `.agentic/domain.lock.json` and the snapshot in the project                                         | the one file, parsed and verified once at startup                         |
| Freshness                              | every call rechecks the snapshot; stale code, rules, config or lock is refused until `compile` runs | immutable: the same answers until the process restarts with another file  |
| Disk access                            | reads the project files on each call                                                                | none after startup                                                        |
| `rules_for_path` with an absolute path | accepted if inside the project root                                                                 | refused (`mcp.path-outside-root`): there is no root to resolve it against |
| `domain_source`                        | `{"mode":"working-copy"}`                                                                           | `{"mode":"published","version":...,"digest":...}`                         |

Module scoping works the same way in both: a `domain:read:<module>` token sees the same subset, and the answers of a module-scoped token are byte-identical between the two sources for the same content.

`domain_source` is read-only and unguarded by design: over HTTP any token the gate accepts (`domain:read` or `skill:read`) can call it, and it returns only mode, version and digest. It is the way a client learns which version it is talking to. It never returns a path.

## Local demo

```bash
bun run agentic compile
bun run mcp:demo
```

`mcp:demo` (`scripts/mcp-demo.ts`) runs everything in one process on `127.0.0.1`:

1. builds a published lock from the compiled repository;
2. starts a small local issuer that serves only a JWKS (an ES256 key generated with `jose`);
3. starts the domain MCP over HTTP with `--published` semantics on a free loopback port, with `mcp: { issuer, resource, jwksUri }` pointing at the local issuer;
4. acts as a remote client with plain `fetch` JSON-RPC over Streamable HTTP: `initialize`, then `tools/call`.

Expected output, shortened:

```
published lock demo digest 04f7cdb6...
issuer http://127.0.0.1:<port>  mcp http://127.0.0.1:<port>/mcp
no token                 -> HTTP 401
domain:read:orders       -> modules: orders
domain:read              -> modules: orders
domain_source            -> {"digest":"04f7cdb6...","mode":"published","version":"demo"}
stopped
```

The script exits 0 only if each step returns what is expected (see `--keep-alive` below to keep it running). It proves that the gate refuses an anonymous call, that a module-scoped and a bare token both pass it, and that the answers come from the published lock. It does not prove anything about a real authorization server: the issuer there is a stand-in.

### Connect a real MCP client to the demo server

Run `bun run mcp:demo -- --keep-alive`. After the automated checks the script keeps both servers running, prints the loopback MCP URL and a token with `domain:read` that is valid for 10 minutes, and stops cleanly on Ctrl+C (SIGINT/SIGTERM). Only `127.0.0.1` URLs are printed. Then, with Claude Code:

```bash
claude mcp add --transport http agentic-demo http://127.0.0.1:<port>/mcp --header "Authorization: Bearer <token>"
```

That is the Claude Code syntax. Other clients take the URL plus a bearer header in the same way, but I have not verified any of them. The token expires after 10 minutes; rerun the demo for a new one.

## Connecting a real remote client

Configure the external authorization server in `agentic.config.ts`:

```ts
mcp: {
  issuer: 'https://auth.example.com',
  resource: 'https://domain.example.com/mcp',
  // jwksUri is optional; without it the JWKS is discovered (RFC 8414, then OIDC).
},
```

`resource` must be `https`, or `http` on a loopback host. Any client that speaks Streamable HTTP and OAuth 2.1 can then connect to `https://domain.example.com/mcp` with a bearer token whose `aud` is `resource` and which carries `domain:read` or `domain:read:<module>`. A generic MCP client configuration looks like this (placeholders, not a tested file):

```json
{
  "mcpServers": {
    "agentic-ddd-domain": {
      "type": "http",
      "url": "https://domain.example.com/mcp",
      "headers": { "Authorization": "Bearer <access token>" }
    }
  }
}
```

Access tokens expire, so a real client must obtain and refresh them through the authorization server rather than keep a static header. I have not verified the exact configuration format or OAuth flow of any specific MCP client against this server; treat the snippet as a shape, not as a tested setup.

## Security

- **Bind address.** The default is `127.0.0.1`. Nothing is reachable from another machine unless the operator passes `--host`.
- **Exposing it.** Before you bind to a public or shared address, put TLS in front of it with a reverse proxy or load balancer. The server speaks plain HTTP and does not terminate TLS, and the bearer tokens must not travel in clear text.
- **Host and Origin.** Requests are checked against an allowlist before authentication: `Host` must be the bind address or the `resource` host (plus the loopback aliases on a loopback bind), and an `Origin`, when present, must be the matching origin. Anything else gets 403 (`mcp.host-denied`, `mcp.origin-denied`). A request without `Origin` is a non-browser client and passes; this is a DNS-rebinding defense, not an authentication step.
- **Digest.** The load-time digest check only catches corruption: a changed or truncated file is detected. It is not a defense against tampering, because anyone who can edit the file can recompute a matching digest (it covers `version`, `lock`, `rules` and `conventions`, all of which they control). The only defense is `--expect-digest`, an out-of-band pin: take the expected digest from a channel you trust (for example the release notes or a signed tag) and pass it, so that a swapped file is refused. Signing the artifact is deferred together with fetching it from a URL or package; until then, serve published locks only from a file you place yourself.
- **Errors.** Errors sent to a remote client never carry absolute paths: a missing snapshot gets a generic message, a path outside the project is refused without echoing the absolute path, and unexpected failures answer `Internal server error` (the operator sees the cause in the server log). The codes are listed in `src/contracts/codes.ts`.
