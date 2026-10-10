import { rm, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import { packageTransform } from './package-transform';

const root = resolve(import.meta.dir, '..');
const pkg = JSON.parse(
  await readFile(resolve(root, 'package.json'), 'utf8'),
) as { name: string };
const configPath = resolve(root, 'tsconfig.package.json');
const parsed = ts.getParsedCommandLineOfConfigFile(
  configPath,
  {},
  {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(
        ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      );
    },
  },
);
if (!parsed) throw new Error('Cannot read package tsconfig');
await rm(resolve(root, 'dist'), { recursive: true, force: true });
const program = ts.createProgram(parsed.fileNames, parsed.options);
const emitted = program.emit(undefined, undefined, undefined, undefined, {
  before: [packageTransform<ts.SourceFile>(pkg.name)],
  afterDeclarations: [packageTransform<ts.SourceFile | ts.Bundle>(pkg.name)],
});
const diagnostics = [
  ...ts.getPreEmitDiagnostics(program),
  ...emitted.diagnostics,
];
if (diagnostics.length || emitted.emitSkipped) {
  console.error(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (file) => file,
      getCurrentDirectory: () => root,
      getNewLine: () => '\n',
    }),
  );
  throw new Error('Package TypeScript build failed');
}
// Declaration maps also need embedded source because the source tree is not
// distributed. Runtime JS/maps are emitted together with matching mappings.
for await (const file of new Bun.Glob('**/*.d.ts.map').scan({
  cwd: resolve(root, 'dist'),
  onlyFiles: true,
})) {
  const path = resolve(root, 'dist', file);
  const map = JSON.parse(await readFile(path, 'utf8')) as {
    sources: string[];
    sourcesContent?: string[];
  };
  map.sourcesContent = await Promise.all(
    map.sources.map((source) =>
      readFile(resolve(dirname(path), source), 'utf8'),
    ),
  );
  await writeFile(path, JSON.stringify(map));
}
console.error('Built modular ESM package with declarations and source maps.');
