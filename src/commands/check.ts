import { loadConfig } from "../config.ts";
import { collectPaths, hasErrors, readFiles, runRules } from "../engine.ts";
import { matchesAny } from "../glob.ts";
import { evaluatePatterns, PATTERN_DEADLINE_MS } from "../patternEvaluator.ts";
import { formatReport } from "../report.ts";
import { patternSelector } from "../rules/bannedSymbols.ts";

/**
 * CI-side enforcement. Same rules, same engine and the same guarded pattern
 * evaluation as the hook, so a change that passed at edit time cannot fail here
 * for a different reason.
 *
 * The one intentional difference is the response to a pattern timeout: the hook
 * fails open so it never blocks an edit, while here it propagates and fails the
 * build. Silently skipping enforcement in CI would be the wrong trade.
 */
export async function checkCommand(argv: readonly string[]): Promise<number> {
  const { config, root } = await loadConfig(process.cwd());
  const allPaths = await collectPaths(root, config.exclude);

  const filters = argv.filter((arg) => !arg.startsWith("-"));
  const targets = filters.length > 0 ? allPaths.filter((p) => matchesAny(p, filters)) : allPaths;

  const files = await readFiles(root, targets);
  const known = new Set(allPaths);
  const { matches, timeouts } = await evaluatePatterns(
    files,
    patternSelector(config),
    PATTERN_DEADLINE_MS,
  );

  const violations = runRules(config, {
    files,
    hasPath: (path) => known.has(path),
    matches,
    root,
  });

  // Violations are identical to what the hook computes for the same content.
  // A timeout is reported apart from them, because it is a configuration error
  // rather than a finding about the code.
  if (timeouts.length === 0) {
    process.stdout.write(`${formatReport(violations)}\n`);
    return hasErrors(violations) ? 1 : 0;
  }

  if (violations.length > 0) process.stdout.write(`${formatReport(violations)}\n`);

  const skipped = timeouts.reduce((total, entry) => total + entry.patterns.length, 0);
  process.stderr.write(
    `keelson: enforcement incomplete — ${skipped} banned-symbols pattern(s) across ` +
      `${timeouts.length} file(s) exceeded ${PATTERN_DEADLINE_MS}ms and were skipped:\n` +
      timeouts
        .map((entry) => `  ${entry.path}: ${entry.patterns.join(", ")}\n`)
        .join("") +
      `Rewrite the pattern that backtracks catastrophically. CI fails here rather ` +
      `than reporting a clean run that did not actually check everything.\n`,
  );
  return 2;
}
