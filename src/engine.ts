import type { Dirent } from "node:fs";
import { glob, readFile } from "node:fs/promises";
import { relative, sep } from "node:path";
import { matchesAny } from "./glob.ts";
import { RULES } from "./rules/index.ts";
import type { FileEntry, KeelsonConfig, RuleContext, Violation } from "./types.ts";

/**
 * Node 22 ships fs.glob, so file discovery costs no dependency and no startup
 * time.
 *
 * Exclusions are handed to the walker rather than applied to its output.
 * Filtering afterwards still descends into `node_modules` and every other
 * ignored tree, which dominates the cost on a large repo.
 */
export async function collectPaths(root: string, exclude: readonly string[]): Promise<string[]> {
  const paths: string[] = [];

  // Exclusion globs describe files (`**/node_modules/**`), so a directory is
  // pruned when a hypothetical child of it would be excluded.
  const isExcluded = (entry: Dirent): boolean => {
    const path = toPosix(relative(root, `${entry.parentPath}${sep}${entry.name}`));
    if (path === "") return false;
    return entry.isDirectory() ? matchesAny(`${path}/_`, exclude) : matchesAny(path, exclude);
  };

  for await (const entry of glob("**/*", { cwd: root, withFileTypes: true, exclude: isExcluded })) {
    if (!entry.isFile()) continue;
    paths.push(toPosix(relative(root, `${entry.parentPath}${sep}${entry.name}`)));
  }

  return paths.sort();
}

export function toPosix(path: string): string {
  return sep === "/" ? path : path.split(sep).join("/");
}

export async function readFiles(root: string, paths: readonly string[]): Promise<FileEntry[]> {
  return Promise.all(
    paths.map(async (path) => ({ path, content: await readFile(`${root}/${path}`, "utf8") })),
  );
}

const SEVERITY_ORDER = { error: 0, warn: 1 } as const;

/**
 * Runs every configured rule over the context. Rule configs are parsed here
 * rather than at load time so a malformed rule reports with its index.
 */
export function runRules(config: KeelsonConfig, ctx: RuleContext): Violation[] {
  const violations: Violation[] = [];

  for (const raw of config.rules) {
    const rule = RULES.get(raw.id);
    if (!rule) continue;
    violations.push(...rule.check(rule.parse(raw) as never, ctx));
  }

  return violations.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.file.localeCompare(b.file) ||
      (a.line ?? 0) - (b.line ?? 0),
  );
}

export function hasErrors(violations: readonly Violation[]): boolean {
  return violations.some((violation) => violation.severity === "error");
}
