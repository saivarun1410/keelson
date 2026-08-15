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

export function globToRegExp(glob: string): RegExp {
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
      const close = glob.indexOf("}", index);
      if (close !== -1) {
        const alternatives = glob.slice(index + 1, close).split(",");
        pattern += `(?:${alternatives.map(escapeLiteral).join("|")})`;
        index = close + 1;
        continue;
      }
    }

    pattern += escapeLiteral(char);
    index += 1;
  }

  return new RegExp(`^${pattern}$`);
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
