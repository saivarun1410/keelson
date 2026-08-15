/**
 * Token-consumption helpers for the scanner: skipping over the constructs
 * whose contents must not be read as code. Split from `scanner.ts` to keep
 * both files under keelson's own line cap.
 */

export const TRIPLE_QUOTES = ['"""', "'''"];

export function consumeString(line: string, start: number, quote: string): [string, number] {
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
export function skipRegexLiteral(line: string, start: number): number {
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

export function openingTripleQuote(line: string, index: number): string | null {
  return TRIPLE_QUOTES.find((quote) => line.startsWith(quote, index)) ?? null;
}
