/**
 * Scanner state and the character classes that drive it. Split from
 * `scanner.ts` to keep both files under keelson's own line cap.
 */

import { createJsxState, type JsxState } from "./jsx.ts";

export interface ScanState {
  /**
   * Whether `#` starts a comment in this file's language.
   *
   * It cannot be decided from the character alone: `#` opens a comment in
   * Python, Ruby and shell, but declares a private field in TypeScript, where
   * treating `#repo = require("x")` as a comment would hide a real dependency.
   */
  hashComments: boolean;
  jsx: JsxState;
  inBlockComment: boolean;
  inTemplate: boolean;
  /** The delimiter of an open triple-quoted string, or null. */
  tripleQuote: string | null;
  /** Nesting depth inside `${ ... }`; 0 means plain template text. */
  interpolationDepth: number;
}

export const HASH_COMMENT_FILES = /\.(py|pyi|rb|sh|bash|zsh|ya?ml|toml|pl|r|tf|conf)$/i;

export function createScanState(path = ""): ScanState {
  return {
    hashComments: HASH_COMMENT_FILES.test(path),
    jsx: createJsxState(path),
    inBlockComment: false,
    inTemplate: false,
    tripleQuote: null,
    interpolationDepth: 0,
  };
}

/** Characters after which a `/` begins a regex literal rather than a division. */
export const OPERAND_POSITION = /[(,=:[!&|?{};+\-*%~^<>]/;

/**
 * Keywords after which a `/` also begins a regex literal. Looking only at the
 * previous character misses these, so `return /require("x")/` was read as a
 * division and its contents extracted as a dependency.
 */
/** Keywords whose parenthesised condition is followed by statement position. */
export const CONTROL_KEYWORDS = new Set(["if", "while", "for", "switch", "catch"]);

export const OPERAND_KEYWORDS = new Set([
  "return", "typeof", "case", "in", "of", "delete", "void",
  "throw", "new", "do", "else", "yield", "await",
]);
