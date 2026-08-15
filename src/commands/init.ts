import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_FILENAME } from "../config.ts";
import { collectPaths, readFiles } from "../engine.ts";

const SCAN_EXCLUDES = ["**/node_modules/**", "**/dist/**", "**/build/**", "**/target/**", "**/.git/**"];

/** Extension → the banned constructs that actually matter in that language. */
const BANNED_BY_EXTENSION: Record<string, { pattern: string; message: string }[]> = {
  ts: [{ pattern: "console\\.log\\(", message: "Use the project logger, not console.log" }],
  tsx: [{ pattern: "console\\.log\\(", message: "Use the project logger, not console.log" }],
  js: [{ pattern: "console\\.log\\(", message: "Use the project logger, not console.log" }],
  java: [
    { pattern: "System\\.out\\.print", message: "Use SLF4J, not System.out" },
    { pattern: "printStackTrace\\(", message: "Log with context instead of printStackTrace" },
    { pattern: "@Autowired\\s*$", message: "Use constructor injection, not field @Autowired" },
  ],
  py: [{ pattern: "^\\s*print\\(", message: "Use logging, not print" }],
  go: [{ pattern: "fmt\\.Print", message: "Use the structured logger, not fmt.Print" }],
};

const PERCENTILE = 0.95;
const HEADROOM = 1.15;
const MIN_LIMIT = 120;

function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot + 1);
}

/**
 * Picks a line cap just above the repo's 95th percentile file. A limit the repo
 * already passes is a limit that gets adopted; one that fails on install gets
 * deleted. The number is meant to be ratcheted down over time.
 */
function suggestLineLimit(lengths: number[]): number {
  if (lengths.length === 0) return 300;
  const sorted = [...lengths].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * PERCENTILE));
  return Math.max(MIN_LIMIT, Math.ceil((sorted[index] * HEADROOM) / 10) * 10);
}

function renderConfig(extension: string, limit: number): string {
  const banned = BANNED_BY_EXTENSION[extension] ?? [];
  // Patterns are regexes full of backslashes. Interpolating them into YAML
  // quotes produced invalid escapes like "\." — so `init` wrote a config that
  // `check` then refused to parse. JSON string syntax is a valid subset of a
  // YAML double-quoted scalar, so this both quotes and escapes correctly.
  const symbols = banned
    .map(
      (entry) =>
        `      - pattern: ${JSON.stringify(entry.pattern)}\n` +
        `        message: ${JSON.stringify(entry.message)}`,
    )
    .join("\n");

  return `# keelson — architecture rules enforced at agent edit time and in CI.
# Docs: https://github.com/saivarun1410/keelson
version: 1

rules:
  - id: max-file-lines
    files: ["**/*.${extension}"]
    max: ${limit}

${symbols ? `  - id: banned-symbols\n    files: ["**/*.${extension}"]\n    symbols:\n${symbols}\n` : ""}
# Dependency direction. Uncomment and adapt to your layout:
#
#  - id: layer-boundaries
#    from: "**/controller/**"
#    disallow: ["**/repository/**"]
#    message: "Controllers must go through a service, not a repository."
#
#  - id: required-companion
#    files: ["src/**/*.${extension}"]
#    companion: "test/{name}.test.${extension}"
`;
}

/** Writes a starter config inferred from what the repo already looks like. */
export async function initCommand(): Promise<number> {
  const root = process.cwd();
  const target = join(root, CONFIG_FILENAME);

  if (existsSync(target)) {
    process.stderr.write(`${CONFIG_FILENAME} already exists — not overwriting.\n`);
    return 1;
  }

  const paths = await collectPaths(root, SCAN_EXCLUDES);
  const byExtension = new Map<string, string[]>();
  for (const path of paths) {
    const extension = extensionOf(path);
    if (!BANNED_BY_EXTENSION[extension]) continue;
    byExtension.set(extension, [...(byExtension.get(extension) ?? []), path]);
  }

  const [dominant] = [...byExtension.entries()].sort((a, b) => b[1].length - a[1].length);
  if (!dominant) {
    process.stderr.write("Could not detect a dominant language. Write keelson.yaml by hand.\n");
    return 1;
  }

  const [extension, files] = dominant;
  const contents = await readFiles(root, files);
  const limit = suggestLineLimit(contents.map((file) => file.content.split("\n").length));

  await writeFile(target, renderConfig(extension, limit), "utf8");
  process.stdout.write(
    `Wrote ${CONFIG_FILENAME} for .${extension} (${files.length} files, limit ${limit} lines).\n` +
      `Next: npx keelson check\n`,
  );
  return 0;
}
