import { expect, test } from 'bun:test';
import ts from 'typescript';
import { packageTransform } from '../scripts/package-transform';

test('package emit rewrites public references, relative modules and generated CLI instructions before mapping', () => {
  const source = `import { Entity } from '@agentic-ddd/core';
export { main } from './cli/main';
export const instructions = 'Use @agentic-ddd/testing and bun run agentic status';
export const load = () => import('./core/index');
export const fail = () => { throw new Error('sentinel'); };
`;
  const output = ts.transpileModule(source, {
    fileName: 'fixture.ts',
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      sourceMap: true,
      inlineSources: true,
    },
    transformers: {
      before: [packageTransform<ts.SourceFile>('consumer-framework')],
    },
  });
  expect(output.outputText).toContain('consumer-framework/testing');
  expect(output.outputText).toContain('bun run agentic-ddd status');
  expect(output.outputText).toContain('./cli/main.js');
  expect(output.outputText).toContain('./core/index.js');
  expect(JSON.parse(output.sourceMapText!).sourcesContent).toEqual([source]);
});
