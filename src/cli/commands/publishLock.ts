import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  createPublishedLock,
  serializePublishedLock,
} from '../../compiler/published';
import { checkSnapshot } from '../../compiler/snapshot';
import { formatCoded } from '../../contracts/codes';
import { parseArgs } from '../args';
import { USAGE } from '../usage';

export async function publishLockCommand(
  args: readonly string[],
): Promise<number> {
  const parsed = parseArgs(args, {
    booleans: [],
    values: ['--version', '--out', '--root'],
    positionals: 0,
  });
  if (typeof parsed === 'string') {
    console.error(`${parsed}\n${USAGE}`);
    return 2;
  }
  const version = parsed.values.get('--version');
  const out = parsed.values.get('--out');
  if (version === undefined || out === undefined) {
    console.error(`publish-lock needs --version and --out\n${USAGE}`);
    return 2;
  }
  const snap = await checkSnapshot(
    resolve(parsed.values.get('--root') ?? process.cwd()),
  );
  if (!snap.ok) {
    console.error(formatCoded({ code: snap.code, message: snap.reason }));
    return 1;
  }
  const published = createPublishedLock(version, snap.lock, snap.rules);
  const file = resolve(out);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, serializePublishedLock(published));
  console.log(`published lock ${published.version} digest ${published.digest}`);
  return 0;
}
