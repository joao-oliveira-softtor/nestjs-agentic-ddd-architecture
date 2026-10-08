import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCovers } from '@agentic-ddd/testing';

export const VERIFY_ENV = 'AGENTIC_DDD_VERIFY';

export type TestStatus = 'passed' | 'failed' | 'skipped';

export interface TestCaseResult {
  readonly name: string;
  readonly file: string;
  readonly line: number;
  readonly status: TestStatus;
  readonly covers: string[];
}

export interface TestRun {
  readonly collectionError?: string;
  readonly exitCode: number;
  readonly cases: TestCaseResult[];
}

const NAMED: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};
const TESTCASE = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
const ATTRIBUTE = /(\w+)="([^"]*)"/g;

export function unescapeXml(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
    (_match, entity: string) => {
      if (/^#x/i.test(entity))
        return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
      if (entity.startsWith('#'))
        return String.fromCodePoint(Number(entity.slice(1)));
      return NAMED[entity.toLowerCase()] ?? '';
    },
  );
}

export function parseJUnit(xml: string): TestCaseResult[] {
  const cases: TestCaseResult[] = [];
  for (const match of xml.matchAll(TESTCASE)) {
    const attributes = Object.fromEntries(
      [...match[1]!.matchAll(ATTRIBUTE)].map((a) => [
        a[1]!,
        unescapeXml(a[2]!),
      ]),
    );
    const body = match[2] ?? '';
    const status: TestStatus = /<(failure|error)\b/.test(body)
      ? 'failed'
      : /<skipped\b/.test(body)
        ? 'skipped'
        : 'passed';
    const name = attributes.name ?? '';
    cases.push({
      name,
      file: attributes.file ?? '',
      line: Number(attributes.line ?? 0),
      status,
      covers: parseCovers(name),
    });
  }
  return cases;
}

export async function runTests(
  command: readonly string[],
  cwd: string,
): Promise<TestRun> {
  const dir = await mkdtemp(join(tmpdir(), 'agentic-verify-'));
  const outfile = join(dir, 'junit.xml');
  try {
    const proc = Bun.spawn(
      [...command, '--reporter=junit', `--reporter-outfile=${outfile}`],
      {
        cwd,
        env: { ...process.env, [VERIFY_ENV]: '1' },
        stdout: 'ignore',
        stderr: 'ignore',
      },
    );
    const exitCode = await proc.exited;
    const xml = await readFile(outfile, 'utf8').catch(() => '');
    const cases = parseJUnit(xml);
    const valid =
      /<testsuites?\b/.test(xml) && /<\/testsuites?>\s*$/.test(xml.trim());
    return {
      exitCode,
      cases,
      ...(!valid
        ? {
            collectionError:
              'coleta JUnit ausente ou inválida; não é possível verificar conclusão',
          }
        : {}),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
