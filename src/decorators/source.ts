import { dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface SourceLoc {
  readonly file: string;
  readonly line: number;
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
  // The first frame belongs to captureSource. With a source map its path
  // remains the decorator source even when import.meta.url points to a bundle.
  const ownFrame = frames
    .slice(1)
    .map(parseFrame)
    .find((loc) => loc !== null);
  const implementationDir = ownFrame ? `${dirname(ownFrame.file)}${sep}` : null;
  for (const frame of frames.slice(1)) {
    const loc = parseFrame(frame);
    if (!loc) continue;
    if (
      implementationDir &&
      loc.file.startsWith(implementationDir) &&
      !loc.file.endsWith('.test.ts')
    )
      continue;
    return loc;
  }
  return { file: '<desconhecido>', line: 0 };
}
