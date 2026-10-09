import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { within } from './isolation';

/** Read only a regular, bounded file in the private tree after its processes stop. */
export async function readPrivateFile(
  root: string,
  path: string,
  limit: number,
): Promise<string> {
  const boundary = await realpath(root);
  const parent = await realpath(dirname(path));
  if (!within(boundary, parent)) throw Error('Private file escapes boundary');
  const file = await open(
    join(parent, basename(path)),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > limit)
      throw Error('Private file is not regular or exceeds limit');
    // A second byte bound protects against growth after stat without unbounded readFile.
    const bytes = Buffer.alloc(limit + 1);
    let count = 0;
    while (count < bytes.length) {
      const next = await file.read(bytes, count, bytes.length - count, null);
      if (!next.bytesRead) break;
      count += next.bytesRead;
    }
    if (count > limit) throw Error('Private file exceeds limit');
    return bytes.subarray(0, count).toString('utf8');
  } finally {
    await file.close();
  }
}
