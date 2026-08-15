/**
 * Lexical JSX tracking.
 *
 * JSX children are prose, not code. Documentation like
 * `<p>Call require("x") only in Node</p>` was being read as a dependency and
 * blocking the edit, so tag regions and element text are suppressed while
 * `{ ... }` expressions stay visible — those really are code.
 *
 * This is a lexer, not a parser: it recognises where JSX starts and stops well
 * enough to decide what is prose, which is all the import scan needs.
 */

export interface JsxState {
  /** Whether this file may contain JSX at all. */
  enabled: boolean;
  /** Inside a tag, between `<` and its closing `>`. */
  inTag: boolean;
  /** Inside element children, where text is prose. */
  inText: boolean;
  /** Nesting depth of `{ ... }` expressions inside JSX. */
  expressionDepth: number;
}

const JSX_FILES = /\.(jsx|tsx)$/i;

export function createJsxState(path: string): JsxState {
  return { enabled: JSX_FILES.test(path), inTag: false, inText: false, expressionDepth: 0 };
}

/** True when `<` at this position opens a tag rather than being a comparison. */
export function opensTag(line: string, index: number, afterOperand: boolean): boolean {
  if (!afterOperand) return false;
  return /[A-Za-z/>]/.test(line[index + 1] ?? "");
}

export type JsxStep =
  | { kind: "skip"; next: number }
  | { kind: "code" }
  | { kind: "none" };

/**
 * Advances JSX state for one character.
 *
 * Returns `skip` when the character is prose to drop, `code` when the scanner
 * should handle it normally, and `none` when JSX is not currently active.
 */
export function stepJsx(line: string, index: number, state: JsxState): JsxStep {
  if (!state.enabled) return { kind: "none" };
  const char = line[index];

  // Inside `{ ... }` within JSX: real code, until the braces balance.
  if (state.expressionDepth > 0) {
    if (char === "{") state.expressionDepth += 1;
    if (char === "}") {
      state.expressionDepth -= 1;
      if (state.expressionDepth === 0) return { kind: "skip", next: index + 1 };
    }
    return { kind: "code" };
  }

  if (state.inTag) {
    if (char === "{") {
      state.expressionDepth = 1;
      return { kind: "skip", next: index + 1 };
    }
    if (char === ">") {
      state.inTag = false;
      // A self-closing or closing tag has no children text of its own; the next
      // `<` corrects the state either way, so treating both alike is safe.
      state.inText = true;
      return { kind: "skip", next: index + 1 };
    }
    // Attribute values are data, not module specifiers.
    return { kind: "skip", next: index + 1 };
  }

  if (state.inText) {
    if (char === "<") {
      state.inText = false;
      state.inTag = true;
      return { kind: "skip", next: index + 1 };
    }
    if (char === "{") {
      state.expressionDepth = 1;
      return { kind: "skip", next: index + 1 };
    }
    return { kind: "skip", next: index + 1 };
  }

  return { kind: "none" };
}
