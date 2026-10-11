# Package distribution implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement inline.

**Goal:** Deliver the installable tarball and isolated consumer validation for #13.
**Architecture:** One ESM package with explicit boundary exports and modular JS/declarations. Preserve registry identity, DI tokens and source locations; keep the example build separate.
**Tech Stack:** Bun 1.4.2, TypeScript 6, npm, Nest 12.
**Spec:** docs/superpowers/specs/2026-10-10-package-distribution-design.md

## Global Constraints

- No npm publication; provisional existing package name and private:true and prepublishOnly block.
- Preserve domain rules and architecture. No monorepo or new runtime feature.
- No consumer tsconfig paths; npm installation must use a real tarball.

## Review Focus

- A clean consumer must resolve every declaration with skipLibCheck false.
- Separate entrypoints must share registry and tokens, including bundled consumers.
- Distributed maps must preserve relative consumer source paths and hashes.
- Tarball audit must reject accidental tests, demo assets, secrets and absolute local paths.
- CLI must not assume repository cwd or private aliases; generated instructions must name public imports.

### Task 1: Package build and boundaries

Files: package.json, bun.lock, tsconfig.package.json, scripts/build-package.ts, bin/agentic-ddd.js, test/package.test.ts.
Produces: public subpath exports, declarations, maps, executable CLI.
- [x] Write package contract tests, run and observe missing exports/build.
- [x] Implement modular build and distribution metadata; move example dependencies to dev and TypeScript to runtime.
- [x] Verify package contracts and build; preserve example app regression.

### Task 2: Tarball audit and consumer

Files: scripts/package-audit.ts, scripts/package-smoke.ts, test/fixtures/package-consumer/**, test/package-audit.test.ts.
Consumes: npm pack artifact and six exports from Task 1.
Produces: isolated consumer compilation, skills, DI run, bundle/hash verification and audit.
- [x] Write consumer fixture and audit regression tests before implementation; observe missing functionality.
- [x] Implement pack/install/compile/CLI/run/bundle smoke in temporary directory with cleanup.
- [x] Verify malicious artifact rejection, public imports and private import rejection.

### Task 3: Documentation, CI and PR

Files: docs/distribution.md, README.md, .github/workflows/ci.yml, docs/superpowers/validation/2026-10-10-package-distribution.md.
- [x] Document provisional name, peers, Bun requirement, release checks and observed incompatibilities.
- [x] Add smoke to CI. Run suite, lint, typecheck, app build, package build, compile/check and smoke.
- [ ] Review final diff, open PR closing #13, follow CI and report outcomes without publishing.
