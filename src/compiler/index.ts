export { analyze } from './analyze';
export { byId, canonicalize, sha256, stableStringify } from './canonical';
export { compile, type CompileOptions, type CompileResult } from './compile';
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
