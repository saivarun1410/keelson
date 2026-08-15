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

  process.stdout.write(`${formatReport(violations)}\n`);

  // Violations are identical to what the hook computed for the same content;
  // the timeout is reported separately, as the configuration error it is. CI
  // still fails on it, because a pattern that silently stops being enforced is
  // worse than one that fails loudly.
  for (const timeout of timeouts) {
    process.stderr.write(
      `keelson: skipped ${timeout.patterns.length} banned-symbols pattern(s) for ` +
        `${timeout.path} after ${PATTERN_DEADLINE_MS}ms. Rewrite the pattern that ` +
        `backtracks catastrophically.\n`,
    );
  }

  if (timeouts.length > 0) return 2;
  return hasErrors(violations) ? 1 : 0;
}
