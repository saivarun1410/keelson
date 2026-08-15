import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { RULE_IDS, RULES } from "./rules/index.ts";
import { ConfigError, type KeelsonConfig, type RawRule } from "./types.ts";
import { requireGlobList } from "./validate.ts";

export const CONFIG_FILENAME = "keelson.yaml";

const SUPPORTED_VERSION = 1;

const DEFAULT_EXCLUDES: readonly string[] = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/target/**",
  "**/.git/**",
  "**/vendor/**",
  "**/*.min.js",
];

/** Walks up from `startDir` looking for keelson.yaml. Returns null if absent. */
export function findConfigFile(startDir: string): string | null {
  let current = resolve(startDir);

  while (true) {
    const candidate = join(current, CONFIG_FILENAME);
    if (existsSync(candidate)) return candidate;

    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function validateRule(entry: unknown, index: number): RawRule {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    throw new ConfigError(`rules[${index}] must be an object`);
  }
  const raw = entry as RawRule;
  if (typeof raw.id !== "string") {
    throw new ConfigError(`rules[${index}] is missing a string \`id\``);
  }
  if (!RULES.has(raw.id)) {
    throw new ConfigError(
      `rules[${index}] has unknown id "${raw.id}". Known rules: ${RULE_IDS.join(", ")}`,
    );
  }
  if (raw.severity !== undefined && raw.severity !== "error" && raw.severity !== "warn") {
    throw new ConfigError(`rules[${index}] \`severity\` must be "error" or "warn"`);
  }
  return normaliseGlobFields(raw, index);
}

/** Glob fields that accept either a single glob or a list of them. */
const GLOB_FIELDS = ["files", "from", "disallow"] as const;

/**
 * Rewrites scalar globs to single-element arrays once, at load.
 *
 * Both forms are valid in a config file, and consumers used to disagree about
 * it: rules normalised internally while the hook's pattern selection tested
 * `Array.isArray` and silently matched nothing, so a scalar `files:` enforced in
 * CI but not at edit time.
 */
function normaliseGlobFields(raw: RawRule, index: number): RawRule {
  const normalised: RawRule = { ...raw };

  for (const field of GLOB_FIELDS) {
    if (normalised[field] === undefined) continue;
    normalised[field] = requireGlobList(normalised[field], `rules[${index}].${field}`);
  }

  return normalised;
}

export function parseConfig(source: string): KeelsonConfig {
  let document: unknown;
  try {
    document = parseYaml(source);
  } catch (cause) {
    throw new ConfigError(`${CONFIG_FILENAME} is not valid YAML: ${(cause as Error).message}`);
  }

  if (typeof document !== "object" || document === null) {
    throw new ConfigError(`${CONFIG_FILENAME} must contain a YAML mapping`);
  }

  const { version, rules, exclude } = document as Record<string, unknown>;

  if (version !== SUPPORTED_VERSION) {
    throw new ConfigError(`${CONFIG_FILENAME} must declare \`version: ${SUPPORTED_VERSION}\``);
  }
  if (!Array.isArray(rules)) {
    throw new ConfigError(`${CONFIG_FILENAME} must contain a \`rules\` list`);
  }
  if (exclude !== undefined && !Array.isArray(exclude)) {
    throw new ConfigError("`exclude` must be a list of globs");
  }

  const extraExcludes = exclude === undefined ? [] : requireGlobList(exclude, "`exclude`");

  return {
    version,
    rules: rules.map(validateRule),
    exclude: [...DEFAULT_EXCLUDES, ...extraExcludes],
  };
}

export interface LoadedConfig {
  config: KeelsonConfig;
  /** Directory containing keelson.yaml; all globs resolve relative to it. */
  root: string;
}

export async function loadConfig(startDir: string): Promise<LoadedConfig> {
  const path = findConfigFile(startDir);
  if (!path) {
    throw new ConfigError(
      `No ${CONFIG_FILENAME} found in ${startDir} or any parent. Run \`keelson init\` to create one.`,
    );
  }
  return { config: parseConfig(await readFile(path, "utf8")), root: dirname(path) };
}
