/**
 * Small helpers for reasoning about a single already-scanned line, and about
 * multi-line Go import blocks. Split from `scanner.ts` to keep each file under
 * keelson's own line cap.
 */

/**
 * True when `index` falls inside a quoted string on an already-scanned line.
 *
 * `codeOf` preserves string literals because specifiers live inside them, so
 * patterns that can appear mid-line — `require(...)`, dynamic `import(...)` —
 * still have to distinguish a real call from one merely quoted inside a string.
 */
export function insideStringLiteral(line: string, index: number): boolean {
  let quote: string | null = null;

  for (let cursor = 0; cursor < index; cursor += 1) {
    const char = line[cursor];
    if (char === "\\") {
      cursor += 1;
      continue;
    }
    if (quote === null && (char === '"' || char === "'")) {
      quote = char;
      continue;
    }
    if (quote !== null && char === quote) quote = null;
  }

  return quote !== null;
}

/**
 * Tracks whether the scanner is inside a Go `import ( ... )` block.
 *
 * Go import entries are bare quoted strings, far too weak a signal to match
 * anywhere in a file — any string constant would qualify.
 */
export class GoImportBlock {
  private open = false;

  /** Feed each code line in order. Returns true if this line is inside a block. */
  consume(line: string): boolean {
    if (!this.open) {
      if (/^\s*import\s*\(/.test(line)) this.open = true;
      return false;
    }
    if (/^\s*\)/.test(line)) {
      this.open = false;
      return false;
    }
    return true;
  }
}
