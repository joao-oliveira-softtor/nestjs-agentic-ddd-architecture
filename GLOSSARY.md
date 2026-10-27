# agentic-ddd

A framework where business rules are declared as decorated TypeScript and compiled into deterministic specifications that humans and AI agents implement and verify.

## Specification

**Spec repository**:
A decorated repository whose declarations are the source of truth, even if its bodies are never implemented there.
_Avoid_: Contract repo, model repo

**Proposal**:
A requested change to business rules: a `proposal.md` plus a structured delta, before it is compiled.
_Avoid_: Spec request, change request

**Delta**:
The structured description of what a proposal adds or changes (entities, invariants, methods, events, use-cases).
_Avoid_: Patch, diff

**Compiled bundle**:
The deterministic, hashed result of compiling a proposal against a base version, returned to whoever proposed it.
_Avoid_: Package, export, POC

**Neutral layer**:
The part of a compiled bundle that describes the change without any implementation language.
_Avoid_: Generic spec

**Target**:
A language- and framework-specific rendering of a compiled bundle; `nestjs-ts` is the reference target.
_Avoid_: Flavor, backend

## Entry points

**Domain MCP**:
The MCP server that serves domain queries, the authoring skill and proposals, outside the running application.
_Avoid_: Docs server, remote MCP

**Runtime MCP**:
The MCP server inside the running application that exposes operators as tools.
_Avoid_: Operator API, HTTP channel

**Operator**:
An AI agent inside the running application that can only act through the use-cases it declares.
_Avoid_: Bot, assistant
