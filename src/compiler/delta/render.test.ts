import { afterAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import ts from 'typescript';
import { analyzeProject } from '../compile';
import { DEFAULT_CONVENTIONS, type ResolvedConventions } from '../conventions';
import { literal, renderDelta } from './render';
import { sampleDelta } from './sample';
import type { Delta } from './schema';

const ROOT = resolve(import.meta.dir, '../../..');
const conventions = DEFAULT_CONVENTIONS;

function render(delta: Delta, c: ResolvedConventions = conventions) {
  const r = renderDelta(delta, { conventions: c });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.files;
}

const parse = (source: string) =>
  ts.createSourceFile('x.ts', source, ts.ScriptTarget.Latest, true);

describe('literal', () => {
  const hostile = [
    "'); process.exit(); ('",
    "it's",
    'say "hi"',
    'a`b`c',
    '${1+1}',
    '$',
    '*/ evil /*',
    '// not a comment',
    'line1\nline2\r\nline3\tx',
    'a b c',
    'nul\u0000byte\u0001\u007f\u0085',
    '\\',
    "\\\\'",
    '‮RTL​﻿',
    'café \u{1f600} \ud800 lone',
    'x'.repeat(50_000),
    '',
  ];

  test.each(hostile.map((s) => [s.slice(0, 30), s] as const))(
    'round-trips %j as one string literal and nothing else',
    (_title, input) => {
      const source = `const a = ${literal(input)};\n`;
      const file = parse(source);
      expect(file.statements).toHaveLength(1);
      const decl = (file.statements[0] as ts.VariableStatement).declarationList
        .declarations[0]!;
      expect(ts.isStringLiteral(decl.initializer!)).toBe(true);
      expect((decl.initializer as ts.StringLiteral).text).toBe(input);
      // Valid source with no parse diagnostics.
      expect(
        (file as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics,
      ).toHaveLength(0);
    },
  );

  test('is pure ASCII-safe for separators and controls', () => {
    const out = literal(String.fromCharCode(0x2028, 0x2029, 0) + '\n${');
    const bad = new Set([0x2028, 0x2029]);
    expect(
      out
        .split('')
        .every((c) => c.charCodeAt(0) >= 0x20 && !bad.has(c.charCodeAt(0))),
    ).toBe(true);
    expect(out).not.toContain('${');
  });
});

describe('renderDelta with hostile client text', () => {
  test('descriptions stay strings in every emitted file', () => {
    const evil = "'); process.exit(); ('";
    const d = sampleDelta();
    d.entities[0]!.description = evil;
    d.entities[0]!.invariants[0]!.text = '${1+1} */ `x`';
    d.entities[0]!.methods[0]!.description = 'a b';
    d.entities[0]!.states = ["dra'ft", 'published'];
    d.entities[0]!.methods[1]!.transition = {
      from: ["dra'ft"],
      to: 'published',
    };
    d.valueObjects[0]!.description = evil;
    d.ports[0]!.description = evil;
    d.ports[0]!.methods[0]!.description = evil;
    d.events[0]!.description = evil;
    d.useCases[0]!.description = evil;
    d.useCases[0]!.whenToUse = evil;
    d.useCases[0]!.whenNotToUse = evil;
    for (const f of render(d)) {
      const file = parse(f.content);
      expect(
        (file as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics,
      ).toHaveLength(0);
      // Only imports, declarations and exports at the top level: no stray call statements.
      for (const s of file.statements)
        expect(ts.isExpressionStatement(s)).toBe(false);
      const strings: string[] = [];
      const walk = (n: ts.Node): void => {
        if (ts.isStringLiteral(n)) strings.push(n.text);
        ts.forEachChild(n, walk);
      };
      walk(file);
      if (f.path === 'domain/product.ts') expect(strings).toContain(evil);
    }
  });
});

describe('renderDelta output', () => {
  test('layout follows the conventions, sorted, with forward slashes', () => {
    expect(render(sampleDelta()).map((f) => f.path)).toEqual([
      'application/create-product.ts',
      'application/publish-product.ts',
      'domain/money.ts',
      'domain/product-repository.ts',
      'domain/product.events.ts',
      'domain/product.ts',
    ]);
    const custom: ResolvedConventions = {
      ...conventions,
      layers: { ...conventions.layers, domain: 'core', application: 'app' },
      suffixes: { ...conventions.suffixes, events: '-events.ts' },
    };
    expect(render(sampleDelta(), custom).map((f) => f.path)).toEqual([
      'app/create-product.ts',
      'app/publish-product.ts',
      'core/money.ts',
      'core/product-events.ts',
      'core/product-repository.ts',
      'core/product.ts',
    ]);
  });

  test('is byte-identical across runs and across input array order', () => {
    const a = JSON.stringify(render(sampleDelta()));
    expect(JSON.stringify(render(sampleDelta()))).toBe(a);
    const d = sampleDelta();
    d.entities.reverse();
    d.valueObjects.reverse();
    d.ports.reverse();
    d.ports.forEach((p) => p.methods.reverse());
    d.events.reverse();
    d.useCases.reverse();
    d.useCases.forEach((u) => {
      u.uses.reverse();
      u.emits.reverse();
      u.input.reverse();
    });
    d.entities.forEach((e) => {
      e.methods.reverse();
      e.invariants.reverse();
      e.states?.reverse();
    });
    d.valueObjects.forEach((v) => v.fields.reverse());
    expect(JSON.stringify(render(d))).toBe(a);
  });

  test('optional markers and void render as TypeScript and zod', () => {
    const files = new Map(
      render(sampleDelta()).map((f) => [f.path, f.content]),
    );
    expect(files.get('domain/product.ts')).toContain('tags?: string[]');
    expect(files.get('domain/product.ts')).toContain('publish(): void');
    expect(files.get('domain/money.ts')).toContain(
      'readonly currency?: string;',
    );
    expect(files.get('domain/product.events.ts')).toContain(
      'at: z.iso.datetime().optional()',
    );
    expect(files.get('domain/product-repository.ts')).toContain(
      'abstract save(product: Product): Promise<void>;',
    );
  });

  test('refuses a path the base already owns', () => {
    const base = {
      irVersion: 1,
      modules: [{ name: 'shop', path: 'src/shop' }],
      entities: [],
      valueObjects: [
        {
          id: 'valueobject:Other',
          name: 'Other',
          module: 'shop',
          invariants: [],
          source: 'src/shop/domain/money.ts:3',
        },
      ],
      events: [],
      useCases: [],
      operators: [],
    } as unknown as IRLike;
    const r = renderDelta(sampleDelta(), { conventions, base });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.code).toBe('delta.name-collision');
  });

  test('invalid Deltas come back as coded errors, not files', () => {
    const d = sampleDelta();
    d.entities[0]!.name = 'class';
    const r = renderDelta(d, { conventions });
    expect(r).toMatchObject({ ok: false });
  });
});

type IRLike = Parameters<typeof renderDelta>[1]['base'];

describe('renderDelta compiles', () => {
  let proj = '';
  afterAll(async () => {
    if (proj) await rm(proj, { recursive: true, force: true });
  });

  test('the rendered module loads, builds an IR and passes validation', async () => {
    await mkdir(join(ROOT, '.tmp'), { recursive: true });
    proj = await mkdtemp(join(ROOT, '.tmp', 'delta-'));
    const rel = `.tmp/${basename(proj)}/shop`;
    for (const f of render(sampleDelta())) {
      const target = join(proj, 'shop', f.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, f.content);
    }
    const configPath = join(proj, 'agentic.config.ts');
    await writeFile(
      configPath,
      `import { defineConfig } from '@agentic-ddd/compiler';
export default defineConfig({ root: '../..', modules: [{ name: 'shop', path: '${rel}' }] });
`,
    );
    const { ir, errors } = await analyzeProject({ configPath });
    expect(errors).toEqual([]);
    expect(ir.entities.map((e) => e.id)).toEqual(['entity:Product']);
    expect(ir.useCases.map((u) => u.id).sort()).toEqual([
      'usecase:create_product',
      'usecase:publish_product',
    ]);
    expect(ir.ports?.map((p) => p.id)).toEqual(['port:ProductRepository']);
    expect(ir.valueObjects?.map((v) => v.id)).toEqual(['valueobject:Money']);
    expect(ir.events.map((e) => e.id).sort()).toEqual([
      'event:ProductCreated',
      'event:ProductPublished',
    ]);
  });
});
