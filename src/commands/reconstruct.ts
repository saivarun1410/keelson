import { readFile } from "node:fs/promises";

/**
 * Rebuilds what a file will contain if a pending tool call succeeds.
 *
 * Everything here exists to make one guarantee: keelson judges the content the
 * editing tool will actually write, or it judges nothing at all. Guessing —
 * substituting "" for a missing field, or reconstructing an edit the tool would
 * refuse — means denying an edit that was never going to happen.
 */

export interface EditOperation {
  old_string?: unknown;
  new_string?: unknown;
  replace_all?: unknown;
}

/** Reconstruction failed; keelson must stay out of the way. */
export const CANNOT_RECONSTRUCT = Symbol("cannot-reconstruct");
export type Reconstructed = string | typeof CANNOT_RECONSTRUCT;

function occurrences(content: string, needle: string): number {
  let count = 0;
  let index = content.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = content.indexOf(needle, index + needle.length);
  }
  return count;
}

/**
 * Applies one edit exactly as the editing tool would, or reports that it cannot
 * be applied at all.
 *
 * Two separate hazards. An edit the tool will reject — empty `old_string`, a
 * string that is absent, or an ambiguous one without `replace_all` — changes
 * nothing, so judging the unchanged file and denying it blocks a no-op. And the
 * replacement must be passed as a function: given the string directly,
 * `String.replace` interprets `$&`, `` $` ``, `$'` and `$$` as insertion
 * patterns, while the real tool writes them literally.
 */
export function applyEdit(content: string, edit: EditOperation): Reconstructed {
  const { old_string: oldString, new_string: newString, replace_all: replaceAll } = edit;

  if (typeof oldString !== "string" || typeof newString !== "string") return CANNOT_RECONSTRUCT;
  if (replaceAll !== undefined && typeof replaceAll !== "boolean") return CANNOT_RECONSTRUCT;
  if (oldString === "") return CANNOT_RECONSTRUCT;

  const count = occurrences(content, oldString);
  if (count === 0) return CANNOT_RECONSTRUCT;
  if (count > 1 && replaceAll !== true) return CANNOT_RECONSTRUCT;

  return replaceAll === true
    ? content.replaceAll(oldString, () => newString)
    : content.replace(oldString, () => newString);
}

export async function proposedContent(
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

  if (!Array.isArray(input.edits) || input.edits.length === 0) return CANNOT_RECONSTRUCT;

  let content: Reconstructed = current;
  for (const edit of input.edits as EditOperation[]) {
    if (content === CANNOT_RECONSTRUCT) return CANNOT_RECONSTRUCT;
    content = applyEdit(content, edit);
  }
  return content;
}
