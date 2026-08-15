import { matchesAny } from "../glob.ts";
import { ConfigError, type RawRule, type Rule, type Severity, type Violation } from "../types.ts";

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
 * Requires a sibling artifact to exist — most often a test file. Agents reliably
 * write the implementation and skip the test, and CI only notices much later.
 */
export const requiredCompanionRule: Rule<RequiredCompanionConfig> = {
  id: "required-companion",

  parse(raw: RawRule): RequiredCompanionConfig {
    const { files, companion, message } = raw;
    if (!Array.isArray(files) || files.length === 0) {
      throw new ConfigError("required-companion requires a non-empty `files` glob list");
    }
    // `{name}`/`{dir}` are optional: a constant path is a valid requirement too
    // ("every rule file is covered by this one test file").
    if (typeof companion !== "string" || companion.length === 0) {
      throw new ConfigError("required-companion requires a non-empty `companion` path template");
    }
    if (message !== undefined && typeof message !== "string") {
      throw new ConfigError("required-companion `message` must be a string");
    }
    return { files: files as string[], companion, message, severity: raw.severity ?? "error" };
  },

  check(config, ctx): Violation[] {
    const violations: Violation[] = [];
    const known = new Set(ctx.allPaths);

    for (const file of ctx.files) {
      if (!matchesAny(file.path, config.files)) continue;

      const expected = config.companion
        .replaceAll(BASENAME_TOKEN, basenameWithoutExtension(file.path))
        .replaceAll(DIRNAME_TOKEN, dirname(file.path));

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
