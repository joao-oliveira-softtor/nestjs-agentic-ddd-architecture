import { readFile, stat } from 'node:fs/promises';
import { sha256, stableStringify } from './canonical';
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
}

function digestOf(lock: DomainLock, rules: Rule[]): string {
  return sha256(stableStringify({ lock, rules }));
}

function checkVersion(version: string, displayPath: string): void {
  if (
    version.length === 0 ||
    version.length > MAX_VERSION_LENGTH ||
    Array.from(version).some((c) => c < ' ' || c === '\u007f')
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
): PublishedLock {
  checkVersion(version, 'published lock');
  return {
    publishedLockVersion: PUBLISHED_LOCK_VERSION,
    version,
    digest: digestOf(lock, rules),
    lock,
    rules,
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
      `${displayPath}: invalid published lock (${why}); republish it with \`agentic publish\``,
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
  const lock = parseLock(JSON.stringify(obj.lock), displayPath);
  const rules = obj.rules as Rule[];
  if (digestOf(lock, rules) !== obj.digest) {
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
  };
}

export async function readPublishedLock(
  absolutePath: string,
  displayPath: string,
  expectDigest?: string,
): Promise<PublishedLock> {
  let text: string;
  try {
    const info = await stat(absolutePath);
    if (!info.isFile() || info.size > MAX_BYTES) {
      throw new AgenticError(
        'published.malformed',
        `${displayPath}: not a regular file or larger than ${MAX_BYTES / 1024 / 1024} MiB; republish it`,
      );
    }
    text = await readFile(absolutePath, 'utf8');
  } catch (error) {
    if (error instanceof AgenticError) throw error;
    throw new AgenticError(
      'published.unreadable',
      `${displayPath}: cannot read the published lock; check that the file exists and is readable`,
    );
  }
  return parsePublishedLock(text, displayPath, expectDigest);
}
