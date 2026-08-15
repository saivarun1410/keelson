import { matchesAny } from "../glob.ts";
import { ConfigError, type RawRule, type Rule, type Severity, type Violation } from "../types.ts";
import { requireGlobList } from "../validate.ts";

interface RequiredCompanionConfig {
  files: string[];
  companion: string;
  message?: string;
  severity: Severity;
}

const BASENAME_TOKEN = "{name}";
const DIRNAME_TOKEN = "{dir}";

function basenameWithoutExtension(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.indexOf(".");
  return dot === -1 ? base : base.slice(0, dot);
}

function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

/**
 * Collapses the artefacts of token substitution into a real repo-relative path.
 *
 * A root-level file has an empty `{dir}`, so the common template
 * `{dir}/{name}.test.ts` expanded to `/a.test.ts` — an absolute-looking path
 * that could never match a repo path, reporting every root file as missing its
 * companion.
 */
function normalizeRepoPath(path: string): string {
  return path
    .replace(/\/{2,}/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\//, "");
}

/**
 * Requires a sibling artifact to exist — most often a test file. Agents reliably
 * write the implementation and skip the test, and CI only notices much later.
 */
export const requiredCompanionRule: Rule<RequiredCompanionConfig> = {
  id: "required-companion",

  parse(raw: RawRule): RequiredCompanionConfig {
    const { companion, message } = raw;
    const files = requireGlobList(raw.files, "required-companion `files`");
    // `{name}`/`{dir}` are optional: a constant path is a valid requirement too
    // ("every rule file is covered by this one test file").
    if (typeof companion !== "string" || companion.length === 0) {
      throw new ConfigError("required-companion requires a non-empty `companion` path template");
    }
    if (message !== undefined && typeof message !== "string") {
      throw new ConfigError("required-companion `message` must be a string");
    }
    return { files, companion, message, severity: raw.severity ?? "error" };
  },

  check(config, ctx): Violation[] {
    const violations: Violation[] = [];
    const known = new Set(ctx.allPaths);

    for (const file of ctx.files) {
      if (!matchesAny(file.path, config.files)) continue;

      const expected = normalizeRepoPath(
        config.companion
          .replaceAll(BASENAME_TOKEN, basenameWithoutExtension(file.path))
          .replaceAll(DIRNAME_TOKEN, dirname(file.path)),
      );

      // A file that is its own companion is trivially satisfied, and would
      // otherwise be reported as missing while it is being created.
      if (expected === file.path) continue;

      if (known.has(expected)) continue;

      violations.push({
        ruleId: requiredCompanionRule.id,
        file: file.path,
        severity: config.severity,
        message: config.message ?? `Missing required companion file: ${expected}`,
      });
    }

    return violations;
  },
};
