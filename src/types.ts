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

/** Pattern source → the 1-indexed lines it matched in one file. */
export type FileMatches = Map<string, number[]>;

/** File path → its pattern matches. Produced once, under a deadline. */
export type MatchIndex = Map<string, FileMatches>;

export interface RuleContext {
  /** Files under evaluation this run. In hook mode this is a single proposed file. */
  files: FileEntry[];
  /**
   * Whether a repo-relative path exists in the post-edit tree.
   *
   * A predicate rather than a list: hook mode can answer it with one stat,
   * where materialising every path in the repo cost an O(repo) walk per edit.
   */
  hasPath(path: string): boolean;
  /**
   * Regex matches computed ahead of time under a deadline, so no rule ever
   * executes a user-supplied pattern on the main thread.
   */
  matches: MatchIndex;
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
