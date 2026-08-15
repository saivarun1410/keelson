/**
 * A character-level scanner that reduces each line to the part that is actually
 * code, carrying string and comment state across line boundaries.
 *
 * Recognising comments by line prefix alone was not enough: a trailing
 * `// require("x")` and a specifier sitting inside a multi-line template
 * literal were both extracted as real dependencies, and each one blocks a
 * legitimate edit. Tracking state properly costs a single pass per line and
 * still needs no parser.
 */

export interface ScanState {
  inBlockComment: boolean;
  inTemplate: boolean;
  /** Nesting depth inside `${ ... }`; 0 means plain template text. */
  interpolationDepth: number;
}

export function createScanState(): ScanState {
  return { inBlockComment: false, inTemplate: false, interpolationDepth: 0 };
}

/** Consumes a quoted string, preserving it — specifiers live inside these. */
function consumeString(line: string, start: number, quote: string): [string, number] {
  let text = quote;
  let index = start + 1;

  while (index < line.length) {
    if (line[index] === "\\") {
      text += line.slice(index, index + 2);
      index += 2;
      continue;
    }
    text += line[index];
    index += 1;
    if (line[index - 1] === quote) break;
  }

  return [text, index];
}

/**
 * Returns the code portion of `line`, advancing `state`.
 *
 * Single- and double-quoted strings are preserved because import specifiers are
 * exactly that. Template *text* is dropped because it is data, while `${ ... }`
 * expressions are kept because they are code.
 */
export function codeOf(line: string, state: ScanState): string {
  if (!state.inBlockComment && !state.inTemplate && line.trimStart().startsWith("#")) {
    return "";
  }

  let out = "";
  let index = 0;

  while (index < line.length) {
    if (state.inBlockComment) {
      const close = line.indexOf("*/", index);
      if (close === -1) return out;
      state.inBlockComment = false;
      index = close + 2;
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

    if (char === '"' || char === "'") {
      const [text, next] = consumeString(line, index, char);
      out += text;
      index = next;
      continue;
    }

    if (char === "`") {
      state.inTemplate = true;
      state.interpolationDepth = 0;
      out += " ";
      index += 1;
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
    index += 1;
  }

  return out;
}

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
