import { readFileSync } from 'node:fs';
import ts from 'typescript';
import type { EntityRecord } from '@agentic-ddd/decorators';
import { findDecoratedClass } from '../ast';
import { aggregateRoots } from '../graph';
import { sourceOf, type IR } from '../ir';
import type { ErrorCode } from '../ir';
import type { Finding } from './gates';

export interface TacticalFinding {
  readonly code: ErrorCode;
  readonly message: string;
  readonly fix: string;
  readonly line: number;
}

// Native containers whose type arguments hold the value; user generics (Ref<Student>) do not.
const CONTAINERS = new Set([
  'Array',
  'ReadonlyArray',
  'Set',
  'ReadonlySet',
  'Map',
  'ReadonlyMap',
  'Readonly',
  'Record',
]);

export function hasTacticalElements(ir: IR): boolean {
  return (
    (ir.valueObjects ?? []).length > 0 ||
    (ir.ports ?? []).length > 0 ||
    (ir.adapters ?? []).length > 0 ||
    ir.entities.some(
      (e) => (e.contains ?? []).length > 0 || (e.references ?? []).length > 0,
    )
  );
}

// Nomes de tipo em posição de valor guardado. shortcut: alias, tipo inferido e Partial/Pick de genérico do usuário não são vistos; ver a doc do gate T.
export function typeNames(node: ts.TypeNode): string[] {
  if (ts.isTypeReferenceNode(node)) {
    const n = node.typeName;
    const name = ts.isIdentifier(n) ? n.text : n.right.text;
    return CONTAINERS.has(name)
      ? [name, ...(node.typeArguments ?? []).flatMap(typeNames)]
      : [name];
  }
  if (ts.isArrayTypeNode(node)) return typeNames(node.elementType);
  if (ts.isTypeOperatorNode(node))
    return node.operator === ts.SyntaxKind.ReadonlyKeyword
      ? typeNames(node.type)
      : [];
  if (ts.isTupleTypeNode(node)) return node.elements.flatMap(typeNames);
  if (
    ts.isNamedTupleMember(node) ||
    ts.isOptionalTypeNode(node) ||
    ts.isRestTypeNode(node) ||
    ts.isParenthesizedTypeNode(node)
  )
    return typeNames(node.type);
  if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node))
    return node.types.flatMap(typeNames);
  if (ts.isTypeLiteralNode(node))
    return node.members.flatMap((m) =>
      ts.isPropertySignature(m) && m.type ? typeNames(m.type) : [],
    );
  return [];
}

interface Field {
  readonly name: string;
  readonly type: ts.TypeNode;
  readonly node: ts.Node;
}

function fieldsOf(sf: ts.SourceFile, cls: ts.ClassDeclaration, vo: boolean) {
  const fields: Field[] = [];
  for (const m of cls.members) {
    if (ts.isPropertyDeclaration(m)) {
      const isStatic = ts
        .getModifiers(m)
        ?.some((x) => x.kind === ts.SyntaxKind.StaticKeyword);
      if (!isStatic && m.type)
        fields.push({ name: m.name.getText(sf), type: m.type, node: m });
    } else if (ts.isConstructorDeclaration(m)) {
      for (const p of m.parameters)
        if (ts.isParameterPropertyDeclaration(p, m) && p.type)
          fields.push({ name: p.name.getText(sf), type: p.type, node: p });
    }
  }
  if (vo) {
    const base = cls.heritageClauses?.find(
      (h) => h.token === ts.SyntaxKind.ExtendsKeyword,
    )?.types[0]?.typeArguments?.[0];
    if (base && ts.isTypeLiteralNode(base))
      for (const m of base.members)
        if (ts.isPropertySignature(m) && m.type)
          fields.push({ name: m.name.getText(sf), type: m.type, node: m });
  }
  return fields;
}

export function tacticalFindings(args: {
  sf: ts.SourceFile;
  cls: ts.ClassDeclaration;
  owner: string;
  kind: 'entity' | 'valueobject';
  ir: IR;
}): TacticalFinding[] {
  const { sf, cls, owner, kind, ir } = args;
  const x = owner.slice(owner.indexOf(':') + 1);
  const entities = new Map(ir.entities.map((e) => [e.name, e]));
  const vos = new Set((ir.valueObjects ?? []).map((v) => v.name));
  const roots = new Set(
    [...aggregateRoots(ir)].map((id) => id.slice('entity:'.length)),
  );
  const containsOf = (name: string): string[] =>
    (entities.get(name)?.contains ?? []).map((id) =>
      id.slice(id.indexOf(':') + 1),
    );
  const reach = (from: string): Set<string> => {
    const seen = new Set<string>([from]);
    const stack = [from];
    for (let cur = stack.pop(); cur !== undefined; cur = stack.pop())
      for (const c of containsOf(cur))
        if (!seen.has(c)) {
          seen.add(c);
          stack.push(c);
        }
    return seen;
  };
  const ownRoots = [...roots].filter((r) => reach(r).has(x));
  const aggregate = new Set(ownRoots.flatMap((r) => [...reach(r)]));
  const ownContains = new Set(containsOf(x));

  const out: TacticalFinding[] = [];
  for (const f of fieldsOf(sf, cls, kind === 'valueobject')) {
    const line = sf.getLineAndCharacterOfPosition(f.node.getStart(sf)).line + 1;
    const add = (code: ErrorCode, message: string, fix: string) =>
      out.push({ code, message, fix, line });
    for (const n of new Set(typeNames(f.type))) {
      switch (kind) {
        case 'valueobject':
          if (entities.has(n))
            add(
              'verify.tactical-vo-references-entity',
              `T2: field ${f.name} of the VO references the entity ${n}`,
              `store only the id of ${n}; if the field or prop is declared, the manager adjusts the declaration`,
            );
          break;
        case 'entity':
          if (n === x) break;
          if (entities.has(n)) {
            if (ownRoots.includes(n) || (!roots.has(n) && aggregate.has(n)))
              break;
            if (roots.has(n))
              add(
                'verify.tactical-foreign-root',
                `T1: field ${f.name} holds the root ${n} of another aggregate`,
                `store only the id of ${n} (primitive id or id VO in the contains of ${x}); if the field is declared, the manager adjusts the declaration`,
              );
            else
              add(
                'verify.tactical-foreign-child',
                `T3: field ${f.name} uses ${n}, a child of another aggregate`,
                `store only the id of ${n} or go through its root; if the field is declared, the manager adjusts the declaration`,
              );
          } else if (vos.has(n) && !ownContains.has(n))
            add(
              'verify.tactical-vo-outside-contains',
              `T3: field ${f.name} uses the VO ${n} outside the contains of ${x}`,
              `declare ${n} in the contains of ${x} or change the field type; both are declarations, adjusted by the manager`,
            );
          break;
        default:
          throw new Error(`Unhandled case: ${String(kind satisfies never)}`);
      }
    }
  }
  return out.sort(
    (a, b) =>
      a.line - b.line ||
      (a.message < b.message ? -1 : a.message > b.message ? 1 : 0),
  );
}

export function tacticalGate(args: {
  ir: IR;
  record: Pick<EntityRecord, 'target' | 'source'>;
  root: string;
  owner: string;
  kind: 'entity' | 'valueobject';
}): Finding[] {
  const { ir, record, root, owner, kind } = args;
  const name = record.target.name;
  const source = sourceOf(root, record.source);
  const failClosed = (code: ErrorCode, message: string): Finding[] => [
    { code, message, fix: 'check the decorator on the source line', source },
  ];
  let sf: ts.SourceFile;
  try {
    sf = ts.createSourceFile(
      record.source.file,
      readFileSync(record.source.file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
  } catch (e) {
    const why =
      (e as NodeJS.ErrnoException).code ??
      (e instanceof Error ? e.message : String(e));
    return failClosed(
      'verify.tactical-source-unreadable',
      `T: could not read ${source.split(':')[0]}: ${why}`,
    );
  }
  const cls = findDecoratedClass(sf, record.source.line, name);
  if (cls === null)
    return failClosed(
      'verify.tactical-class-missing',
      `T: class ${name} not found in ${source}`,
    );
  return tacticalFindings({ sf, cls, owner, kind, ir }).map((f) => ({
    code: f.code,
    message: f.message,
    fix: f.fix,
    source: sourceOf(root, { file: record.source.file, line: f.line }),
  }));
}
