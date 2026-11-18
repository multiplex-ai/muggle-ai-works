import { readFileSync } from "fs";
import { relative } from "path";
import ts from "typescript";
import { CHILD_PROCESS_MODULES, REPO_ROOT, SPAWNING_FUNCTIONS } from "./constants.js";
import type { UnhiddenSpawnCall } from "./types.js";

function parseSource(fileName: string, sourceText: string): ts.SourceFile {
  return ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true);
}

function hasInlineWindowsHide(argument: ts.Expression): boolean {
  if (!ts.isObjectLiteralExpression(argument)) return false;
  return argument.properties.some(
    (property) =>
      ts.isPropertyAssignment(property) &&
      property.name.getText() === "windowsHide" &&
      property.initializer.kind === ts.SyntaxKind.TrueKeyword,
  );
}

function isChildProcessRequire(expression: ts.Expression): boolean {
  return (
    ts.isCallExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "require" &&
    expression.arguments.length === 1 &&
    ts.isStringLiteral(expression.arguments[0]) &&
    CHILD_PROCESS_MODULES.includes(expression.arguments[0].text)
  );
}

function isPromisifyCallee(callee: ts.Expression): boolean {
  return (
    (ts.isIdentifier(callee) && callee.text === "promisify") ||
    (ts.isPropertyAccessExpression(callee) && callee.name.text === "promisify")
  );
}

function forEachDescendant(root: ts.Node, onNode: (node: ts.Node) => void): void {
  const visit = (node: ts.Node): void => {
    onNode(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
}

/**
 * child_process calls in one source whose arguments include no object literal carrying `windowsHide: true`.
 * Follows named imports under any alias, namespace or default imports of the module, `require` of it in either
 * form, and `promisify` wrappers of its functions, whose callers must then pass the option themselves.
 * @param fileName - Path reported for each finding.
 * @param sourceText - The file's contents.
 * @returns One entry per offending call, in source order.
 */
export function findUnhiddenSpawnCalls(fileName: string, sourceText: string): UnhiddenSpawnCall[] {
  const sourceFile = parseSource(fileName, sourceText);
  const spawningLocalNames = new Set<string>();
  const moduleNamespaceNames = new Set<string>();
  forEachDescendant(sourceFile, (node) => {
    if (!ts.isVariableDeclaration(node) || !node.initializer || !isChildProcessRequire(node.initializer)) return;
    if (ts.isIdentifier(node.name)) moduleNamespaceNames.add(node.name.text);
    if (!ts.isObjectBindingPattern(node.name)) return;
    for (const element of node.name.elements) {
      const importedName = (element.propertyName ?? element.name).getText();
      if (ts.isIdentifier(element.name) && SPAWNING_FUNCTIONS.includes(importedName)) {
        spawningLocalNames.add(element.name.text);
      }
    }
  });
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (!CHILD_PROCESS_MODULES.includes(statement.moduleSpecifier.text)) continue;
    const importClause = statement.importClause;
    if (!importClause || importClause.isTypeOnly) continue;
    if (importClause.name) moduleNamespaceNames.add(importClause.name.text);
    const bindings = importClause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) moduleNamespaceNames.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        const importedName = (element.propertyName ?? element.name).text;
        if (!element.isTypeOnly && SPAWNING_FUNCTIONS.includes(importedName)) spawningLocalNames.add(element.name.text);
      }
    }
  }

  const isSpawningCallee = (callee: ts.Expression): boolean =>
    (ts.isIdentifier(callee) && spawningLocalNames.has(callee.text)) ||
    (ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      moduleNamespaceNames.has(callee.expression.text) &&
      SPAWNING_FUNCTIONS.includes(callee.name.text));

  forEachDescendant(sourceFile, (node) => {
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || !node.initializer) return;
    const initializer = node.initializer;
    const isPromisifiedSpawner =
      ts.isCallExpression(initializer) &&
      isPromisifyCallee(initializer.expression) &&
      initializer.arguments.some(isSpawningCallee);
    if (isPromisifiedSpawner) spawningLocalNames.add(node.name.text);
  });

  const unhiddenCalls: UnhiddenSpawnCall[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isSpawningCallee(node.expression) && !node.arguments.some(hasInlineWindowsHide)) {
      unhiddenCalls.push({
        file: fileName,
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        callee: node.expression.getText(),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return unhiddenCalls;
}

/**
 * Scans files on disk, reporting each finding by repository-relative path.
 * @param filePaths - Absolute paths to scan.
 * @returns Every unhidden child_process call across the files.
 */
export function findUnhiddenSpawnCallsInFiles(filePaths: string[]): UnhiddenSpawnCall[] {
  return filePaths.flatMap((filePath) =>
    findUnhiddenSpawnCalls(relative(REPO_ROOT, filePath).replaceAll("\\", "/"), readFileSync(filePath, "utf-8")),
  );
}
