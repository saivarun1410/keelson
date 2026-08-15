/** Core types shared by the config loader, the rules, and the engine. */

export type Severity = "error" | "warn";

export interface Violation {
  ruleId: string;
  file: string;
  /** 1-indexed. Omitted for whole-file findings such as a missing companion. */
  line?: number;
  message: string;
  severity: Severity;
}

/** A file the engine is evaluating, with the content to judge. */
export interface FileEntry {
  /** Repo-relative, always posix-separated. */
  path: string;
  content: string;
}

export interface RuleContext {
  /** Files under evaluation this run. In hook mode this is a single proposed file. */
  files: FileEntry[];
  /** Every tracked path in the repo. Used by rules that check for absent files. */
  allPaths: string[];
  root: string;
}

/** One entry in the `rules:` array of keelson.yaml, before rule-specific parsing. */
export interface RawRule {
  id: string;
  severity?: Severity;
  [key: string]: unknown;
}

export interface Rule<C = unknown> {
  id: string;
  /** Throws ConfigError on malformed input so mistakes surface at load, not mid-run. */
  parse(raw: RawRule): C;
  check(config: C, ctx: RuleContext): Violation[];
}

export interface KeelsonConfig {
  version: number;
  rules: RawRule[];
  /** Globs excluded from every rule. */
  exclude: string[];
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}
