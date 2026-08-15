import { matchesAny } from "../glob.ts";
import { ConfigError, type RawRule, type Rule, type Severity, type Violation } from "../types.ts";

interface MaxFileLinesConfig {
  files: string[];
  max: number;
  severity: Severity;
}

/**
 * Caps file length. This is the rule agents violate most: asked for one more
 * feature, a model will happily append to a 900-line file rather than split it.
 */
export const maxFileLinesRule: Rule<MaxFileLinesConfig> = {
  id: "max-file-lines",

  parse(raw: RawRule): MaxFileLinesConfig {
    const files = raw.files;
    const max = raw.max;
    if (!Array.isArray(files) || files.length === 0) {
      throw new ConfigError("max-file-lines requires a non-empty `files` glob list");
    }
    if (typeof max !== "number" || !Number.isInteger(max) || max <= 0) {
      throw new ConfigError("max-file-lines requires `max` to be a positive integer");
    }
    return { files: files as string[], max, severity: raw.severity ?? "error" };
  },

  check(config, ctx): Violation[] {
    const violations: Violation[] = [];

    for (const file of ctx.files) {
      if (!matchesAny(file.path, config.files)) continue;

      const lineCount = file.content.split("\n").length;
      if (lineCount <= config.max) continue;

      violations.push({
        ruleId: maxFileLinesRule.id,
        file: file.path,
        line: config.max + 1,
        severity: config.severity,
        message:
          `File is ${lineCount} lines, over the ${config.max}-line limit. ` +
          `Split it into focused modules rather than extending it.`,
      });
    }

    return violations;
  },
};
