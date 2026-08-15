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
 * Lines longer than this are not scanned. Real source lines are far shorter;
 * this bounds the damage from minified or generated files landing in scope.
 */
const MAX_SCANNED_LINE_LENGTH = 4000;

/**
 * Rejects patterns that can backtrack catastrophically.
 *
 * This has to happen at parse time. Regex execution is synchronous, so a
 * runaway match cannot be interrupted — not by a try/catch, not by a timer —
 * and it would hang the hook past the point where the fail-open handler could
 * ever run. Refusing the pattern up front is the only in-process defence.
 *
 * This is a heuristic, not a proof: it catches the common accidental shapes,
 * not every pathological regex. See the hook timeout guidance in the README.
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

  check(config, ctx): Violation[] {
    const violations: Violation[] = [];

    for (const file of ctx.files) {
      if (!matchesAny(file.path, config.files)) continue;

      const lines = file.content.split("\n");
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (line.length > MAX_SCANNED_LINE_LENGTH) continue;

        for (const symbol of config.symbols) {
          if (!symbol.pattern.test(line)) continue;
          violations.push({
            ruleId: bannedSymbolsRule.id,
            file: file.path,
            line: index + 1,
            severity: config.severity,
            message: symbol.message,
          });
        }
      }
    }

    return violations;
  },
};
