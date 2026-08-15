import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { loadConfig } from "../config.ts";
import { collectPaths, hasErrors, runRules, toPosix } from "../engine.ts";
import { matchesAny } from "../glob.ts";
import { formatDenial } from "../report.ts";
import type { FileEntry, KeelsonConfig, RawRule } from "../types.ts";

interface HookInput {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  cwd?: string;
}

interface EditOperation {
  old_string?: unknown;
  new_string?: unknown;
  replace_all?: unknown;
}

const EDITING_TOOLS = new Set(["Write", "Edit", "MultiEdit"]);
const COMPANION_RULE_ID = "required-companion";

/** Reconstruction failed; keelson must stay out of the way. */
const CANNOT_RECONSTRUCT = Symbol("cannot-reconstruct");
type Reconstructed = string | typeof CANNOT_RECONSTRUCT;

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Applies one edit exactly as the editing tool would.
 *
 * The replacement must be a function. Passing the string directly makes
 * `String.replace` interpret `$&`, `` $` ``, `$'` and `$$` as insertion
 * patterns, while the real tool writes them literally — so keelson would judge
 * content that is never going to exist.
 */
function applyEdit(content: string, edit: EditOperation): Reconstructed {
  const { old_string: oldString, new_string: newString } = edit;
  if (typeof oldString !== "string" || typeof newString !== "string") {
    return CANNOT_RECONSTRUCT;
  }
  if (oldString === "") return content;

  return edit.replace_all === true
    ? content.replaceAll(oldString, () => newString)
    : content.replace(oldString, () => newString);
}

/**
 * Reconstructs what the file will contain if the tool call succeeds, or
 * CANNOT_RECONSTRUCT when the payload is malformed or the file is unreadable.
 *
 * Substituting "" for missing content used to let rules run — and deny — on a
 * file whose contents keelson had never actually seen.
 */
async function proposedContent(
  toolName: string,
  input: Record<string, unknown>,
  absolutePath: string,
): Promise<Reconstructed> {
  if (toolName === "Write") {
    return typeof input.content === "string" ? input.content : CANNOT_RECONSTRUCT;
  }

  let current: string;
  try {
    current = await readFile(absolutePath, "utf8");
  } catch {
    return CANNOT_RECONSTRUCT;
  }

  if (toolName === "Edit") return applyEdit(current, input as EditOperation);

  if (!Array.isArray(input.edits)) return CANNOT_RECONSTRUCT;
  let content: Reconstructed = current;
  for (const edit of input.edits as EditOperation[]) {
    if (content === CANNOT_RECONSTRUCT) return CANNOT_RECONSTRUCT;
    content = applyEdit(content, edit);
  }
  return content;
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

function companionRulesMatching(config: KeelsonConfig, path: string): RawRule[] {
  return config.rules.filter(
    (rule) =>
      rule.id === COMPANION_RULE_ID &&
      Array.isArray(rule.files) &&
      matchesAny(path, rule.files as string[]),
  );
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
  if (companionRulesMatching(config, path).length === 0) return [];
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
 * Fails open by design: any malformed payload, missing config, or unexpected
 * error exits 0 with no decision, so keelson can never wedge a session. A
 * linter that blocks work when it breaks gets uninstalled.
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
  const existing = await pathsForConfig(config, root, path);
  // A Write creates its target, so the proposed path is present as far as any
  // rule reasoning about the post-edit tree is concerned.
  const allPaths = existing.includes(path) ? existing : [...existing, path];

  const violations = runRules(config, { files: [file], allPaths, root });
  if (!hasErrors(violations)) return 0;

  deny(formatDenial(violations.filter((violation) => violation.severity === "error")));
  return 0;
}
