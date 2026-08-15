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

export interface ScanState {
  inBlockComment: boolean;
  inTemplate: boolean;
  /** The delimiter of an open triple-quoted string, or null. */
  tripleQuote: string | null;
  /** Nesting depth inside `${ ... }`; 0 means plain template text. */
  interpolationDepth: number;
}

export function createScanState(): ScanState {
  return { inBlockComment: false, inTemplate: false, tripleQuote: null, interpolationDepth: 0 };
}

const TRIPLE_QUOTES = ['"""', "'''"];

/** Positions where a `/` begins a regex literal rather than a division. */
const OPERAND_POSITION = /[(,=:[!&|?{};+\-*%~^<>]/;

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

/** Skips a regex literal, including its character classes and flags. */
function skipRegexLiteral(line: string, start: number): number {
  let index = start + 1;
  let inClass = false;

  while (index < line.length) {
    const char = line[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "[") inClass = true;
    else if (char === "]") inClass = false;
    else if (char === "/" && !inClass) return index + 1;
    index += 1;
  }
  return index;
}

function openingTripleQuote(line: string, index: number): string | null {
  return TRIPLE_QUOTES.find((quote) => line.startsWith(quote, index)) ?? null;
}

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
    // `#` comments Python, Ruby and shell. Requiring whitespace or line start
    // before it keeps TypeScript private fields (`this.#count`) intact.
    if (char === "#" && lastCode === undefined) return out;
    if (char === "#" && /\s/.test(line[index - 1] ?? "")) return out;

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

    if (char === "/" && (lastCode === undefined || OPERAND_POSITION.test(lastCode))) {
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
    index += 1;
  }

  return out;
}
