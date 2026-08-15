/**
 * Language-agnostic import extraction.
 *
 * keelson deliberately does not parse an AST. A per-language parser would mean a
 * per-language tool, and the whole point is that one rule file covers a polyglot
 * repo. Line-oriented patterns cover the import syntax of every language we care
 * about, give line numbers for free, and stay fast enough for the hook hot path.
 */

export interface ImportRef {
  /** The literal specifier as written: "./foo.js", "lodash", "com.acme.Repo". */
  specifier: string;
  /** 1-indexed line in the source file. */
  line: number;
}

/** Each pattern captures the import specifier in group 1. */
const IMPORT_PATTERNS: readonly RegExp[] = [
  // ES modules and re-exports: import x from "y" / import "y" / export * from "y"
  /^\s*(?:import|export)\b[^"'`]*["']([^"']+)["']/,
  // CommonJS: require("y")
  /\brequire\(\s*["']([^"']+)["']\s*\)/,
  // Go import lines inside a block: "fmt" or alias "fmt"
  /^\s*(?:[\w.]+\s+)?["]([\w./-]+)["]\s*$/,
  // Java / Kotlin: import static? a.b.C;
  /^\s*import\s+(?:static\s+)?([\w.]+(?:\.\*)?)\s*;/,
  // Python: from a.b import c
  /^\s*from\s+([\w.]+)\s+import\b/,
  // Python: import a.b
  /^\s*import\s+([\w.]+)\s*$/,
];

export function extractImports(content: string): ImportRef[] {
  const refs: ImportRef[] = [];
  const lines = content.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.includes("import") && !line.includes("require") && !line.includes('"')) {
      continue;
    }
    for (const pattern of IMPORT_PATTERNS) {
      const match = pattern.exec(line);
      if (match?.[1]) {
        refs.push({ specifier: match[1], line: index + 1 });
        break;
      }
    }
  }

  return refs;
}

/**
 * Turn a relative specifier into a repo-relative path so it can be matched
 * against path globs. Non-relative specifiers (packages, Java FQNs) are
 * returned unchanged and matched as-is.
 */
export function resolveSpecifier(specifier: string, importingFile: string): string {
  if (!specifier.startsWith(".")) {
    return specifier;
  }

  const segments = importingFile.split("/").slice(0, -1);
  for (const part of specifier.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") {
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  return segments.join("/");
}
