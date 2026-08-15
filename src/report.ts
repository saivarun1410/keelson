import type { Violation } from "./types.ts";

const COLOR = {
  reset: "[0m",
  dim: "[2m",
  red: "[31m",
  yellow: "[33m",
  green: "[32m",
  bold: "[1m",
} as const;

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

function paint(text: string, color: keyof typeof COLOR): string {
  return useColor ? `${COLOR[color]}${text}${COLOR.reset}` : text;
}

function location(violation: Violation): string {
  return violation.line ? `${violation.file}:${violation.line}` : violation.file;
}

/** Human-readable report for `keelson check`, grouped by file. */
export function formatReport(violations: readonly Violation[]): string {
  if (violations.length === 0) {
    return paint("✓ keelson: no violations", "green");
  }

  const lines: string[] = [];
  let currentFile = "";

  for (const violation of violations) {
    if (violation.file !== currentFile) {
      currentFile = violation.file;
      lines.push("", paint(currentFile, "bold"));
    }
    const label = violation.severity === "error" ? paint("error", "red") : paint("warn", "yellow");
    const line = violation.line ? paint(`:${violation.line}`, "dim") : "";
    lines.push(`  ${label}${line}  ${violation.message}  ${paint(violation.ruleId, "dim")}`);
  }

  const errors = violations.filter((entry) => entry.severity === "error").length;
  const warnings = violations.length - errors;
  lines.push("", `${errors} error(s), ${warnings} warning(s)`);

  return lines.join("\n");
}

/**
 * Compact report handed back to the agent when a hook denies an edit. The agent
 * reads this as the denial reason, so it states the rule and the fix, not a
 * stack of decoration.
 */
export function formatDenial(violations: readonly Violation[]): string {
  const details = violations
    .map((violation) => `  • ${location(violation)} — ${violation.message} [${violation.ruleId}]`)
    .join("\n");

  return `keelson blocked this edit — it violates this repo's architecture rules:\n${details}\n\nFix the violation and retry. Do not disable the rule to get past it.`;
}
