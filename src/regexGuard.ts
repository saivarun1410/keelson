import { Worker } from "node:worker_threads";

/**
 * Proves that a config's regexes terminate against real content, under a hard
 * deadline, before they are run on the main thread.
 *
 * A heuristic over pattern shapes cannot deliver the fail-open guarantee.
 * `^(a|aa)+$` has no nested quantifier yet still backtracks exponentially, and
 * regex execution is synchronous: once it starts on the main thread nothing —
 * not a try/catch, not a timer — can interrupt it, so the hook hangs before any
 * fail-open handler could run.
 *
 * Running the same patterns in a worker first makes the cost interruptible. The
 * worker is terminated when the deadline passes and the caller fails open. The
 * duplicated matching is irrelevant: for patterns that are not pathological it
 * is microseconds, and for ones that are, we never reach the second run.
 */

const WORKER_SOURCE = `
const { parentPort } = require("node:worker_threads");
parentPort.on("message", ({ patterns, lines }) => {
  for (const source of patterns) {
    const pattern = new RegExp(source);
    for (const line of lines) pattern.test(line);
  }
  parentPort.postMessage("ok");
});
`;

export class RegexTimeoutError extends Error {
  constructor(milliseconds: number) {
    super(`Pattern evaluation exceeded ${milliseconds}ms and was abandoned`);
    this.name = "RegexTimeoutError";
  }
}

/**
 * Rejects with RegexTimeoutError if evaluation does not finish in time.
 * Any other failure also rejects, so the caller's fail-open path handles it.
 */
export async function assertPatternsTerminate(
  patterns: readonly string[],
  lines: readonly string[],
  milliseconds: number,
): Promise<void> {
  if (patterns.length === 0 || lines.length === 0) return;

  const worker = new Worker(WORKER_SOURCE, { eval: true });
  let timer: NodeJS.Timeout | undefined;

  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new RegexTimeoutError(milliseconds)), milliseconds);
      worker.once("message", () => resolve());
      worker.once("error", reject);
      worker.once("exit", (code) => reject(new Error(`Pattern worker exited with ${code}`)));
      worker.postMessage({ patterns: [...patterns], lines: [...lines] });
    });
  } finally {
    if (timer) clearTimeout(timer);
    await worker.terminate();
  }
}
