import ts from 'typescript';

// Acha a ClassDeclaration pelo nome e pelo decorator que começa na linha do source; null se não achar.
export function findDecoratedClass(
  sf: ts.SourceFile,
  line: number,
  name: string,
): ts.ClassDeclaration | null {
  const visit = (node: ts.Node): ts.ClassDeclaration | undefined => {
    if (
      ts.isClassDeclaration(node) &&
      node.name?.text === name &&
      (ts.getDecorators(node) ?? []).some(
        (d) =>
          sf.getLineAndCharacterOfPosition(d.expression.getStart(sf)).line +
            1 ===
          line,
      )
    )
      return node;
    return ts.forEachChild(node, visit);
  };
  return visit(sf) ?? null;
}
