import { matchesAny } from "../glob.ts";
import { ConfigError, type RawRule, type Rule, type Severity, type Violation } from "../types.ts";
import { requireGlobList } from "../validate.ts";

interface MaxFileLinesConfig {
  files: string[];
  max: number;
  severity: Severity;
}

/**
 * Counts lines the way `wc -l` and every editor do.
 *
 * Splitting on "\n" yields a trailing empty element for the normal case of a
 * file ending in a newline, which made every well-formed file appear one line
 * longer than it is — and blocked files sitting exactly on the limit.
 */
function countLines(content: string): number {
  if (content === "") return 0;
  const newlines = content.split("\n").length - 1;
  return content.endsWith("\n") ? newlines : newlines + 1;
}

/**
 * Caps file length. This is the rule agents violate most: asked for one more
 * feature, a model will happily append to a 900-line file rather than split it.
 */
export const maxFileLinesRule: Rule<MaxFileLinesConfig> = {
  id: "max-file-lines",

  parse(raw: RawRule): MaxFileLinesConfig {
    const max = raw.max;
    if (typeof max !== "number" || !Number.isInteger(max) || max <= 0) {
      throw new ConfigError("max-file-lines requires `max` to be a positive integer");
    }
    return {
      files: requireGlobList(raw.files, "max-file-lines `files`"),
      max,
      severity: raw.severity ?? "error",
    };
  },

  check(config, ctx): Violation[] {
    const violations: Violation[] = [];

    for (const file of ctx.files) {
      if (!matchesAny(file.path, config.files)) continue;

      const lineCount = countLines(file.content);
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
