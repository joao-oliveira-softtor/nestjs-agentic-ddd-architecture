// Stable error codes for CLI, compile, verify and MCP output. Codes are part of the public
// surface: tests and tooling match on them, so reword messages freely but never rename a code.
export const ERROR_CODES = {
  // auth
  'auth.audience-mismatch':
    'The token audience does not include this resource.',
  'auth.issuer-mismatch': 'The token issuer is not the configured issuer.',
  'auth.scope-missing': 'The token lacks a scope this resource requires.',
  'auth.token-expired': 'The access token has expired.',
  'auth.token-invalid':
    'The access token is malformed, unsigned or fails verification.',
  'auth.token-missing': 'The request carries no Bearer access token.',

  // cli
  'cli.argument-count':
    'The command received the wrong number of positional arguments.',
  'cli.host-unavailable': 'The --host address does not belong to this machine.',
  'cli.http-option-requires-http':
    'A --port or --host option was passed without --http.',
  'cli.jose-missing': 'The jose package is not installed.',
  'cli.mcp-config-missing':
    '--http was used but the config has no mcp section.',
  'cli.mcp-sdk-missing': 'The MCP SDK package is not installed.',
  'cli.option-unknown': 'An unknown command-line option was passed.',
  'cli.option-value-required':
    'An option that takes a value was passed without one.',
  'cli.port-denied':
    'The --port may not be opened by this user (privileged or reserved port).',
  'cli.port-in-use':
    'The --port (or the default 3333) is already in use on the bind address.',
  'cli.port-invalid': '--port is not an integer between 0 and 65535.',
  'cli.spec-hash-invalid': 'The --spec-hash value is not a SHA-256 hex digest.',

  // compile
  'compile.change-without-proposal':
    'The code has domain changes and no proposal describes them.',
  'compile.draft-with-check': '--draft-change was combined with --check.',
  'compile.proposal-ready':
    'The open proposal matches the code and is ready to be applied.',

  // config
  'config.brief-tokens-invalid':
    'rules.briefMaxTokens is not a positive integer.',
  'config.default-export-missing': 'The config file has no default export.',
  'config.folder-duplicate':
    'The same folder name serves more than one layer or infrastructure entry.',
  'config.folder-invalid':
    'A convention folder name is empty, relative or contains a path separator.',
  'config.import-target-invalid':
    'forbiddenImports lists a target other than application, operators or infrastructure.',
  'config.infrastructure-empty': 'conventions.infrastructure is an empty list.',
  'config.key-invalid':
    'A config key is known but not valid there (the message gives the hint).',
  'config.key-unknown': 'A config key does not exist in this section.',
  'config.mcp-field-missing': 'mcp is configured without issuer or resource.',
  'config.mcp-url-invalid':
    'An mcp issuer, resource or jwksUri is not an acceptable absolute URL.',
  'config.module-duplicate': 'Two modules have the same name.',
  'config.module-name-invalid': 'A module name is not kebab-case.',
  'config.module-outside': 'A module path points outside the project root.',
  'config.module-path-duplicate': 'Two modules point to the same path.',
  'config.module-path-missing':
    'A module path does not exist or is not a directory.',
  'config.module-root': 'A module path points to the project root itself.',
  'config.modules-empty': 'modules lists no module.',
  'config.not-object': 'A config section is not an object.',
  'config.not-text': 'A config value is not a string.',
  'config.not-text-list': 'A config value is not a list of strings.',
  'config.rules-dir-absolute': 'rules.dir is an absolute path.',
  'config.rules-dir-outside':
    'rules.dir is the project root or points outside it.',
  'config.suffix-duplicate': 'The events and operator suffixes are equal.',
  'config.suffix-format':
    'A suffix does not start with "." and end with ".ts", or contains a separator.',
  'config.suffix-test-file':
    'A suffix ends in .test.ts, .spec.ts or .d.ts, or has an empty segment.',

  // ir
  'ir.emits-target-missing': 'emits points to a class without @AgentEvent.',
  'ir.implements-not-class':
    'An adapter implements thunk did not return a class.',
  'ir.implements-not-port': 'An adapter implements a class without @AgentPort.',
  'ir.outside-modules':
    'A declaration lives outside every module of the config.',
  'ir.ports-not-class':
    'A use-case ports list has an entry that is not a class.',
  'ir.ports-not-port':
    'A use-case ports list cites a class without @AgentPort.',
  'ir.relation-not-class':
    'A contains/references list has an entry that is not a class.',
  'ir.relation-not-list': 'A contains/references thunk did not return a list.',
  'ir.relation-target-invalid':
    'A contains/references entry has neither @AgentEntity nor @AgentValueObject.',
  'ir.root-not-class': 'A port root thunk did not return a class.',
  'ir.root-not-entity': 'A port root class has no @AgentEntity.',
  'ir.schema-unrepresentable':
    'A Zod schema cannot be represented as JSON Schema.',
  'ir.thunk-threw':
    'A declaration thunk (contains, references, root, implements, ports) threw.',
  'ir.usecase-missing':
    'A class referenced as a use-case has no @AgentUseCase.',

  // lint
  'lint.body-tokens': 'A generated skill body exceeds the token budget.',
  'lint.description-invalid':
    'A generated skill description is not a valid string.',
  'lint.description-length':
    'A generated skill description is empty or longer than 1024 characters.',
  'lint.frontmatter-missing': 'A generated skill has no YAML frontmatter.',
  'lint.metadata-tokens':
    'A generated skill name and description exceed the token budget.',
  'lint.name-invalid':
    'A generated skill name does not follow the naming pattern.',
  'lint.name-mismatch': 'A generated skill name differs from its folder.',
  'lint.reference-too-deep': 'A skill reference goes deeper than one level.',
  'lint.skill-too-long': 'A SKILL.md exceeds 500 lines.',

  // lock
  'lock.incomplete': 'The lock file is missing ir or changes.',
  'lock.malformed': 'The lock file is not valid JSON.',
  'lock.version-unsupported': 'The lock file has an unsupported lockVersion.',

  // mcp
  'mcp.element-unknown': 'The requested element id does not exist.',
  'mcp.host-denied': 'The request Host header is not allowed.',
  'mcp.origin-denied': 'The request Origin header is not allowed.',
  'mcp.path-out-of-scope':
    'The requested path is outside the modules the token may read.',
  'mcp.path-outside-root': 'The requested path is outside the project root.',

  // proposal
  'proposal.acceptance-not-list': 'acceptance is not a list.',
  'proposal.applied-edited':
    'An applied proposal was edited after it was applied.',
  'proposal.applied-not-archived':
    'The lock records a change whose proposal is not in archive.',
  'proposal.applied-outside-archive':
    'A proposal with status applied is outside archive.',
  'proposal.archive-status-wrong':
    'A proposal in archive does not have status applied.',
  'proposal.archived-not-in-lock':
    'An archived proposal is not recorded in the lock.',
  'proposal.covers-unknown':
    'A criterion covers an id that is neither in the IR nor in delta.added.',
  'proposal.criterion-covers-missing': 'An automatic criterion has no covers.',
  'proposal.criterion-given-when-missing':
    'An automatic criterion lacks given or when.',
  'proposal.criterion-id-duplicate': 'Two criteria share the same id.',
  'proposal.criterion-id-invalid': 'A criterion id is not kebab-case.',
  'proposal.criterion-not-object': 'An acceptance entry is not an object.',
  'proposal.criterion-then-missing': 'A criterion has no then.',
  'proposal.delta-invalid': 'delta is not an object.',
  'proposal.delta-key-unknown':
    'delta has a key other than added, modified or removed.',
  'proposal.delta-mismatch':
    'The proposal delta and the code changes do not match.',
  'proposal.draft-no-change':
    '--draft-change was used with no domain change to propose.',
  'proposal.element-id-invalid':
    'An element id in delta or covers is malformed.',
  'proposal.file-missing': 'A change folder has no proposal.md.',
  'proposal.folder-name-invalid':
    'A change folder name is not NNNN-kebab-slug.',
  'proposal.frontmatter-invalid':
    'The proposal YAML frontmatter does not parse.',
  'proposal.frontmatter-missing': 'The proposal has no YAML frontmatter.',
  'proposal.frontmatter-not-object': 'The YAML frontmatter is not an object.',
  'proposal.id-mismatch': 'The proposal id differs from its folder number.',
  'proposal.list-invalid': 'A proposal field is not a list of strings.',
  'proposal.mark-applied-failed': 'The proposal cannot be marked as applied.',
  'proposal.mark-applied-frontmatter-missing':
    'markApplied found no frontmatter.',
  'proposal.mark-applied-status-missing':
    'markApplied found no "status: proposed" line.',
  'proposal.motivo-empty': 'The proposal ## Motivo section is empty.',
  'proposal.multiple-open': 'More than one proposal is open.',
  'proposal.number-duplicate': 'Two proposals share the same number.',
  'proposal.open-exists':
    '--draft-change was used while a proposal is already open.',
  'proposal.open-without-change':
    'A proposal is open but the code does not have its domain changes yet.',
  'proposal.origin-invalid': 'origin is not proposal-first or code-first.',
  'proposal.slug-invalid': 'The --draft-change slug is not kebab-case.',
  'proposal.status-invalid': 'status is not proposed or applied.',
  'proposal.title-missing': 'The proposal has no title.',

  // rules
  'rules.body-empty': 'A rule body is empty.',
  'rules.body-heading': 'A rule body contains a Markdown heading.',
  'rules.body-marker': 'A rule body contains a generated-block marker.',
  'rules.body-not-list': 'A rule body does not start with a list item.',
  'rules.core-key-unknown': 'A core/ rule key does not exist in the core.',
  'rules.core-paths': 'A rule that replaces a core rule declares paths.',
  'rules.dir-outside':
    'The rules folder resolves to the root or outside the project.',
  'rules.dir-unreadable': 'The rules folder cannot be read.',
  'rules.exclude-conflict':
    'rules.exclude lists a key that also has a rule file.',
  'rules.exclude-unknown': 'rules.exclude lists a key that does not exist.',
  'rules.frontmatter-invalid': 'A rule YAML frontmatter does not parse.',
  'rules.frontmatter-key-unknown':
    'A rule frontmatter has a key other than paths.',
  'rules.frontmatter-unclosed': 'A rule frontmatter is empty or never closed.',
  'rules.glob-invalid': 'A rule glob is absolute or has a ".." segment.',
  'rules.paths-invalid': 'A rule paths is not a non-empty list of globs.',

  // snapshot
  'snapshot.missing': 'No MCP snapshot exists at the expected location.',
  'snapshot.not-file': 'A snapshot source is not a regular file.',
  'snapshot.stale':
    'The MCP snapshot no longer matches code, rules, config or lock.',

  // state
  'state.change-format': 'A change number is not four digits.',
  'state.change-not-found': 'The requested change does not exist.',
  'state.cycle': 'The work item graph has a cycle.',
  'state.domain-invalid': 'The domain does not compile.',
  'state.item-not-found': 'The requested work item does not exist.',
  'state.proposals-invalid': 'One or more proposals are invalid.',

  // testing
  'testing.covers-id-invalid': 'covers() received a malformed element id.',
  'testing.covers-ids-missing': 'covers() received no ids.',

  // validate
  'validate.adapter-duplicate': 'A port already has an adapter.',
  'validate.adapter-not-extending':
    'An adapter class does not extend its port.',
  'validate.adapter-port-empty':
    'An adapter implements a port that declares no methods.',
  'validate.contains-cross-module':
    'contains cites an entity from another module.',
  'validate.contains-cycle': 'contains forms a cycle between entities.',
  'validate.contains-multiple-owners':
    'An entity is in the contains of more than one owner.',
  'validate.duplicate-id': 'Two declarations share the same id.',
  'validate.emit-undeclared':
    'A used method emits an event missing from the use-case emits.',
  'validate.emit-unreachable':
    'A use-case emits an event no used method emits.',
  'validate.invariant-id-format': 'An invariant id is not kebab-case.',
  'validate.invariant-method-misplaced':
    'An @Invariant on a non-entity class names a method.',
  'validate.invariant-method-undeclared':
    'An invariant sits on a method without @AgentMethod.',
  'validate.invariant-owner-ambiguous':
    'A class with @Invariant has more than one declaration decorator.',
  'validate.invariant-owner-missing':
    'A class with @Invariant has no declaration decorator.',
  'validate.method-entity-missing':
    'A class with @AgentMethod has no @AgentEntity.',
  'validate.method-undecorated': 'A public entity method has no @AgentMethod.',
  'validate.name-pascal-case': 'A declared class name is not PascalCase.',
  'validate.operator-approval-unknown':
    'requiresApproval cites a use-case not in useCases.',
  'validate.operator-limits-invalid': 'An operator has invalid limits.',
  'validate.operator-name-format':
    'An operator name is not kebab-case or is too long.',
  'validate.operator-usecases-empty': 'An operator has an empty useCases list.',
  'validate.port-class-missing':
    'The port class was not found in its source file.',
  'validate.port-methods-extra':
    'A port methods lists methods the class does not have as abstract.',
  'validate.port-methods-undeclared':
    'A port has abstract methods missing from methods.',
  'validate.port-not-abstract': 'A port class is not abstract.',
  'validate.port-root-not-aggregate': 'A port root is not an aggregate root.',
  'validate.port-source-unreadable': 'The port source file cannot be read.',
  'validate.references-value-object': 'references points to a value object.',
  'validate.required-empty': 'A required text field is empty.',
  'validate.transition-empty-state':
    'A transition lists an empty state in from.',
  'validate.transition-incomplete':
    'A transition lacks a non-empty from or a to.',
  'validate.transition-state-unknown':
    'A transition state is not in the entity states.',
  'validate.transition-without-states':
    'An entity has transitions but declares no states.',
  'validate.usecase-name-format': 'A use-case name is not snake_case.',
  'validate.uses-unknown': 'A use-case uses a method that does not exist.',
  'validate.value-object-base-missing':
    'A value object does not extend the core ValueObject.',
  'validate.value-object-name-collision':
    'A value object has the name of an entity.',

  // verify
  'verify.collection-error':
    'The JUnit test collection is missing, invalid or incomplete.',
  'verify.command-failed': 'A configured verify command exited non-zero.',
  'verify.covers-unknown': 'A test covers an id that does not exist.',
  'verify.criterion-manual-pending':
    'A manual acceptance criterion awaits human validation.',
  'verify.criterion-untested': 'An automatic acceptance criterion has no test.',
  'verify.docs-outdated':
    'compile --check failed without a more specific problem.',
  'verify.domain-changed-after-proposal':
    'The code has a domain change after an archived proposal.',
  'verify.domain-unanalyzable': 'The domain could not be analyzed.',
  'verify.item-dependency-not-done': 'A work item dependency is not done.',
  'verify.item-not-done': 'A work item touched by the change is not done.',
  'verify.item-not-implemented': 'A work item body is still notImplemented().',
  'verify.item-obligation-untested': 'A work item obligation has no test.',
  'verify.item-spec-hash-mismatch':
    'The spec hash differs from the current specification.',
  'verify.item-test-unsuccessful': 'A test covering a work item did not pass.',
  'verify.item-typecheck-failed': 'The typecheck command exited non-zero.',
  'verify.proposal-not-found':
    'The proposal does not exist in changes or archive.',
  'verify.rule-modified-review':
    'A test covers a modified rule and needs review.',
  'verify.rule-untested': 'A rule added or modified by the change has no test.',
  'verify.suite-failed': 'The test suite exited non-zero.',
  'verify.tactical-class-missing':
    'The class was not found in the registry or its source file.',
  'verify.tactical-foreign-child':
    'A field uses a child entity of another aggregate.',
  'verify.tactical-foreign-root':
    'A field holds the root of another aggregate.',
  'verify.tactical-source-unreadable':
    'The source file for the tactical check cannot be read.',
  'verify.tactical-vo-outside-contains':
    'A field uses a value object not in the entity contains.',
  'verify.tactical-vo-references-entity':
    'A value object field references an entity.',
  'verify.test-failed': 'A test covering a rule or criterion failed.',
  'verify.test-skipped': 'A test covering a rule or criterion was skipped.',

  // write
  'write.outdated':
    'A generated file is missing, changed, extra, mirrored wrongly or in conflict (the message gives the reason).',
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface Coded {
  readonly code: ErrorCode;
  readonly message: string;
}

// The one place that renders a coded message. The code goes at the end of the first
// line, so a wrapper error that lists nested problems below it shows its code once, up top.
export function formatCoded({ code, message }: Coded): string {
  return message.replace(/(?=\n|$)/, ` [${code}]`);
}

export class AgenticError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AgenticError';
  }
}
