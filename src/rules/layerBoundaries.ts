import { matchesAny, matchesGlob } from "../glob.ts";
import { extractImports, resolveSpecifier } from "../imports.ts";
import { ConfigError, type RawRule, type Rule, type Severity, type Violation } from "../types.ts";

interface LayerBoundariesConfig {
  from: string[];
  disallow: string[];
  message?: string;
  severity: Severity;
}

function requireGlobList(value: unknown, field: string): string[] {
  const list = Array.isArray(value) ? value : [value];
  if (list.length === 0 || !list.every((entry) => typeof entry === "string" && entry.length > 0)) {
    throw new ConfigError(`layer-boundaries requires \`${field}\` to be a glob or list of globs`);
  }
  return list as string[];
}

/**
 * Enforces dependency direction: files matching `from` may not import anything
 * matching `disallow`. Specifiers are matched twice — once resolved to a
 * repo-relative path (for relative imports) and once raw (so package names and
 * Java fully-qualified names work with the same rule shape).
 */
export const layerBoundariesRule: Rule<LayerBoundariesConfig> = {
  id: "layer-boundaries",

  parse(raw: RawRule): LayerBoundariesConfig {
    const { message } = raw;
    if (message !== undefined && typeof message !== "string") {
      throw new ConfigError("layer-boundaries `message` must be a string");
    }
    return {
      from: requireGlobList(raw.from, "from"),
      disallow: requireGlobList(raw.disallow, "disallow"),
      message,
      severity: raw.severity ?? "error",
    };
  },

  check(config, ctx): Violation[] {
    const violations: Violation[] = [];

    for (const file of ctx.files) {
      if (!matchesAny(file.path, config.from)) continue;

      for (const ref of extractImports(file.content)) {
        const resolved = resolveSpecifier(ref.specifier, file.path);
        const breached = config.disallow.find(
          (glob) => matchesGlob(resolved, glob) || matchesGlob(ref.specifier, glob),
        );
        if (!breached) continue;

        violations.push({
          ruleId: layerBoundariesRule.id,
          file: file.path,
          line: ref.line,
          severity: config.severity,
          message:
            config.message ??
            `${file.path} must not import "${ref.specifier}" (matches disallowed \`${breached}\`).`,
        });
      }
    }

    return violations;
  },
};
