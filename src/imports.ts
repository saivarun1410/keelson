/**
 * Language-agnostic import extraction.
 *
 * keelson deliberately does not parse an AST. A per-language parser would mean a
 * per-language tool, and the whole point is that one rule file covers a polyglot
 * repo. Line-oriented scanning covers the import syntax of every language we
 * care about, gives line numbers for free, and stays fast on the hook hot path.
 *
 * The patterns are deliberately strict about context: a specifier is only an
 * import if the surrounding line says so. Over-matching here blocks legitimate
 * edits, which is the worst failure this tool can have.
 */

import { GoImportBlock, insideStringLiteral } from "./lineContext.ts";
import { codeOf, createScanState } from "./scanner.ts";

/** Which language's notation the specifier is written in; drives resolution. */
export type ImportSyntax = "es" | "go" | "dotted" | "python-relative";

export interface ImportRef {
  /** The literal specifier as written: "./foo.js", "lodash", "com.acme.Repo". */
  specifier: string;
  /** 1-indexed line in the source file. */
  line: number;
  syntax: ImportSyntax;
}

// `import "x"` — side-effect only.
const ES_BARE = /^\s*import\s+["']([^"']+)["']/;
// `import x from "y"` / `export { x } from "y"` — the `from` keyword is required,
// which is what keeps `export const route = "src/repository/users"` out.
const ES_FROM = /^\s*(?:import|export)\b[^'"]*\bfrom\s*["']([^"']+)["']/;
// `await import("x")` anywhere on the line.
const ES_DYNAMIC = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/;
const CJS_REQUIRE = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/;
// Go single-line with an alias: `import alias "example.com/project/repo"`.
const GO_ALIASED = /^\s*import\s+(?:[\w.]+|_|\.)\s+["]([^"]+)["]/;
// Java / Kotlin / Python, including `import a.b, c.d` and a trailing `as` alias.
const DOTTED_IMPORT =
  /^\s*import\s+(?:static\s+)?((?:[\w.]+(?:\.\*)?(?:\s+as\s+[\w.]+)?)(?:\s*,\s*[\w.]+(?:\.\*)?(?:\s+as\s+[\w.]+)?)*)\s*;?\s*$/;
// Python: `from .x import y`, `from ..a.b import c`.
const PYTHON_FROM = /^\s*from\s+(\.*[\w.]*)\s+import\b/;
// A bare quoted string, only meaningful inside a Go import block.
const GO_ENTRY = /^\s*(?:[\w.]+\s+)?["]([^"]+)["]\s*$/;

type PartialRef = Omit<ImportRef, "line">;

/**
 * True when an ES statement has begun but its specifier is on a later line —
 * `import {` with the brace still open, a bare `import`, or a dynamic
 * `import(` / `require(` whose argument wraps.
 *
 * The unclosed-brace requirement matters: a complete dotted import such as
 * `import com.acme.Repo;` also has no quote and no `from`, and would otherwise
 * be mistaken for the start of a multi-line statement.
 */
function opensMultilineStatement(line: string): boolean {
  if (/\b(?:import|require)\s*\(\s*$/.test(line)) return true;
  if (!/^\s*(?:import|export)\b/.test(line) || /["']/.test(line) || /\bfrom\b/.test(line)) {
    return false;
  }
  return /\{[^}]*$/.test(line) || /^\s*import\s*$/.test(line);
}

/** True when the match is a property access, e.g. `client.require(...)`. */
function isMemberCall(line: string, index: number): boolean {
  const before = line.slice(0, index).trimEnd();
  if (!before.endsWith(".")) return false;
  return !/\bmodule\.$/.test(before);
}

function matchAt(line: string, pattern: RegExp): { specifier: string; index: number } | null {
  const match = pattern.exec(line);
  return match?.[1] ? { specifier: match[1], index: match.index } : null;
}

function scanLine(line: string, inGoBlock: boolean): PartialRef[] {
  for (const pattern of [ES_BARE, ES_FROM]) {
    const found = matchAt(line, pattern);
    if (found) return [{ specifier: found.specifier, syntax: "es" }];
  }

  // These can appear mid-line, so an occurrence quoted inside a string is not
  // a dependency — `const doc = 'call require("x")'` must not match — and a
  // member call such as `client.require("x")` is an unrelated method, not a
  // module load. `module.require` is the one member form that really loads.
  for (const pattern of [ES_DYNAMIC, CJS_REQUIRE]) {
    const found = matchAt(line, pattern);
    if (found && !insideStringLiteral(line, found.index) && !isMemberCall(line, found.index)) {
      return [{ specifier: found.specifier, syntax: "es" }];
    }
  }

  const goAliased = matchAt(line, GO_ALIASED);
  if (goAliased) return [{ specifier: goAliased.specifier, syntax: "go" }];

  const python = matchAt(line, PYTHON_FROM);
  if (python) {
    const syntax = python.specifier.startsWith(".") ? "python-relative" : "dotted";
    return [{ specifier: python.specifier, syntax }];
  }

  const dotted = matchAt(line, DOTTED_IMPORT);
  if (dotted) {
    return dotted.specifier
      .split(",")
      .map((entry) => entry.trim().replace(/\s+as\s+[\w.]+$/, ""))
      .filter(Boolean)
      .map((specifier) => ({ specifier, syntax: "dotted" as const }));
  }

  if (inGoBlock) {
    const go = matchAt(line, GO_ENTRY);
    if (go) return [{ specifier: go.specifier, syntax: "go" }];
  }

  return [];
}

export function extractImports(content: string, path = ""): ImportRef[] {
  const refs: ImportRef[] = [];
  const lines = content.split("\n");
  const scanState = createScanState(path);
  const goBlock = new GoImportBlock();
  let awaitingSpecifier = false;

  for (let index = 0; index < lines.length; index += 1) {
    const code = codeOf(lines[index], scanState);
    if (code.trim() === "") continue;

    const inGoBlock = goBlock.consume(code);

    // Continuation of a multi-line statement: take the first quoted specifier.
    if (awaitingSpecifier) {
      const found = matchAt(code, /["']([^"']+)["']/);
      if (found) {
        refs.push({ specifier: found.specifier, line: index + 1, syntax: "es" });
        awaitingSpecifier = false;
        continue;
      }
      // The statement closed with no literal — `import(moduleName)`. Give up,
      // or the next unrelated string in the file gets claimed as its specifier.
      if (/[);]/.test(code)) awaitingSpecifier = false;
      continue;
    }

    // A complete single-line import wins over the multi-line heuristic.
    const found = scanLine(code, inGoBlock);
    if (found.length > 0) {
      refs.push(...found.map((ref) => ({ ...ref, line: index + 1 })));
      continue;
    }

    if (opensMultilineStatement(code)) awaitingSpecifier = true;
  }

  return refs;
}

function joinSegments(base: string[], parts: readonly string[]): string {
  const segments = [...base];
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") {
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  return segments.join("/");
}

/**
 * Turn a relative specifier into a repo-relative path so it can be matched
 * against path globs. Non-relative specifiers (packages, Java FQNs) are
 * returned unchanged and matched as-is.
 */
export function resolveSpecifier(ref: ImportRef, importingFile: string): string {
  const directory = importingFile.split("/").slice(0, -1);

  if (ref.syntax === "python-relative") {
    // In Python one leading dot is the current package, each further dot moves
    // up one — unlike `../`, where every segment moves up.
    const dots = /^\.*/.exec(ref.specifier)?.[0].length ?? 0;
    const base = directory.slice(0, directory.length - (dots - 1));
    const remainder = ref.specifier.slice(dots).split(".").filter(Boolean);
    return joinSegments(base, remainder);
  }

  if (!ref.specifier.startsWith(".")) return ref.specifier;

  return joinSegments(directory, ref.specifier.split("/"));
}
