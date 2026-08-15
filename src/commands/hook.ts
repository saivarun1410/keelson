import { readFile } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import { loadConfig } from "../config.ts";
import { collectPaths, hasErrors, runRules, toPosix } from "../engine.ts";
import { matchesAny } from "../glob.ts";
import { formatDenial } from "../report.ts";
import type { FileEntry, KeelsonConfig } from "../types.ts";

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

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function applyEdit(content: string, edit: EditOperation): string {
  const oldString = typeof edit.old_string === "string" ? edit.old_string : "";
  const newString = typeof edit.new_string === "string" ? edit.new_string : "";
  if (oldString === "") return content;
  return edit.replace_all === true
    ? content.replaceAll(oldString, newString)
    : content.replace(oldString, newString);
}

/**
 * Reconstructs what the file will contain if the tool call succeeds. Checking
 * the proposed content is what lets keelson reject an edit before it lands,
 * rather than reporting on damage already done.
 */
async function proposedContent(toolName: string, input: Record<string, unknown>): Promise<string> {
  if (toolName === "Write") {
    return typeof input.content === "string" ? input.content : "";
  }

  const filePath = input.file_path as string;
  const current = await readFile(filePath, "utf8").catch(() => "");

  if (toolName === "Edit") return applyEdit(current, input as EditOperation);

  const edits = Array.isArray(input.edits) ? (input.edits as EditOperation[]) : [];
  return edits.reduce(applyEdit, current);
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

/** `required-companion` is the only rule needing a repo scan; skip it otherwise. */
async function pathsForConfig(config: KeelsonConfig, root: string): Promise<string[]> {
  const needsScan = config.rules.some((rule) => rule.id === COMPANION_RULE_ID);
  return needsScan ? collectPaths(root, config.exclude) : [];
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

  if (!EDITING_TOOLS.has(toolName) || typeof filePath !== "string") return 0;

  const { config, root } = await loadConfig(input.cwd ?? process.cwd());
  const path = toPosix(isAbsolute(filePath) ? relative(root, filePath) : filePath);

  // An edit outside the config root, or into an excluded path, is not ours to judge.
  if (path.startsWith("..") || matchesAny(path, config.exclude)) return 0;

  const file: FileEntry = { path, content: await proposedContent(toolName, toolInput) };
  const allPaths = await pathsForConfig(config, root);
  const violations = runRules(config, { files: [file], allPaths, root });

  if (!hasErrors(violations)) return 0;

  deny(formatDenial(violations.filter((violation) => violation.severity === "error")));
  return 0;
}
