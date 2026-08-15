import { matchesAny } from "../glob.ts";
import { ConfigError, type RawRule, type Rule, type Severity, type Violation } from "../types.ts";

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

function parseSymbol(entry: unknown, index: number): BannedSymbol {
  if (typeof entry !== "object" || entry === null) {
    throw new ConfigError(`banned-symbols[${index}] must be an object`);
  }
  const { pattern, message } = entry as { pattern?: unknown; message?: unknown };
  if (typeof pattern !== "string" || pattern.length === 0) {
    throw new ConfigError(`banned-symbols[${index}] requires a \`pattern\` string`);
  }
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
    const { files, symbols } = raw;
    if (!Array.isArray(files) || files.length === 0) {
      throw new ConfigError("banned-symbols requires a non-empty `files` glob list");
    }
    if (!Array.isArray(symbols) || symbols.length === 0) {
      throw new ConfigError("banned-symbols requires a non-empty `symbols` list");
    }
    return {
      files: files as string[],
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
        for (const symbol of config.symbols) {
          if (!symbol.pattern.test(lines[index])) continue;
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
