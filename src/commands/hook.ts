import { lstatSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { loadConfig } from "../config.ts";
import { hasErrors, runRules, toPosix } from "../engine.ts";
import { matchesAny } from "../glob.ts";
import { evaluatePatterns, PATTERN_DEADLINE_MS, PatternTimeoutError } from "../patternEvaluator.ts";
import { formatDenial } from "../report.ts";
import { patternSelector } from "../rules/bannedSymbols.ts";
import type { FileEntry, KeelsonConfig } from "../types.ts";
import { CANNOT_RECONSTRUCT, proposedContent } from "./reconstruct.ts";

interface HookInput {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  cwd?: string;
}

const EDITING_TOOLS = new Set(["Write", "Edit", "MultiEdit"]);
const COMPANION_RULE_ID = "required-companion";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Surfaces a problem to the user without touching the permission decision. */
function warn(message: string): void {
  process.stdout.write(`${JSON.stringify({ systemMessage: message })}\n`);
}

function deny(reason: string): void {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    })}\n`,
  );
}

/**
 * Answers path existence with a single stat against the post-edit tree.
 *
 * Listing the repository to answer this cost an O(repo) walk on every edit that
 * a companion rule covered — 0.75s on a large workspace.
 *
 * `lstat` plus the regular-file test is what keeps this agreeing with `check`,
 * which collects only `Dirent.isFile()` entries: a directory or a symlink named
 * like the companion used to satisfy the hook while still failing the build.
 */
function pathPredicate(root: string, config: KeelsonConfig, proposed: string) {
  return (path: string): boolean => {
    if (path === proposed) return true;
    if (matchesAny(path, config.exclude)) return false;
    try {
      return lstatSync(join(root, path)).isFile();
    } catch {
      return false;
    }
  };
}

/**
 * Resolves the tool's path against the payload cwd and returns it relative to
 * the config root, or null when it falls outside.
 *
 * Both halves matter: without resolution `./src/a.ts` fails to match the glob
 * `src/**` that its materialised form will match, and `src/../../outside.ts`
 * escapes the root while still passing a naive `startsWith("..")` test.
 */
function repoRelativePath(filePath: string, cwd: string, root: string): string | null {
  const absolute = isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
  const relativePath = relative(root, absolute);

  const escapesRoot =
    relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);

  return escapesRoot ? null : toPosix(relativePath);
}

/**
 * PreToolUse entry point.
 *
 * Fails open by design: any malformed payload, missing config, unreconstructable
 * edit, or unexpected error exits 0 with no decision, so keelson can never wedge
 * a session. A linter that blocks work when it breaks gets uninstalled.
 */
export async function hookCommand(): Promise<number> {
  let input: HookInput;
  try {
    input = JSON.parse(await readStdin()) as HookInput;
  } catch {
    return 0;
  }

  const toolName = input.tool_name ?? "";
  const toolInput = input.tool_input ?? {};
  const filePath = toolInput.file_path;

  if (!EDITING_TOOLS.has(toolName) || typeof filePath !== "string" || filePath === "") return 0;

  const cwd = input.cwd ?? process.cwd();
  const { config, root } = await loadConfig(cwd);
  const path = repoRelativePath(filePath, cwd, root);

  if (path === null || matchesAny(path, config.exclude)) return 0;

  const absolutePath = isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
  const content = await proposedContent(toolName, toolInput, absolutePath);
  if (content === CANNOT_RECONSTRUCT) return 0;

  const file: FileEntry = { path, content };

  // Patterns are evaluated off the main thread under a deadline. A timeout
  // throws, and the hook's fail-open handler turns that into no decision.
  // A timeout means the config holds a pathological pattern. That must never
  // block the edit, but it must not be silent either, or enforcement quietly
  // stops at edit time and resurfaces much later as a CI failure.
  let matches;
  try {
    matches = await evaluatePatterns([file], patternSelector(config), PATTERN_DEADLINE_MS);
  } catch (error) {
    if (!(error instanceof PatternTimeoutError)) throw error;
    warn(`keelson skipped banned-symbols for this edit. ${error.message}`);
    return 0;
  }

  const violations = runRules(config, {
    files: [file],
    // A Write creates its target, so the proposed path counts as existing.
    hasPath: pathPredicate(root, config, path),
    matches,
    root,
  });
  if (!hasErrors(violations)) return 0;

  deny(formatDenial(violations.filter((violation) => violation.severity === "error")));
  return 0;
}
