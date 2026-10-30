import { open } from 'node:fs/promises';
import { sha256, stableStringify } from './canonical';
import {
  DEFAULT_CONVENTIONS,
  isResolvedConventions,
  type ResolvedConventions,
} from './conventions';
import { AgenticError } from './ir';
import { parseLock, type DomainLock } from './lock';
import type { Rule } from './rules';

export const PUBLISHED_LOCK_VERSION = 1;

const MAX_BYTES = 32 * 1024 * 1024;
const MAX_VERSION_LENGTH = 64;

export interface PublishedLock {
  readonly publishedLockVersion: 1;
  readonly version: string;
  readonly digest: string;
  readonly lock: DomainLock;
  readonly rules: Rule[];
  readonly conventions: ResolvedConventions;
}

function digestOf(
  version: string,
  lock: DomainLock,
  rules: Rule[],
  conventions: ResolvedConventions,
): string {
  return sha256(stableStringify({ version, lock, rules, conventions }));
}

function checkVersion(version: string, displayPath: string): void {
  if (
    version.length === 0 ||
    version.length > MAX_VERSION_LENGTH ||
    // Controls (C0, DEL, C1) and bidi marks/overrides/isolates spoof a label in logs and UIs.
    // oxlint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f-\u009f؜‎‏‪-‮⁦-⁩]/.test(version)
  ) {
    throw new AgenticError(
      'published.version-invalid',
      `${displayPath}: version must be 1-${MAX_VERSION_LENGTH} characters with no control characters; choose another label`,
    );
  }
}

export function createPublishedLock(
  version: string,
  lock: DomainLock,
  rules: Rule[],
  conventions: ResolvedConventions = DEFAULT_CONVENTIONS,
): PublishedLock {
  checkVersion(version, 'published lock');
  return {
    publishedLockVersion: PUBLISHED_LOCK_VERSION,
    version,
    digest: digestOf(version, lock, rules, conventions),
    lock,
    rules,
    conventions,
  };
}

export function serializePublishedLock(published: PublishedLock): string {
  return stableStringify(published);
}

export function parsePublishedLock(
  text: string,
  displayPath: string,
  expectDigest?: string,
): PublishedLock {
  const malformed = (why: string): AgenticError =>
    new AgenticError(
      'published.malformed',
      `${displayPath}: invalid published lock (${why}); republish it with \`agentic-ddd publish-lock\``,
    );
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw malformed('malformed JSON');
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data))
    throw malformed('not an object');
  const obj = data as Record<string, unknown>;
  if (obj.publishedLockVersion !== PUBLISHED_LOCK_VERSION) {
    throw new AgenticError(
      'published.version-unsupported',
      `${displayPath}: publishedLockVersion ${JSON.stringify(obj.publishedLockVersion)} is not supported (expected ${PUBLISHED_LOCK_VERSION}); update @agentic-ddd or republish it`,
    );
  }
  if (typeof obj.version !== 'string')
    throw malformed('version is not a string');
  checkVersion(obj.version, displayPath);
  if (typeof obj.digest !== 'string' || !/^[0-9a-f]{64}$/.test(obj.digest))
    throw malformed('digest is not 64 lowercase hex characters');
  if (!Array.isArray(obj.rules)) throw malformed('rules is not a list');
  if (!isResolvedConventions(obj.conventions))
    throw malformed('conventions is missing or malformed');
  if (
    obj.lock === null ||
    typeof obj.lock !== 'object' ||
    Array.isArray(obj.lock)
  ) {
    throw malformed('the artifact has no lock');
  }
  obj.rules.forEach((rule, i) => {
    const r = rule as Record<string, unknown> | null;
    if (r === null || typeof r !== 'object' || Array.isArray(r))
      throw malformed(`rules[${i}] is not an object`);
    if (typeof r.key !== 'string') throw malformed(`rules[${i}].key`);
    if (typeof r.body !== 'string') throw malformed(`rules[${i}].body`);
    if (r.file !== null && typeof r.file !== 'string')
      throw malformed(`rules[${i}].file`);
    if (
      r.paths !== null &&
      !(Array.isArray(r.paths) && r.paths.every((g) => typeof g === 'string'))
    )
      throw malformed(`rules[${i}].paths`);
  });
  let lock: DomainLock;
  try {
    lock = parseLock(JSON.stringify(obj.lock), displayPath);
  } catch (error) {
    if (!(error instanceof AgenticError)) throw error;
    throw new AgenticError(
      'published.malformed',
      `${displayPath}: the embedded lock is invalid (${error.code}); regenerate the artifact with \`agentic-ddd publish-lock\``,
    );
  }
  const ir = lock.ir as unknown as Record<string, unknown[]>;
  const shapes: [string, string[]][] = [
    ['modules', ['name', 'path']],
    ['entities', ['id', 'module']],
    ['events', ['id', 'module']],
    ['useCases', ['id', 'module']],
    ['operators', ['id', 'module']],
  ];
  for (const [list, fields] of shapes) {
    ir[list]!.forEach((el, i) => {
      const e = el as Record<string, unknown> | null;
      if (e === null || typeof e !== 'object' || Array.isArray(e))
        throw malformed(`${list}[${i}] is not an object`);
      for (const f of fields)
        if (typeof e[f] !== 'string') throw malformed(`${list}[${i}].${f}`);
    });
  }
  const rules = obj.rules as Rule[];
  const conventions = obj.conventions;
  if (digestOf(obj.version, lock, rules, conventions) !== obj.digest) {
    throw new AgenticError(
      'published.digest-mismatch',
      `${displayPath}: content does not match its embedded digest (edited or corrupted); republish it or restore it from its source`,
    );
  }
  if (expectDigest !== undefined && expectDigest.toLowerCase() !== obj.digest) {
    throw new AgenticError(
      'published.digest-unexpected',
      `${displayPath}: digest ${obj.digest} is not the expected ${expectDigest.toLowerCase()}; fetch the published lock that matches the pinned digest`,
    );
  }
  return {
    publishedLockVersion: PUBLISHED_LOCK_VERSION,
    version: obj.version,
    digest: obj.digest,
    lock,
    rules,
    conventions,
  };
}

const tooBig = (displayPath: string): AgenticError =>
  new AgenticError(
    'published.malformed',
    `${displayPath}: not a regular file or larger than ${MAX_BYTES / 1024 / 1024} MiB; republish it`,
  );

export async function readPublishedLock(
  absolutePath: string,
  displayPath: string,
  expectDigest?: string,
): Promise<PublishedLock> {
  let text: string;
  try {
    const handle = await open(absolutePath, 'r');
    try {
      // One handle for stat and read: the file cannot change type between the check and the read.
      const info = await handle.stat();
      if (!info.isFile() || info.size > MAX_BYTES) throw tooBig(displayPath);
      const buffer = Buffer.alloc(MAX_BYTES + 1);
      let length = 0;
      for (;;) {
        const { bytesRead } = await handle.read(
          buffer,
          length,
          buffer.length - length,
          null,
        );
        if (bytesRead === 0) break;
        length += bytesRead;
      }
      if (length > MAX_BYTES) throw tooBig(displayPath);
      text = buffer.toString('utf8', 0, length);
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof AgenticError) throw error;
    throw new AgenticError(
      'published.unreadable',
      `${displayPath}: cannot read the published lock; check that the file exists and is readable`,
    );
  }
  return parsePublishedLock(text, displayPath, expectDigest);
}
