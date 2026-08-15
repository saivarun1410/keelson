import { loadConfig } from "../config.ts";
import { collectPaths, hasErrors, readFiles, runRules } from "../engine.ts";
import { matchesAny } from "../glob.ts";
import { formatReport } from "../report.ts";

/**
 * CI-side enforcement. Same rules and same engine as the hook, so a change that
 * passed at edit time cannot fail here for a different reason.
 */
export async function checkCommand(argv: readonly string[]): Promise<number> {
  const { config, root } = await loadConfig(process.cwd());
  const allPaths = await collectPaths(root, config.exclude);

  const filters = argv.filter((arg) => !arg.startsWith("-"));
  const targets = filters.length > 0 ? allPaths.filter((p) => matchesAny(p, filters)) : allPaths;

  const files = await readFiles(root, targets);
  const violations = runRules(config, { files, allPaths, root });

  process.stdout.write(`${formatReport(violations)}\n`);
  return hasErrors(violations) ? 1 : 0;
}
