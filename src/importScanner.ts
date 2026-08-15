/**
 * Line-level helpers for import extraction: deciding what part of a line is
 * real code. Kept separate from the language patterns so each stays readable.
 */

/** Quote characters that open a string literal in every language we scan. */
const QUOTES = new Set(['"', "'", "`"]);

/**
 * True when `index` falls inside a string literal on this line.
 *
 * Used to reject `require(...)` mentioned inside a quoted string, which would
 * otherwise be extracted as a real dependency and block a legitimate edit.
 */
export function insideStringLiteral(line: string, index: number): boolean {
  let quote: string | null = null;

  for (let cursor = 0; cursor < index; cursor += 1) {
    const char = line[cursor];
    if (char === "\\") {
      cursor += 1;
      continue;
    }
    if (quote === null && QUOTES.has(char)) {
      quote = char;
      continue;
    }
    if (quote !== null && char === quote) quote = null;
  }

  return quote !== null;
}

export interface CommentState {
  inBlockComment: boolean;
}

/**
 * Returns the code portion of a line, or null if the line is entirely comment.
 *
 * Line comments are only recognised at the start of a line. Stripping from any
 * `//` would corrupt specifiers containing `://`, and a commented-out import
 * mid-line is not a real pattern — whereas a fully commented-out import block
 * very much is, and used to be extracted as a live dependency.
 */
export function stripComment(rawLine: string, state: CommentState): string | null {
  let line = rawLine;

  if (state.inBlockComment) {
    const close = line.indexOf("*/");
    if (close === -1) return null;
    state.inBlockComment = false;
    line = line.slice(close + 2);
  }

  const trimmed = line.trimStart();
  if (trimmed.startsWith("//") || trimmed.startsWith("#")) return null;

  const open = line.indexOf("/*");
  if (open !== -1) {
    const close = line.indexOf("*/", open + 2);
    if (close === -1) {
      state.inBlockComment = true;
      return line.slice(0, open);
    }
    return line.slice(0, open) + line.slice(close + 2);
  }

  return line;
}

/**
 * Tracks whether the scanner is inside a Go `import ( ... )` block.
 *
 * Go import lines are bare quoted strings, which is far too weak a signal to
 * match anywhere in a file — any string-valued constant would qualify. Only
 * lines inside an import block are eligible.
 */
export class GoImportBlock {
  private open = false;

  /** Feed each code line in order. Returns true if this line is inside a block. */
  consume(line: string): boolean {
    if (!this.open) {
      if (/^\s*import\s*\(/.test(line)) {
        this.open = true;
        return false;
      }
      return false;
    }
    if (/^\s*\)/.test(line)) {
      this.open = false;
      return false;
    }
    return true;
  }
}
