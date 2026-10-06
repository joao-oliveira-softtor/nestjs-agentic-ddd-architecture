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
  defineConfig,
  loadConfig,
  resolveConfig,
  type AgenticConfig,
  type ModuleConfig,
  type ResolvedConfig,
} from './config';
export { itemOfMethod, workItems, type Layer, type WorkItem } from './graph';
export {
  buildIR,
  irHash,
  type CompileError,
  type IR,
  type IREntity,
  type IREvent,
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
