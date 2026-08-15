/**
 * A character-level scanner that reduces each line to the part that is actually
 * code, carrying string and comment state across line boundaries.
 *
 * Every construct handled here was, at some point, mistaken for a dependency:
 * a trailing comment, a specifier inside a template literal or a Python
 * docstring, a path inside a regex literal. Each one blocks a legitimate edit,
 * which is the worst failure this tool has. Tracking state properly costs one
 * pass per line and still needs no parser.
 */

import {
  consumeString,
  openingTripleQuote,
  skipRegexLiteral,
} from "./scanTokens.ts";

export interface ScanState {
  /**
   * Whether `#` starts a comment in this file's language.
   *
   * It cannot be decided from the character alone: `#` opens a comment in
   * Python, Ruby and shell, but declares a private field in TypeScript, where
   * treating `#repo = require("x")` as a comment would hide a real dependency.
   */
  hashComments: boolean;
  inBlockComment: boolean;
  inTemplate: boolean;
  /** The delimiter of an open triple-quoted string, or null. */
  tripleQuote: string | null;
  /** Nesting depth inside `${ ... }`; 0 means plain template text. */
  interpolationDepth: number;
}

const HASH_COMMENT_FILES = /\.(py|pyi|rb|sh|bash|zsh|ya?ml|toml|pl|r|tf|conf)$/i;

export function createScanState(path = ""): ScanState {
  return {
    hashComments: HASH_COMMENT_FILES.test(path),
    inBlockComment: false,
    inTemplate: false,
    tripleQuote: null,
    interpolationDepth: 0,
  };
}

/** Characters after which a `/` begins a regex literal rather than a division. */
const OPERAND_POSITION = /[(,=:[!&|?{};+\-*%~^<>]/;

/**
 * Keywords after which a `/` also begins a regex literal. Looking only at the
 * previous character misses these, so `return /require("x")/` was read as a
 * division and its contents extracted as a dependency.
 */
const OPERAND_KEYWORDS = new Set([
  "return", "typeof", "case", "in", "of", "delete", "void",
  "throw", "new", "do", "else", "yield", "await",
]);

/**
 * Returns the code portion of `line`, advancing `state`.
 *
 * Single- and double-quoted strings are preserved because import specifiers are
 * exactly that. Template text, triple-quoted blocks, comments and regex
 * literals are dropped because they are data, while `${ ... }` expressions are
 * kept because they are code.
 */
export function codeOf(line: string, state: ScanState): string {
  let out = "";
  let index = 0;
  let lastCode: string | undefined;
  let word = "";
  let previousWord = "";

  while (index < line.length) {
    if (state.inBlockComment) {
      const close = line.indexOf("*/", index);
      if (close === -1) return out;
      state.inBlockComment = false;
      index = close + 2;
      continue;
    }

    if (state.tripleQuote !== null) {
      const close = line.indexOf(state.tripleQuote, index);
      if (close === -1) return out;
      index = close + state.tripleQuote.length;
      state.tripleQuote = null;
      continue;
    }

    if (state.inTemplate && state.interpolationDepth === 0) {
      const char = line[index];
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (char === "`") {
        state.inTemplate = false;
        index += 1;
        continue;
      }
      if (char === "$" && line[index + 1] === "{") {
        state.interpolationDepth = 1;
        out += " ";
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }

    const char = line[index];

    if (char === "/" && line[index + 1] === "/") return out;
    if (char === "/" && line[index + 1] === "*") {
      state.inBlockComment = true;
      index += 2;
      continue;
    }
    if (char === "#" && state.hashComments) return out;

    const triple = openingTripleQuote(line, index);
    if (triple) {
      state.tripleQuote = triple;
      index += triple.length;
      out += " ";
      continue;
    }

    if (char === '"' || char === "'") {
      const [text, next] = consumeString(line, index, char);
      out += text;
      index = next;
      lastCode = char;
      continue;
    }

    if (char === "`") {
      state.inTemplate = true;
      state.interpolationDepth = 0;
      out += " ";
      index += 1;
      continue;
    }

    // The keyword may sit immediately before the slash (`return/x/`) or be
    // separated from it by whitespace (`return /x/`), so check both.
    const precedingWord = word !== "" ? word : previousWord;
    const afterOperand =
      lastCode === undefined || OPERAND_POSITION.test(lastCode) || OPERAND_KEYWORDS.has(precedingWord);
    if (char === "/" && afterOperand) {
      index = skipRegexLiteral(line, index);
      out += " ";
      continue;
    }

    if (state.interpolationDepth > 0) {
      if (char === "{") state.interpolationDepth += 1;
      if (char === "}") {
        state.interpolationDepth -= 1;
        index += 1;
        if (state.interpolationDepth === 0) out += " ";
        continue;
      }
    }

    out += char;
    if (!/\s/.test(char)) lastCode = char;
    if (/[A-Za-z_$]/.test(char)) {
      word += char;
    } else if (word !== "") {
      previousWord = word;
      word = "";
    }
    index += 1;
  }

  return out;
}
