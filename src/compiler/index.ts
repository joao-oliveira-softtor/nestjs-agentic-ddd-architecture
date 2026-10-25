export { analyze } from './analyze';
export { byId, canonicalize, sha256, stableStringify } from './canonical';
export {
  EMPTY_IR,
  contentHash,
  elementsOf,
  semanticDiff,
  type ChangeKind,
  type Classification,
  type DiffItem,
  type DomainElement,
  type ElementKind,
} from './diff';
export {
  analyzeProject,
  compile,
  type CompileOptions,
  type CompileResult,
  type ProjectAnalysis,
} from './compile';
export {
  DEFAULT_CONVENTIONS,
  DEFAULT_RULES_MAX_TOKENS,
  defineConfig,
  loadConfig,
  resolveConfig,
  type AgenticConfig,
  type ConventionLayer,
  type ConventionsConfig,
  type ImportTarget,
  type ModuleConfig,
  type ResolvedConfig,
  type ResolvedConventions,
} from './config';
export { itemOfMethod, workItems, type Layer, type WorkItem } from './graph';
export {
  buildIR,
  irHash,
  type CompileError,
  type IR,
  type IREntity,
  type IRValueObject,
  type IREvent,
  type IRPort,
  type IRAdapter,
  type IRInvariant,
  type IRMethod,
  type IRModule,
  type IROperator,
  type IRUseCase,
  type JsonSchema,
} from './ir';
export {
  approxTokens,
  lintRendered,
  lintSkill,
  type LintFinding,
} from './lint';
export { formatReport } from './report';
export {
  DEFAULT_OUT,
  renderAll,
  type OutputPaths,
  type RenderOptions,
  type Rendered,
} from './render/index';
export { checkOutputs, writeOutputs, type Drift } from './write';
export {
  LOCK_VERSION,
  parseLock,
  readLock,
  serializeLock,
  type DomainLock,
  type LockChange,
} from './lock';
export {
  ELEMENT_ID,
  MOTIVO_PLACEHOLDER,
  listProposals,
  parseProposal,
  type AcceptanceCriterion,
  type Delta,
  type Proposal,
} from './changes/proposal';
export {
  archivedPathOf,
  deltaProblems,
  reconcile,
  type ReconcileInput,
  type ReconcilePlan,
} from './changes/reconcile';
export { archiveProposal } from './changes/apply';
export { writeDraft } from './changes/draft';
export { verify, type VerifyOptions } from './verify/index';
export {
  evaluateGates,
  type Finding,
  type GateResult,
  type VerifyReport,
  type VerifyStatus,
} from './verify/gates';
export {
  VERIFY_ENV,
  parseJUnit,
  runTests,
  type TestCaseResult,
  type TestRun,
} from './verify/test-run';
export type { VerifyConfig } from './config';
export { status, next, type StatusOptions } from './project-state';
export type {
  WorkItemStatus,
  ProjectStatus,
  NextReport,
  BaseState,
} from './state';
export { packet, type PacketOptions } from './packet';
export {
  verifyItem,
  type ItemVerifyOptions,
  type ItemVerifyReport,
} from './verify/item';
export {
  CORE_RULES,
  RuleError,
  briefRules,
  composeRules,
  fillMarkers,
  loadRules,
  ruleHash,
  rulesFor,
  type Rule,
} from './rules';
