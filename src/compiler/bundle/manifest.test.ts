import { describe, expect, test } from 'bun:test';
import { sha256 } from '../canonical';
import { buildManifest } from './manifest';

const input = {
  baseRef: 'abc',
  baseLockHash: 'def',
  layers: {
    target: {
      name: 'nestjs-ts' as const,
      waves: [],
      items: [],
      skeleton: [],
    },
    neutral: {
      model: 'neutral/model.json',
      readme: 'neutral/README.md',
      briefs: [],
    },
  },
  examples: [],
};
const file = (path: string) => ({ path, content: `text of ${path}\r\n` });

describe('buildManifest', () => {
  test('lists the files by path with the hash of their content, whatever the order they come in', () => {
    const files = ['b/x.md', 'a/z.md', 'a/y.md'].map(file);
    const manifest = buildManifest(input, files);
    expect(manifest.files).toEqual(
      ['a/y.md', 'a/z.md', 'b/x.md'].map((path) => ({
        path,
        sha256: sha256(file(path).content),
      })),
    );
    expect(buildManifest(input, [...files].reverse()).hash).toBe(manifest.hash);
  });

  test('the hash covers the files and the other fields', () => {
    const a = buildManifest(input, [file('a.md')]);
    expect(buildManifest(input, [file('b.md')]).hash).not.toBe(a.hash);
    expect(
      buildManifest({ ...input, baseRef: 'other' }, [file('a.md')]).hash,
    ).not.toBe(a.hash);
  });
});
