import { existsSync, readFileSync } from "fs";
import { dirname, relative, resolve } from "path";
import ts from "typescript";
import { CHILD_PROCESS_MODULES, REPO_ROOT, SPAWNING_FUNCTIONS } from "./constants.js";
import type { UnhiddenSpawnCall } from "./types.js";

function parseSource(fileName: string, sourceText: string): ts.SourceFile {
  return ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true);
}

function relativeImportTargets(sourceFile: ts.SourceFile): string[] {
  const specifiers: string[] = [];
  for (const statement of sourceFile.statements) {
    const isModuleReference = ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement);
    const specifier = isModuleReference ? statement.moduleSpecifier : undefined;
    if (specifier && ts.isStringLiteral(specifier) && specifier.text.startsWith(".")) {
      specifiers.push(specifier.text);
    }
  }
  return specifiers;
}

// NodeNext sources import "./x.js" for a file that is "./x.ts" on disk.
function resolveImportedFile(importerPath: string, specifier: string): string | null {
  const imported = resolve(dirname(importerPath), specifier);
  const asTypeScript = imported.replace(/\.js$/, ".ts");
  if (existsSync(asTypeScript)) return asTypeScript;
  return existsSync(imported) ? imported : null;
}

/**
 * Every file reachable from the given entry files through relative imports and re-exports.
 * @param entryFiles - Absolute paths to start from.
 * @returns Absolute paths, entries included, each once.
 */
export function reachableSourceFiles(entryFiles: string[]): string[] {
  const visited = new Set<string>();
  const pending = [...entryFiles];
  while (pending.length > 0) {
    const filePath = pending.pop() as string;
    if (visited.has(filePath)) continue;
    visited.add(filePath);
    const sourceFile = parseSource(filePath, readFileSync(filePath, "utf-8"));
    for (const specifier of relativeImportTargets(sourceFile)) {
      const importedFile = resolveImportedFile(filePath, specifier);
      if (importedFile) pending.push(importedFile);
    }
  }
  return [...visited];
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

/**
 * child_process calls in one source whose arguments include no object literal carrying `windowsHide: true`.
 * Follows named imports under any alias and namespace or default imports of the module.
 * @param fileName - Path reported for each finding.
 * @param sourceText - The file's contents.
 * @returns One entry per offending call, in source order.
 */
export function findUnhiddenSpawnCalls(fileName: string, sourceText: string): UnhiddenSpawnCall[] {
  const sourceFile = parseSource(fileName, sourceText);
  const spawningLocalNames = new Set<string>();
  const moduleNamespaceNames = new Set<string>();
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
