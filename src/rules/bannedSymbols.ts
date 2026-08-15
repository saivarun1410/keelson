import { matchesAny } from "../glob.ts";
import { ConfigError, type RawRule, type Rule, type Severity, type Violation } from "../types.ts";
import { requireGlobList } from "../validate.ts";

interface BannedSymbol {
  pattern: RegExp;
  source: string;
  message: string;
}

interface BannedSymbolsConfig {
  files: string[];
  symbols: BannedSymbol[];
  severity: Severity;
}

/**
 * A quantified group that itself contains a quantifier — `(a+)+`, `([a-z]*)*`.
 * This is the shape behind almost all accidental catastrophic backtracking.
 */
const NESTED_QUANTIFIER = /\([^()]*[+*][^()]*\)\s*[+*]|\([^()]*[+*][^()]*\)\s*\{\d+,\}/;

/**
 * Rejects the most common accidental catastrophic-backtracking shape early,
 * with a message that names the problem.
 *
 * This is a diagnostic, not the safety mechanism. It cannot be: `^(a|aa)+$`
 * backtracks exponentially with no nested quantifier at all. The actual
 * guarantee comes from evaluating patterns in a worker under a deadline before
 * they run on the main thread — see `src/regexGuard.ts`.
 */
function assertSafePattern(pattern: string, index: number): void {
  if (NESTED_QUANTIFIER.test(pattern)) {
    throw new ConfigError(
      `banned-symbols[${index}] pattern ${JSON.stringify(pattern)} nests a quantifier inside a ` +
        `quantified group, which can backtrack catastrophically and hang every edit. ` +
        `Rewrite it without the nesting (for example "a+" rather than "(a+)+").`,
    );
  }
}

function parseSymbol(entry: unknown, index: number): BannedSymbol {
  if (typeof entry !== "object" || entry === null) {
    throw new ConfigError(`banned-symbols[${index}] must be an object`);
  }
  const { pattern, message } = entry as { pattern?: unknown; message?: unknown };
  if (typeof pattern !== "string" || pattern.length === 0) {
    throw new ConfigError(`banned-symbols[${index}] requires a \`pattern\` string`);
  }
  if (message !== undefined && typeof message !== "string") {
    throw new ConfigError(
      `banned-symbols[${index}] \`message\` must be a string, got ${JSON.stringify(message)}`,
    );
  }

  assertSafePattern(pattern, index);

  try {
    return {
      pattern: new RegExp(pattern),
      source: pattern,
      message: typeof message === "string" ? message : `Banned symbol: ${pattern}`,
    };
  } catch (cause) {
    throw new ConfigError(
      `banned-symbols[${index}] pattern is not a valid regex: ${(cause as Error).message}`,
    );
  }
}

/**
 * Every regex a config will execute, read straight off the raw rules.
 *
 * Both commands need this before rules run, to hand the patterns to the
 * evaluator rather than letting any of them reach the main thread.
 */
export function bannedPatternSources(config: { rules: RawRule[] }): string[] {
  return config.rules
    .filter((rule) => rule.id === bannedSymbolsRule.id && Array.isArray(rule.symbols))
    .flatMap((rule) => rule.symbols as { pattern?: unknown }[])
    .map((symbol) => symbol?.pattern)
    .filter((pattern): pattern is string => typeof pattern === "string");
}

/** Flags forbidden constructs: console.log, System.out, field @Autowired, TODO markers. */
export const bannedSymbolsRule: Rule<BannedSymbolsConfig> = {
  id: "banned-symbols",

  parse(raw: RawRule): BannedSymbolsConfig {
    const { symbols } = raw;
    if (!Array.isArray(symbols) || symbols.length === 0) {
      throw new ConfigError("banned-symbols requires a non-empty `symbols` list");
    }
    return {
      files: requireGlobList(raw.files, "banned-symbols `files`"),
      symbols: symbols.map(parseSymbol),
      severity: raw.severity ?? "error",
    };
  },

  /**
   * Reads matches computed ahead of time rather than executing the patterns
   * here. All regex execution happens in `patternEvaluator`, under a deadline
   * and off the main thread, so a pathological pattern can never hang a caller.
   */
  check(config, ctx): Violation[] {
    const violations: Violation[] = [];

    for (const file of ctx.files) {
      if (!matchesAny(file.path, config.files)) continue;

      const fileMatches = ctx.matches.get(file.path);
      if (!fileMatches) continue;

      for (const symbol of config.symbols) {
        for (const line of fileMatches.get(symbol.source) ?? []) {
          violations.push({
            ruleId: bannedSymbolsRule.id,
            file: file.path,
            line,
            severity: config.severity,
            message: symbol.message,
          });
        }
      }
    }

    return violations;
  },
};
