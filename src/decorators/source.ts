import { dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface SourceLoc {
  readonly file: string;
  readonly line: number;
}

const SELF_DIR = `${dirname(fileURLToPath(import.meta.url))}${sep}`;

function isDecoratorImplementation(file: string): boolean {
  return file.startsWith(SELF_DIR) && !file.endsWith('.test.ts');
}

export function parseFrame(line: string): SourceLoc | null {
  // Regex anchored at END: matches both formats
  // - at <anything> (PATH:L:C)
  // - at PATH:L:C
  const FRAME = /(?:\(|at )((?:file:\/\/)?\/.+?):(\d+):\d+\)?$/;
  const trimmed = line.trim();
  const match = FRAME.exec(trimmed);
  if (!match) return null;

  const raw = match[1]!;
  const file = raw.startsWith('file://') ? fileURLToPath(raw) : raw;
  const lineNum = Number(match[2])!;

  return { file, line: lineNum };
}

export function captureSource(): SourceLoc {
  const frames = new Error().stack?.split('\n') ?? [];
  for (const frame of frames.slice(1)) {
    const loc = parseFrame(frame);
    if (!loc) continue;
    if (isDecoratorImplementation(loc.file)) continue;
    return loc;
  }
  return { file: '<desconhecido>', line: 0 };
}
