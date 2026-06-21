// src/graph/parse/typescript.ts
// Accurate exports/imports for TS/JS via the TypeScript compiler API (already a
// dependency). Replaces the regex heuristic with real AST analysis. Synchronous
// and dependency-bundle-safe (esbuild bundles `typescript`), so it works in both
// the CLI and the VS Code extension.

import ts from "typescript";
import type { Facts } from "./facts.js";

function scriptKind(filePath: string): ts.ScriptKind {
  if (filePath.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (filePath.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (filePath.endsWith(".js") || filePath.endsWith(".mjs") || filePath.endsWith(".cjs")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function hasExportModifier(node: ts.Node): boolean {
  const mods = (ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined) ?? [];
  return mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

// External specifier → base package name (@scope/pkg or pkg); relative kept as-is.
function normalizeImport(spec: string): string {
  if (spec.startsWith(".") || spec.startsWith("/")) return spec;
  return spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
}

export function extractTsFacts(content: string, filePath: string): Facts {
  const exports = new Set<string>();
  const imports = new Set<string>();

  const sf = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, scriptKind(filePath));

  const addImport = (spec: string | undefined) => {
    if (spec) imports.add(normalizeImport(spec));
  };

  const visit = (node: ts.Node): void => {
    // import ... from "x"  /  export ... from "x" (re-export is also a dependency)
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      addImport(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        addImport(node.moduleSpecifier.text);
      }
      // export { a, b } / export { a as b } from "..."
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const el of node.exportClause.elements) exports.add(el.name.text);
      }
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const expr = node.moduleReference.expression;
      if (ts.isStringLiteral(expr)) addImport(expr.text);
    } else if (ts.isExportAssignment(node)) {
      exports.add("default"); // export default / export =
    }

    // CommonJS: require("x")
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require") {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg)) addImport(arg.text);
    }

    // CommonJS exports: module.exports = …, module.exports.x = …, exports.x = …
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left)) {
      const lhs = node.left;
      if (ts.isIdentifier(lhs.expression) && lhs.expression.text === "module" && lhs.name.text === "exports") {
        // module.exports = …  (name the function/class if it has one, else default)
        const rhs = node.right;
        if ((ts.isFunctionExpression(rhs) || ts.isClassExpression(rhs)) && rhs.name) exports.add(rhs.name.text);
        else exports.add("default");
      } else if (ts.isIdentifier(lhs.expression) && lhs.expression.text === "exports") {
        // exports.foo = …
        exports.add(lhs.name.text);
      } else if (
        ts.isPropertyAccessExpression(lhs.expression) &&
        ts.isIdentifier(lhs.expression.expression) &&
        lhs.expression.expression.text === "module" &&
        lhs.expression.name.text === "exports"
      ) {
        // module.exports.foo = …
        exports.add(lhs.name.text);
      }
    }

    // Named declarations carrying an `export` modifier
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node)
    ) {
      if (hasExportModifier(node)) {
        const isDefault = (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
        if (isDefault) exports.add("default");
        else if (node.name) exports.add(node.name.text);
      }
    } else if (ts.isVariableStatement(node) && hasExportModifier(node)) {
      // export const a = …, b = …
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) exports.add(decl.name.text);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sf);
  return { exports: [...exports], imports: [...imports] };
}
