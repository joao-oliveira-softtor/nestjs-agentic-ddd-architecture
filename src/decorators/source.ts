import { dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface SourceLoc {
  readonly file: string;
  readonly line: number;
}

const SELF_DIR = `${dirname(fileURLToPath(import.meta.url))}${sep}`;
const FRAME = /((?:file:\/\/)?\/[^\s():]+\.[cm]?[jt]sx?):(\d+):\d+/;

function isDecoratorImplementation(file: string): boolean {
  return file.startsWith(SELF_DIR) && !file.endsWith('.test.ts');
}

export function captureSource(): SourceLoc {
  const frames = new Error().stack?.split('\n') ?? [];
  for (const frame of frames.slice(1)) {
    const match = FRAME.exec(frame);
    if (!match) continue;
    const raw = match[1]!;
    const file = raw.startsWith('file://') ? fileURLToPath(raw) : raw;
    if (isDecoratorImplementation(file)) continue;
    return { file, line: Number(match[2]) };
  }
  return { file: '<desconhecido>', line: 0 };
}
