import ts from 'typescript';

/** Rewrite at the AST level so TypeScript emits matching source maps. */
export function packageTransform<T extends ts.Node>(
  name: string,
): ts.TransformerFactory<T> {
  return (context) => {
    const textOf = (text: string) =>
      text
        .replace(
          /@agentic-ddd\/(core|decorators|compiler|runtime|nestjs|testing)\b/g,
          `${name}/$1`,
        )
        .replace(/\bbun run agentic\b/g, 'bun run agentic-ddd');
    const moduleOf = (text: string) => {
      const rewritten = textOf(text);
      return rewritten.startsWith('.') && !/\.[cm]?js$/.test(rewritten)
        ? `${rewritten}.js`
        : rewritten;
    };
    const string = (node: ts.StringLiteral, module = false) =>
      ts.setTextRange(
        ts.setOriginalNode(
          context.factory.createStringLiteral(
            module ? moduleOf(node.text) : textOf(node.text),
          ),
          node,
        ),
        node,
      );
    const visit: ts.Visitor = (node) => {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        return context.factory.updateImportDeclaration(
          node,
          node.modifiers,
          node.importClause,
          string(node.moduleSpecifier, true),
          node.attributes,
        );
      if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        return context.factory.updateExportDeclaration(
          node,
          node.modifiers,
          node.isTypeOnly,
          node.exportClause,
          string(node.moduleSpecifier, true),
          node.attributes,
        );
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        return context.factory.updateCallExpression(
          node,
          node.expression,
          node.typeArguments,
          [string(node.arguments[0], true), ...node.arguments.slice(1)],
        );
      if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteral(node.argument.literal)
      )
        return context.factory.updateImportTypeNode(
          node,
          context.factory.updateLiteralTypeNode(
            node.argument,
            string(node.argument.literal, true),
          ),
          node.attributes,
          node.qualifier,
          node.typeArguments,
          node.isTypeOf,
        );
      if (ts.isStringLiteral(node) && textOf(node.text) !== node.text)
        return string(node);
      if (
        ts.isNoSubstitutionTemplateLiteral(node) &&
        textOf(node.text) !== node.text
      )
        return ts.setTextRange(
          ts.setOriginalNode(
            context.factory.createNoSubstitutionTemplateLiteral(
              textOf(node.text),
            ),
            node,
          ),
          node,
        );
      return ts.visitEachChild(node, visit, context);
    };
    return (node) => ts.visitNode(node, visit) as T;
  };
}
