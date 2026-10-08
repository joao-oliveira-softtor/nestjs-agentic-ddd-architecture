import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { MOTIVO_PLACEHOLDER, compile } from '@agentic-ddd/compiler';

export const ROOT_CONFIG = resolve(import.meta.dir, '../../agentic.config.ts');

export async function bootstrapChanges(
  out: string,
  configPath = ROOT_CONFIG,
): Promise<void> {
  const draft = await compile({
    configPath,
    outRoot: out,
    mode: 'write',
    draftChange: 'estado-inicial',
  });
  if (!draft.drafted)
    throw new Error('bootstrapChanges: o rascunho não foi criado');
  const path = join(out, draft.drafted);
  await writeFile(
    path,
    (await readFile(path, 'utf8')).replace(
      MOTIVO_PLACEHOLDER,
      'Estado inicial do domínio.',
    ),
  );
  const applied = await compile({ configPath, outRoot: out, mode: 'write' });
  if (applied.applied !== '0001')
    throw new Error(
      `bootstrapChanges: 0001 não foi aplicada (${applied.pending.join('; ')})`,
    );
}
