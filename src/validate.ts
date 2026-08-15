import { ConfigError } from "./types.ts";

/**
 * Validates a glob list from config.
 *
 * Element types matter more here than they look. A non-string glob does not
 * throw when compiled — it produces a regex matching only the empty string — so
 * an invalid config used to stay silently operational, enforcing some rules
 * while quietly ignoring the exclusions meant to bound them.
 */
export function requireGlobList(value: unknown, context: string): string[] {
  const list = Array.isArray(value) ? value : [value];

  if (list.length === 0) {
    throw new ConfigError(`${context} must contain at least one glob`);
  }

  for (const [index, entry] of list.entries()) {
    if (typeof entry !== "string" || entry.trim() === "") {
      throw new ConfigError(
        `${context}[${index}] must be a non-empty string glob, got ${JSON.stringify(entry)}`,
      );
    }
  }

  return list as string[];
}
