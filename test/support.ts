import type { FileEntry, MatchIndex, RuleContext } from "../src/types.ts";

/**
 * Mirrors what `patternEvaluator` produces, so rules under test consume matches
 * exactly as they do in production. Running the regexes here is safe: the test
 * patterns are known, unlike a user's config.
 */
export function matchesFor(files: FileEntry[], patterns: readonly string[]): MatchIndex {
  const index: MatchIndex = new Map();
  for (const file of files) {
    const perFile = new Map<string, number[]>();
    for (const source of patterns) {
      const expression = new RegExp(source);
      const hits = file.content
        .split("\n")
        .map((line, position) => (expression.test(line) ? position + 1 : 0))
        .filter((position) => position > 0);
      if (hits.length > 0) perFile.set(source, hits);
    }
    if (perFile.size > 0) index.set(file.path, perFile);
  }
  return index;
}

export function contextOf(files: FileEntry[], known: string[] = [], patterns: string[] = []): RuleContext {
  return {
    files,
    hasPath: (path) => known.includes(path),
    matches: matchesFor(files, patterns),
    root: "/repo",
  };
}
