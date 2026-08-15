/**
 * Minimal glob matching for path patterns.
 *
 * Node 22's `fs.glob` finds files on disk, but rules also need to test a path
 * that is not on disk yet (the proposed content of an agent edit), so we need
 * our own matcher. Supporting `**`, `*`, `?` and `{a,b}` covers every pattern
 * shape the rule set uses, and avoids a dependency on the hook's hot path.
 */

const REGEX_METACHARACTERS = /[.+^${}()|[\]\\]/g;

function escapeLiteral(text: string): string {
  return text.replace(REGEX_METACHARACTERS, "\\$&");
}

/** Index of the `}` closing the `{` at `open`, honouring nesting. -1 if unclosed. */
function findClosingBrace(glob: string, open: number): number {
  let depth = 0;
  for (let index = open; index < glob.length; index += 1) {
    if (glob[index] === "{") depth += 1;
    else if (glob[index] === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/** Splits on commas at brace depth 0, so `{a,{b,c}}` yields ["a", "{b,c}"]. */
function splitAlternatives(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";

  for (const char of body) {
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

/**
 * Compiles glob syntax to a regex fragment. Brace alternatives recurse through
 * this same function rather than being escaped as literals — otherwise `*` and
 * `?` inside braces would reach the regex engine as raw quantifiers, silently
 * changing what a pattern matches and making `{*.test,*.spec}` a syntax error.
 */
function compile(glob: string): string {
  let pattern = "";
  let index = 0;

  while (index < glob.length) {
    const char = glob[index];

    if (char === "*" && glob[index + 1] === "*") {
      index += 2;
      // `**/` may match zero directories, so `src/**/*.ts` also matches `src/a.ts`.
      if (glob[index] === "/") {
        index += 1;
        pattern += "(?:[^/]*/)*";
      } else {
        pattern += ".*";
      }
      continue;
    }

    if (char === "*") {
      pattern += "[^/]*";
      index += 1;
      continue;
    }

    if (char === "?") {
      pattern += "[^/]";
      index += 1;
      continue;
    }

    if (char === "{") {
      const close = findClosingBrace(glob, index);
      if (close !== -1) {
        const alternatives = splitAlternatives(glob.slice(index + 1, close));
        pattern += `(?:${alternatives.map(compile).join("|")})`;
        index = close + 1;
        continue;
      }
    }

    pattern += escapeLiteral(char);
    index += 1;
  }

  return pattern;
}

export function globToRegExp(glob: string): RegExp {
  return new RegExp(`^${compile(glob)}$`);
}

const compiledCache = new Map<string, RegExp>();

export function matchesGlob(path: string, glob: string): boolean {
  let compiled = compiledCache.get(glob);
  if (!compiled) {
    compiled = globToRegExp(glob);
    compiledCache.set(glob, compiled);
  }
  return compiled.test(path);
}

export function matchesAny(path: string, globs: readonly string[]): boolean {
  return globs.some((glob) => matchesGlob(path, glob));
}
