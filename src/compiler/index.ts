export { analyze } from './analyze.js';
export { byId, canonicalize, sha256, stableStringify } from './canonical.js';
export { compile, type CompileOptions, type CompileResult } from './compile.js';
export {
  defineConfig,
  loadConfig,
  resolveConfig,
  type AgenticConfig,
  type ModuleConfig,
  type ResolvedConfig,
} from './config.js';
export { itemOfMethod, workItems, type Layer, type WorkItem } from './graph.js';
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
} from './ir.js';
export {
  approxTokens,
  lintRendered,
  lintSkill,
  type LintFinding,
} from './lint.js';
export { formatReport } from './report.js';
export {
  DEFAULT_OUT,
  renderAll,
  type OutputPaths,
  type Rendered,
} from './render/index.js';
export { checkOutputs, writeOutputs, type Drift } from './write.js';
