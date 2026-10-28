import { realpathSync } from 'node:fs';
import { basename, dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface SourceLoc {
  readonly file: string;
  readonly line: number;
}

const canonical = new Map<string, string>();

/**
 * Expande nomes 8.3 do Windows (RUNNER~1): o mesmo arquivo aparece com o nome curto ou o
 * longo conforme o caminho de carga e a versão do Bun. Só caminhos com `~` passam pelo
 * realpath, para não trocar drive `subst`/mapeado pelo destino. Fora do Windows, identidade.
 */
export function canonicalPath(path: string): string {
  if (process.platform !== 'win32' || !path.includes('~')) return path;
  let result = canonical.get(path);
  if (result === undefined) {
    try {
      result = realpathSync.native(path);
    } catch {
      // Caminho que (ainda) não existe: expande o diretório existente mais próximo.
      const parent = dirname(path);
      result =
        parent === path ? path : join(canonicalPath(parent), basename(path));
    }
    canonical.set(path, result);
  }
  return result;
}

export function parseFrame(line: string): SourceLoc | null {
  // Regex anchored at END: matches both formats
  // - at <anything> (PATH:L:C)
  // - at PATH:L:C
  // PATH: POSIX (/), Windows drive (C:\ or C:/), UNC (\\server) or file:// URL.
  const FRAME =
    /(?:\(|at )((?:file:\/\/)?(?:\/|[A-Za-z]:[\\/]|\\\\).+?):(\d+):\d+\)?$/;
  const trimmed = line.trim();
  const match = FRAME.exec(trimmed);
  if (!match) return null;

  const raw = match[1]!;
  // A URL com letra de unidade é do Windows em qualquer SO onde o frame for lido.
  const file = raw.startsWith('file://')
    ? fileURLToPath(raw, { windows: /^file:\/\/\/[A-Za-z]:/.test(raw) })
    : raw;
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
    // Uma forma só por arquivo: raízes também passam por canonicalPath.
    return { file: canonicalPath(loc.file), line: loc.line };
  }
  return { file: '<desconhecido>', line: 0 };
}
