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

import { opensTag, stepJsx } from "./jsx.ts";
import {
  CONTROL_KEYWORDS,
  createScanState,
  OPERAND_KEYWORDS,
  OPERAND_POSITION,
  type ScanState,
} from "./scanState.ts";
import {
  consumeString,
  openingTripleQuote,
  skipRegexLiteral,
} from "./scanTokens.ts";

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
  let parenDepth = 0;
  const controlParens: number[] = [];
  // Set by the `)` that closes a control condition: what follows is a
  // statement, so `if (on) /re/.test(x)` is a regex literal, not a division.
  let afterControlParen = false;

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
      lastCode === undefined ||
      OPERAND_POSITION.test(lastCode) ||
      OPERAND_KEYWORDS.has(precedingWord) ||
      afterControlParen;
    if (char === "/" && afterOperand) {
      index = skipRegexLiteral(line, index);
      out += " ";
      afterControlParen = false;
      continue;
    }

    // JSX children and attributes are prose; `{ ... }` inside them is code.
    const jsxStep = stepJsx(line, index, state.jsx);
    if (jsxStep.kind === "skip") {
      index = jsxStep.next;
      out += " ";
      continue;
    }
    if (jsxStep.kind === "none" && char === "<" && opensTag(line, index, afterOperand)) {
      state.jsx.inTag = true;
      index += 1;
      out += " ";
      continue;
    }

    if (char === "(") {
      parenDepth += 1;
      if (CONTROL_KEYWORDS.has(precedingWord)) controlParens.push(parenDepth);
    } else if (char === ")") {
      if (controlParens.at(-1) === parenDepth) {
        controlParens.pop();
        afterControlParen = true;
      }
      parenDepth -= 1;
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
    if (!/\s/.test(char)) {
      if (char !== ")") afterControlParen = false;
      lastCode = char;
    }
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
