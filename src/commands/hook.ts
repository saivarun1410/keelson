import { isAbsolute, relative, resolve, sep } from "node:path";
import { loadConfig } from "../config.ts";
import { collectPaths, hasErrors, runRules, toPosix } from "../engine.ts";
import { matchesAny } from "../glob.ts";
import { assertPatternsTerminate } from "../regexGuard.ts";
import { formatDenial } from "../report.ts";
import type { FileEntry, KeelsonConfig, RawRule } from "../types.ts";
import { CANNOT_RECONSTRUCT, proposedContent } from "./reconstruct.ts";

interface HookInput {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  cwd?: string;
}

const EDITING_TOOLS = new Set(["Write", "Edit", "MultiEdit"]);
const COMPANION_RULE_ID = "required-companion";
const BANNED_SYMBOLS_RULE_ID = "banned-symbols";

/** Budget for proving the config's patterns terminate. Generous for real ones. */
const PATTERN_DEADLINE_MS = 1000;

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
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

function rulesCovering(config: KeelsonConfig, ruleId: string, path: string): RawRule[] {
  return config.rules.filter(
    (rule) =>
      rule.id === ruleId && Array.isArray(rule.files) && matchesAny(path, rule.files as string[]),
  );
}

/** Every regex that will run against this file, read straight off the raw rules. */
function patternsFor(config: KeelsonConfig, path: string): string[] {
  return rulesCovering(config, BANNED_SYMBOLS_RULE_ID, path)
    .flatMap((rule) => (Array.isArray(rule.symbols) ? rule.symbols : []) as { pattern?: unknown }[])
    .map((symbol) => symbol?.pattern)
    .filter((pattern): pattern is string => typeof pattern === "string");
}

/**
 * `required-companion` is the only rule needing a repo scan. Skipping it unless
 * a companion rule actually covers the edited path keeps the common edit off a
 * full directory walk.
 */
async function pathsForConfig(
  config: KeelsonConfig,
  root: string,
  path: string,
): Promise<string[]> {
  if (rulesCovering(config, COMPANION_RULE_ID, path).length === 0) return [];
  return collectPaths(root, config.exclude);
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

  // Prove the patterns terminate against this content before running them
  // in-process, where a runaway match could not be interrupted. Only patterns
  // that actually cover this file are worth the worker.
  await assertPatternsTerminate(patternsFor(config, path), content.split("\n"), PATTERN_DEADLINE_MS);

  const file: FileEntry = { path, content };
  const existing = await pathsForConfig(config, root, path);
  // A Write creates its target, so the proposed path is present as far as any
  // rule reasoning about the post-edit tree is concerned.
  const allPaths = existing.includes(path) ? existing : [...existing, path];

  const violations = runRules(config, { files: [file], allPaths, root });
  if (!hasErrors(violations)) return 0;

  deny(formatDenial(violations.filter((violation) => violation.severity === "error")));
  return 0;
}
